'use client';

import { useEffect, useRef, useState } from 'react';
import { API_URL, securedFetch } from '@/src/lib/api';
import { LiveMessage } from './liveTypes';

interface UseLiveEditorChannelOptions {
    // ticketPath: チケット発行エンドポイント。生徒本人は
    // '/api/v2/program/container/live-session-ticket'({course_id}のみ)、
    // 講師が特定の生徒に参加する場合は
    // '/api/v2/program/teacher/live-session-ticket'({course_id, user_id})。
    ticketPath: string;
    ticketBody: Record<string, unknown>;
    onMessage: (msg: LiveMessage) => void;
    // enabled=falseの間は接続しない(教師側ビューをまだ開いていない等)。
    enabled: boolean;
}

// ライブセッション同期(講師による生徒セッションのリアルタイム監視・共同
// 操作)のエディタ側WebSocket接続。サーバー(JoinEditorHub、
// live_session_hub.go)は中身を解釈せず送信者以外へそのまま中継するだけの
// 単純なpub-subのため、このフックも「チケットを取ってWebSocketを開き、
// 受け取ったJSONをそのままonMessageへ渡す/送信をそのままJSONで送る」だけに
// 徹する。接続が切れても自動再接続はしない(ベストエフォート機能 - 通常の
// 編集自体はこれが繋がっていなくても支障なく続けられるため、ここで複雑な
// 再試行ロジックを持ち込まない)。
export function useLiveEditorChannel({ ticketPath, ticketBody, onMessage, enabled }: UseLiveEditorChannelOptions) {
    const wsRef = useRef<WebSocket | null>(null);
    const [connected, setConnected] = useState(false);
    const onMessageRef = useRef(onMessage);
    useEffect(() => {
        onMessageRef.current = onMessage;
    }, [onMessage]);
    const ticketBodyKey = JSON.stringify(ticketBody);

    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;

        (async () => {
            try {
                const res = await securedFetch(ticketPath, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: ticketBodyKey,
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.ticket || cancelled) return;

                const wsBase = API_URL.replace(/^http/, 'ws');
                const ws = new WebSocket(
                    `${wsBase}/api/v2/program/container/live/editor?ticket=${encodeURIComponent(data.ticket)}`,
                );
                wsRef.current = ws;
                ws.onopen = () => {
                    if (!cancelled) setConnected(true);
                };
                ws.onclose = () => {
                    if (!cancelled) setConnected(false);
                };
                ws.onerror = () => {
                    if (!cancelled) setConnected(false);
                };
                ws.onmessage = (event) => {
                    if (typeof event.data !== 'string') return;
                    try {
                        onMessageRef.current(JSON.parse(event.data) as LiveMessage);
                    } catch {
                        // 壊れたメッセージは無視する。
                    }
                };
            } catch {
                // チケット発行/接続自体に失敗してもライブ機能が無効になる
                // だけで、通常のエディタ利用は問題なく続けられる。
            }
        })();

        return () => {
            cancelled = true;
            wsRef.current?.close();
            wsRef.current = null;
            setConnected(false);
        };
    }, [enabled, ticketPath, ticketBodyKey]);

    const send = (msg: LiveMessage) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
        }
    };

    return { connected, send };
}
