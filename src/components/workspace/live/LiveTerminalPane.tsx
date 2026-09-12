'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { API_URL, securedFetch } from '@/src/lib/api';

interface LiveTerminalPaneProps {
    classId: string;
    // role='student': 自分自身のライブセッションに繋ぐ(生徒本人の
    // WorkspaceLayout.tsxから使う)。role='teacher': targetUserIdで指定した
    // 生徒のセッションに参加する(TeacherLiveSessionModal.tsxから使う)。
    role: 'student' | 'teacher';
    targetUserId?: string;
}

// 講師による生徒セッションのリアルタイム監視・共同操作(ライブセッション
// 同期)の共有ターミナル。1つの共有pty(JoinShellHub、
// internal/service/live_session_hub.go)へ生徒・講師の両方が接続し、
// どちらの入力もその場で相手の画面に反映される - 実装自体はTerminalPane.tsx
// (通常の、生徒個人の複数タブ式ターミナル)とほぼ同じだが、接続先の
// チケット発行エンドポイント/WebSocketエンドポイントが違うだけの別コンポーネント
// にしている(既存のTerminalsPaneの複数タブ管理・アイドル番号再利用等の
// 込み入ったロジックに、共有セッションという別概念を無理に混ぜ込んで
// 壊さないため)。
export function LiveTerminalPane({ classId, role, targetUserId }: LiveTerminalPaneProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const [phase, setPhase] = useState<'connecting' | 'open' | 'closed' | 'error'>('connecting');

    useEffect(() => {
        if (!containerRef.current) return;
        if (role === 'teacher' && !targetUserId) return;

        // phaseは宣言時点で既に'connecting'が初期値であり、この副作用が
        // 再実行されるのは(role/targetUserId/classIdが変わる=)実質的に
        // 新しいセッションへの接続時のみ(この時点でLiveTerminalPane自体が
        // 再マウントされるTeacherLiveSessionModal/WorkspaceLayoutの使い方
        // が前提)のため、ここで改めてsetPhaseを呼ぶ必要はない
        // (react-hooks/set-state-in-effectを避ける)。
        let cancelled = false;

        const term = new XTerm({
            cursorBlink: true,
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            fontSize: 13,
            theme: {
                background: '#181818',
                foreground: '#d4d4d4',
                cursor: '#aeafad',
            },
        });
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(containerRef.current);
        fitAddon.fit();

        const connect = async () => {
            try {
                const ticketPath =
                    role === 'student'
                        ? '/api/v2/program/container/live-session-ticket'
                        : '/api/v2/program/teacher/live-session-ticket';
                const ticketBody =
                    role === 'student'
                        ? { course_id: Number(classId) }
                        : { course_id: Number(classId), user_id: targetUserId };

                const res = await securedFetch(ticketPath, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(ticketBody),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.ticket || cancelled) {
                    setPhase('error');
                    return;
                }

                const wsBase = API_URL.replace(/^http/, 'ws');
                const ws = new WebSocket(`${wsBase}/api/v2/program/container/live/shell?ticket=${encodeURIComponent(data.ticket)}`);
                ws.binaryType = 'arraybuffer';
                wsRef.current = ws;

                ws.onopen = () => {
                    if (cancelled) return;
                    setPhase('open');
                    fitAddon.fit();
                    ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
                    term.focus();
                };
                ws.onmessage = (event) => {
                    if (typeof event.data === 'string') return;
                    term.write(new Uint8Array(event.data as ArrayBuffer));
                };
                ws.onerror = () => {
                    if (!cancelled) setPhase('error');
                };
                ws.onclose = () => {
                    if (cancelled) return;
                    setPhase('closed');
                    term.write('\r\n\x1b[90m[ライブセッションの接続が終了しました]\x1b[0m\r\n');
                };
            } catch {
                if (!cancelled) setPhase('error');
            }
        };
        connect();

        const dataDisposable = term.onData((data) => {
            const ws = wsRef.current;
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(new TextEncoder().encode(data));
            }
        });

        const resizeObserver = new ResizeObserver(() => {
            fitAddon.fit();
            const ws = wsRef.current;
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
            }
        });
        resizeObserver.observe(containerRef.current);

        return () => {
            cancelled = true;
            resizeObserver.disconnect();
            dataDisposable.dispose();
            wsRef.current?.close();
            wsRef.current = null;
            term.dispose();
        };
    }, [classId, role, targetUserId]);

    return (
        <div className="flex flex-col h-full min-h-0 bg-[#181818]">
            <div className="px-3 py-1 bg-[#252526] border-b border-[#3c3c3c] text-[10px] font-bold text-[#8a8a8a] shrink-0 flex items-center gap-1.5">
                <span>🔴 ライブ共有ターミナル</span>
                {phase === 'connecting' && <span>(接続中...)</span>}
                {phase === 'error' && <span className="text-[#f44747]">(接続エラー)</span>}
                {phase === 'closed' && <span>(切断されました)</span>}
            </div>
            <div className="flex-1 min-h-0 p-2">
                <div ref={containerRef} className="w-full h-full" />
            </div>
        </div>
    );
}
