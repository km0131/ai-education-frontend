'use client';

import { useEffect, useState } from 'react';
import { API_URL, securedFetch } from '@/src/lib/api';

export interface HostMetrics {
    cpu_percent: number;
    mem_used_mb: number;
    mem_total_mb: number;
    mem_percent: number;
    disk_used_gb: number;
    disk_total_gb: number;
    disk_percent: number;
}

export interface PublishMetrics {
    count: number;
    max: number;
}

export interface ContainerMetricsEntry {
    user_id: string;
    course_id: number;
    cpu_percent: number;
    mem_mb: number;
}

export interface SystemMetricsSnapshot {
    host: HostMetrics;
    published: PublishMetrics;
    containers: ContainerMetricsEntry[];
}

// 切断時の再接続間隔。ライブセッション同期系のフック(useLiveEditorChannel等)
// は「ベストエフォート・自動再接続なし」だが、こちらはリソース監視という
// 性質上、教師がダッシュボードを開いている間はできるだけ切れ目なく見え続けて
// ほしいため、軽い間隔で再接続を試みる。
const RECONNECT_DELAY_MS = 5000;

// リソース使用状況ダッシュボード(教師専用、TeacherDashboardModal.tsx)の
// WebSocket接続。バックエンド(MetricsWebSocket、2秒おきにブロードキャスト)
// が送るスナップショットをそのまま状態に反映するだけの薄いフック - シェル/
// LSP/ライブセッションと同じ理由(ブラウザのWebSocket APIはAuthorization
// ヘッダーを付けられない)で、専用の短命チケット(IssueMetricsTicket)を先に
// 取得してから接続する。
export function useSystemMetrics(enabled: boolean) {
    const [snapshot, setSnapshot] = useState<SystemMetricsSnapshot | null>(null);
    const [connected, setConnected] = useState(false);

    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        let ws: WebSocket | null = null;
        let retryTimer: number | null = null;

        const scheduleRetry = () => {
            if (cancelled || retryTimer !== null) return;
            retryTimer = window.setTimeout(() => {
                retryTimer = null;
                connect();
            }, RECONNECT_DELAY_MS);
        };

        const connect = async () => {
            if (cancelled) return;
            try {
                const res = await securedFetch('/api/v2/admin/metrics/ticket', { method: 'POST' });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.ticket || cancelled) {
                    scheduleRetry();
                    return;
                }

                const wsBase = API_URL.replace(/^http/, 'ws');
                const socket = new WebSocket(`${wsBase}/api/v2/admin/metrics/ws?ticket=${encodeURIComponent(data.ticket)}`);
                ws = socket;

                socket.onopen = () => {
                    if (!cancelled) setConnected(true);
                };
                socket.onmessage = (event) => {
                    if (typeof event.data !== 'string') return;
                    try {
                        setSnapshot(JSON.parse(event.data) as SystemMetricsSnapshot);
                    } catch {
                        // 壊れたメッセージは無視する。
                    }
                };
                const handleDisconnect = () => {
                    if (cancelled) return;
                    setConnected(false);
                    scheduleRetry();
                };
                socket.onclose = handleDisconnect;
                socket.onerror = handleDisconnect;
            } catch {
                scheduleRetry();
            }
        };

        connect();

        return () => {
            cancelled = true;
            if (retryTimer !== null) window.clearTimeout(retryTimer);
            ws?.close();
            ws = null;
            setConnected(false);
        };
    }, [enabled]);

    return { snapshot, connected };
}
