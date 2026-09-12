'use client';

import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { API_URL, securedFetch } from '@/src/lib/api';
import { buildDangerCommandWarning, isDangerousCommand, updateLineBuffer } from '@/src/lib/shellGuard';

interface TerminalPaneProps {
    classId: string;
    onPhaseChange?: (phase: ConnectionPhase) => void;
}

export type ConnectionPhase = 'connecting' | 'open' | 'closed' | 'error';

// 「実行」ボタン(EditorPane)がこのターミナルへコマンドを流し込むための
// 命令的API。WorkspaceLayout→TerminalsPane→(アクティブな)TerminalPaneと
// refで橋渡しする(親子どちらもReactの状態を介さない、命令的な操作のため)。
export interface TerminalHandle {
    // commandに改行(\r、実際のEnterキー相当)を付けて送信し、ターミナルへ
    // フォーカスを移す。WebSocket接続がまだ確立していなければ、接続完了後に
    // 送信されるようキューイングする(「実行」ボタンを押した直後にまだ
    // 接続中、というタイミングでもコマンドを取りこぼさないため)。
    runCommand: (command: string) => void;
}

// コンテナ内exec+WebSocketストリーミング(短命チケット認証)のフロント側。
// バックエンドのプロトコル(internal/handler/shell_handler.go)に合わせて:
//   - サーバー→クライアント: バイナリフレーム = シェルの生出力(そのままterm.writeする)
//   - クライアント→サーバー: バイナリフレーム = 標準入力そのもの、
//     テキストフレーム = {"type":"resize","cols":N,"rows":N} 制御メッセージ
// (元はShellModal.tsxのモーダル実装から、ワークスペース画面の1ペインとして移設したもの)
export const TerminalPane = forwardRef<TerminalHandle, TerminalPaneProps>(function TerminalPane(
    { classId, onPhaseChange },
    handleRef,
) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const termRef = useRef<XTerm | null>(null);
    const lineBufferRef = useRef('');
    // WebSocketがまだ開いていない間に「実行」が呼ばれた場合、接続完了後に
    // 送るコマンドを1つだけ保持しておく(取りこぼし防止)。
    const pendingCommandRef = useRef<string | null>(null);

    const [phase, setPhase] = useState<ConnectionPhase>('connecting');
    const [errorMessage, setErrorMessage] = useState('');

    useEffect(() => {
        onPhaseChange?.(phase);
    }, [phase, onPhaseChange]);

    useImperativeHandle(
        handleRef,
        () => ({
            runCommand: (command: string) => {
                termRef.current?.focus();
                const text = `${command}\r`;
                const ws = wsRef.current;
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(new TextEncoder().encode(text));
                } else {
                    pendingCommandRef.current = text;
                }
            },
        }),
        [],
    );

    useEffect(() => {
        if (!containerRef.current) return;

        let cancelled = false;
        setPhase('connecting');
        setErrorMessage('');

        const term = new XTerm({
            cursorBlink: true,
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            fontSize: 14,
            theme: {
                background: '#181818',
                foreground: '#d4d4d4',
                cursor: '#aeafad',
                red: '#f44747',
                brightRed: '#d16969',
                yellow: '#cca700',
                green: '#6a9955',
                blue: '#569cd6',
            },
        });
        termRef.current = term;
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(containerRef.current);
        fitAddon.fit();
        lineBufferRef.current = '';

        const connect = async () => {
            try {
                const res = await securedFetch('/api/v2/program/container/ticket', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ course_id: Number(classId) }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.ticket) {
                    throw new Error(data.error || 'チケットの発行に失敗しました');
                }
                if (cancelled) return;

                const wsBase = API_URL.replace(/^http/, 'ws');
                const ws = new WebSocket(`${wsBase}/api/v2/program/container/shell?ticket=${encodeURIComponent(data.ticket)}`);
                ws.binaryType = 'arraybuffer';
                wsRef.current = ws;

                ws.onopen = () => {
                    if (cancelled) return;
                    setPhase('open');
                    fitAddon.fit();
                    ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
                    term.focus();
                    if (pendingCommandRef.current) {
                        ws.send(new TextEncoder().encode(pendingCommandRef.current));
                        pendingCommandRef.current = null;
                    }
                };
                ws.onmessage = (event) => {
                    if (typeof event.data === 'string') return;
                    term.write(new Uint8Array(event.data as ArrayBuffer));
                };
                ws.onerror = () => {
                    if (cancelled) return;
                    setPhase('error');
                    setErrorMessage('接続中にエラーが発生しました');
                };
                ws.onclose = () => {
                    if (cancelled) return;
                    setPhase('closed');
                    term.write('\r\n\x1b[90m[接続が終了しました]\x1b[0m\r\n');
                };
            } catch (err) {
                if (cancelled) return;
                setPhase('error');
                setErrorMessage(err instanceof Error ? err.message : 'シェルへの接続に失敗しました');
            }
        };
        connect();

        // Ctrl+C/Ctrl+Vをブラウザ標準のコピー&ペーストとして扱う。
        // 素の端末ではCtrl+Cは選択の有無を問わずSIGINT、Ctrl+Vはbashの
        // readlineが`quoted-insert`(次の1文字をそのまま挿入)に割り当てて
        // いるため、どちらもクリップボード操作としては機能しない。
        // 選択中のCtrl+Cだけコピーへ回し、選択が無い時は従来通りSIGINTを送る
        // (Ctrl+Cでプロセスを止める操作を壊さないため)。
        //
        // ここで`false`を返すのはxterm自身のキー→端末入力変換を止めるだけで、
        // 元のブラウザkeydownのpreventDefault()は呼ばれない。そのままだと
        // ブラウザ標準のコピー/ペースト動作(とxterm自身がtextarea/element に
        // 登録しているネイティブ"paste"/"copy"イベントリスナー)がこれとは
        // 別に発火してしまい、貼り付けが2回実行される(実際に発生した不具合)。
        // preventDefault()を明示的に呼び、この経路だけで処理を完結させる。
        term.attachCustomKeyEventHandler((event) => {
            if (event.type !== 'keydown' || !event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) {
                return true;
            }
            const key = event.key.toLowerCase();
            if (key === 'c' && term.hasSelection()) {
                navigator.clipboard.writeText(term.getSelection()).catch(() => {});
                event.preventDefault();
                return false;
            }
            if (key === 'v') {
                navigator.clipboard
                    .readText()
                    .then((text) => {
                        if (!text) return;
                        const ws = wsRef.current;
                        if (ws && ws.readyState === WebSocket.OPEN) {
                            ws.send(new TextEncoder().encode(text));
                        }
                    })
                    .catch(() => {});
                event.preventDefault();
                return false;
            }
            return true;
        });

        const dataDisposable = term.onData((data) => {
            const ws = wsRef.current;
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(new TextEncoder().encode(data));
            }
            const { next, completedLines } = updateLineBuffer(lineBufferRef.current, data);
            lineBufferRef.current = next;
            for (const line of completedLines) {
                if (isDangerousCommand(line)) {
                    term.write(buildDangerCommandWarning(line.trim()));
                }
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
            termRef.current = null;
            term.dispose();
        };
    }, [classId]);

    return (
        <div className="flex flex-col h-full min-h-0 bg-[#181818]">
            {phase === 'connecting' && (
                <div className="px-3 py-1 text-[#8a8a8a] text-[11px] shrink-0">接続中...</div>
            )}
            {phase === 'closed' && (
                <div className="px-3 py-1 bg-[#8a8a8a]/10 text-[#8a8a8a] text-[11px] font-bold shrink-0">切断されました</div>
            )}
            {phase === 'error' && errorMessage && (
                <div className="px-3 py-1 bg-[#f44747]/15 text-[#f44747] text-[11px] font-bold shrink-0">{errorMessage}</div>
            )}
            <div className="flex-1 min-h-0 p-2">
                <div ref={containerRef} className="w-full h-full" />
            </div>
        </div>
    );
});
