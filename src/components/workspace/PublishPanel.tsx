'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { securedFetch } from '@/src/lib/api';
import { Icon } from './Icon';

interface PublishPanelProps {
    classId: string;
    // onMutated/refreshSignal: WorkspaceLayoutのworkspace-refresh同期の一部
    // (Sidebar.tsx参照)。onMutatedは公開/公開停止/延長成功時に'publish'と
    // して呼ぶ。
    onMutated?: (reason: 'git' | 'file' | 'publish') => void;
    refreshSignal?: number;
}

interface PublishStatus {
    published: boolean;
    slug?: string;
    url?: string;
    port?: number;
    expiresAt?: string; // ISO文字列(バックエンドのtime.Time JSON表現)
}

// ミリ秒の残り時間を「23時間45分」のような表示に整形する。0以下は
// 「まもなく終了」(自動失効スケジューラが1分おきにしか降格させないため、
// 期限を過ぎた直後の一瞬だけこの表示になり得る)。
function formatRemaining(ms: number): string {
    if (ms <= 0) return 'まもなく終了';
    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) return `残り${hours}時間${minutes}分`;
    return `残り${minutes}分`;
}

// 単一サブドメイン(preview.a-kiis.com)パスベース公開機能(NextPlan.md
// フェーズ7)の生徒向け管理パネル。Sidebarの他のタブ(GitPanel/HistoryPanel)
// と同じ構成 - 公開URL・残り公開時間のリアルタイム表示・「公開を停止する」
// 「公開期間を延長する」ボタンをここに集約する。
export function PublishPanel({ classId, onMutated, refreshSignal }: PublishPanelProps) {
    const [status, setStatus] = useState<PublishStatus | null>(null);
    const [portInput, setPortInput] = useState('5000');
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [now, setNow] = useState(() => Date.now());

    const loadStatus = useCallback(async () => {
        try {
            const res = await securedFetch(
                `/api/v2/program/container/publish-status?course_id=${encodeURIComponent(classId)}`,
            );
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || '公開状態の取得に失敗しました');
            setStatus({
                published: Boolean(data.published),
                slug: data.slug,
                url: data.url,
                port: data.port,
                expiresAt: data.expires_at,
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : '公開状態の取得に失敗しました');
        } finally {
            setIsLoading(false);
        }
    }, [classId]);

    useEffect(() => {
        loadStatus();
    }, [loadStatus]);

    // refreshSignal: 相手側(講師/生徒)の操作によるworkspace-refresh受信時に
    // 公開状態を再取得する。初回マウント分は上のloadStatus効果と重複する
    // のでスキップする。
    const isFirstRefreshSignal = useRef(true);
    useEffect(() => {
        if (isFirstRefreshSignal.current) {
            isFirstRefreshSignal.current = false;
            return;
        }
        loadStatus();
    }, [refreshSignal, loadStatus]);

    // 残り時間表示をリアルタイムに更新する - サーバーへ問い合わせ直すのでは
    // なく、取得済みのexpiresAtから1秒ごとにクライアント側で再計算するだけ。
    useEffect(() => {
        if (!status?.published) return;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [status?.published]);

    const handlePublish = async () => {
        const port = Number(portInput);
        if (!Number.isFinite(port) || port <= 0 || port > 65535) {
            setError('ポート番号が不正です');
            return;
        }
        setIsSubmitting(true);
        setError(null);
        try {
            const res = await securedFetch('/api/v2/program/container/publish', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ course_id: Number(classId), port }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || '公開の開始に失敗しました');
            setStatus({ published: true, slug: data.slug, url: data.url, port, expiresAt: data.expires_at });
            onMutated?.('publish');
        } catch (err) {
            setError(err instanceof Error ? err.message : '公開の開始に失敗しました');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleUnpublish = async () => {
        setIsSubmitting(true);
        setError(null);
        try {
            const res = await securedFetch('/api/v2/program/container/unpublish', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ course_id: Number(classId) }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || '公開の停止に失敗しました');
            setStatus({ published: false });
            onMutated?.('publish');
        } catch (err) {
            setError(err instanceof Error ? err.message : '公開の停止に失敗しました');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleExtend = async () => {
        setIsSubmitting(true);
        setError(null);
        try {
            const res = await securedFetch('/api/v2/program/container/publish/extend', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ course_id: Number(classId) }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || '公開期間の延長に失敗しました');
            setStatus((prev) => (prev ? { ...prev, expiresAt: data.expires_at } : prev));
            onMutated?.('publish');
        } catch (err) {
            setError(err instanceof Error ? err.message : '公開期間の延長に失敗しました');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex flex-col h-full text-[#cccccc]">
                <div className="px-3 py-2 text-[11px] font-bold tracking-wider text-[#bbbbbb] uppercase shrink-0">公開</div>
                <div className="px-3 pb-2 text-xs text-[#8a8a8a]">読み込み中...</div>
            </div>
        );
    }

    const remainingMs = status?.expiresAt ? new Date(status.expiresAt).getTime() - now : 0;

    return (
        <div className="flex flex-col h-full text-[#cccccc]">
            <div className="px-3 py-2 text-[11px] font-bold tracking-wider text-[#bbbbbb] uppercase shrink-0">公開</div>

            {!status?.published && (
                <>
                    <div className="px-3 pb-2 text-xs text-[#8a8a8a]">
                        アプリが実際にlistenしているポート番号を指定して公開します
                        (例: Flaskなら5000)。
                    </div>
                    <div className="px-3 pb-2">
                        <label className="block text-[11px] text-[#8a8a8a] mb-1">ポート番号</label>
                        <input
                            value={portInput}
                            onChange={(e) => setPortInput(e.target.value)}
                            placeholder="5000"
                            inputMode="numeric"
                            className="w-full rounded-md bg-[#3c3c3c] text-[#ffffff] text-xs px-2 py-1.5 placeholder:text-[#6a6a6a] border border-[#3c3c3c] focus:outline-none focus:border-[#007acc]"
                        />
                    </div>
                    <div className="px-3 pb-2">
                        <button
                            onClick={handlePublish}
                            disabled={isSubmitting}
                            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md bg-[#238636] hover:bg-[#2ea043] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold transition-colors"
                        >
                            <Icon name="broadcast" />
                            {isSubmitting ? '公開中...' : '公開する'}
                        </button>
                    </div>
                </>
            )}

            {status?.published && (
                <>
                    <div className="px-3 pb-2">
                        <div className="text-[11px] text-[#8a8a8a] mb-1">公開URL</div>
                        <a
                            href={status.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-xs text-[#3794ff] hover:underline break-all"
                        >
                            {status.url}
                        </a>
                    </div>
                    <div className="px-3 pb-2 flex items-center gap-1.5 text-xs text-[#cccccc]">
                        <Icon name="watch" className="text-[#cca700]" />
                        {formatRemaining(remainingMs)}
                    </div>
                    <div className="px-3 pb-2 flex flex-col gap-1.5">
                        <button
                            onClick={handleExtend}
                            disabled={isSubmitting}
                            className="w-full py-1.5 rounded-md bg-[#0e639c] hover:bg-[#1177bb] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold transition-colors"
                        >
                            公開期間を延長する
                        </button>
                        <button
                            onClick={handleUnpublish}
                            disabled={isSubmitting}
                            className="w-full py-1.5 rounded-md bg-[#3c3c3c] hover:bg-[#4a4a4a] disabled:opacity-40 disabled:cursor-not-allowed text-[#cccccc] text-xs font-bold transition-colors"
                        >
                            公開を停止する
                        </button>
                    </div>
                </>
            )}

            {error && (
                <div className="px-3 pb-3 text-[11px] font-bold text-[#f44747]">
                    <Icon name="warning" /> {error}
                </div>
            )}
        </div>
    );
}
