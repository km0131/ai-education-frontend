'use client';

import React, { useEffect, useState } from 'react';
import { securedFetch } from '@/src/lib/api';
import { ProgramContainer } from './ContainerCard';
import { TeacherLiveSessionModal } from './TeacherLiveSessionModal';
import { useSystemMetrics } from './useSystemMetrics';

// リソース使用状況ダッシュボード(ホスト・個別コンテナ・公開数の可視化):
// この値を超えたCPU使用率を「高負荷」とみなし、カードへの警告表示・枠の
// 強調に使う(タスク要件の「CPU 90%超えの無限ループ疑い」の例に合わせる)。
const HIGH_CPU_THRESHOLD = 90;

// ホスト全体のCPU/メモリ/ディスク使用率バー。80%超で黄色、90%超で赤色に
// なる(タスク要件通り)。
function MetricBar({ label, percent }: { label: string; percent: number }) {
    const clamped = Math.min(100, Math.max(0, percent));
    const barColor = clamped > 90 ? 'bg-red-500' : clamped > 80 ? 'bg-amber-400' : 'bg-emerald-500';
    const textColor = clamped > 90 ? 'text-red-600' : clamped > 80 ? 'text-amber-600' : 'text-gray-500';
    return (
        <div className="flex items-center gap-2 min-w-[160px]">
            <span className="text-[11px] font-black text-gray-500 w-9 shrink-0">{label}</span>
            <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                <div className={`h-full ${barColor} transition-all`} style={{ width: `${clamped}%` }} />
            </div>
            <span className={`text-[11px] font-black w-10 text-right ${textColor}`}>{percent.toFixed(0)}%</span>
        </div>
    );
}

interface TeacherDashboardModalProps {
    isOpen: boolean;
    onClose: () => void;
    classId: string;
    containers: ProgramContainer[];
    // アクション成功後に一覧を再取得させる(SubRoomClient.fetchContainers) -
    // このモーダル自身はcontainers状態を持たず、常に親から渡された最新値を
    // そのまま表示する。
    onRefresh: () => void | Promise<void>;
}

// 残り公開時間を「23時間45分」のように整形する
// (ContainerCard.tsx/src/components/workspace/PublishPanel.tsxと同じ考え方)。
function formatRemaining(ms: number): string {
    if (ms <= 0) return 'まもなく終了';
    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) return `残り${hours}時間${minutes}分`;
    return `残り${minutes}分`;
}

// 最終アクティビティを「3分前」「2時間前」「5日前」のような相対表示に整形する。
function formatRelative(iso: string, now: number): string {
    const ms = now - new Date(iso).getTime();
    if (ms < 0 || Number.isNaN(ms)) return '-';
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1) return 'たった今';
    if (minutes < 60) return `${minutes}分前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}時間前`;
    const days = Math.floor(hours / 24);
    return `${days}日前`;
}

// 教師ダッシュボード: 今このクラスの生徒サンドボックス一覧を、カード表示
// (生徒本人向け、ContainerCard.tsx)とは別に、先生が一目で稼働状況を把握
// できる表形式でまとめて見せるパネル。閲覧に加えて、個別の公開停止・
// コンテナ一括停止・公開一括停止という3つの操作を行える(いずれも
// バックエンド側でこのクラスの担当教師本人であることを再確認する、
// teacher_dashboard_handler.go参照)。
export function TeacherDashboardModal({ isOpen, onClose, classId, containers, onRefresh }: TeacherDashboardModalProps) {
    const [now, setNow] = useState(() => Date.now());
    const [busyAction, setBusyAction] = useState<string | null>(null); // 実行中の操作名(個別: container_name、一括: 'stop-all'/'unpublish-all')
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    // 講師による生徒セッションのリアルタイム監視・共同操作(ライブセッション
    // 同期)。「セッションに参加」ボタンで対象の生徒を選び、
    // TeacherLiveSessionModalを開く。
    const [liveSessionTarget, setLiveSessionTarget] = useState<{ userId: string; name: string } | null>(null);

    // リソース使用状況ダッシュボード(ホスト・個別コンテナ・公開数の可視化)。
    // モーダルを開いている間だけ接続する(閉じている間は無駄なWebSocketを
    // 張らない)。
    const { snapshot: metrics } = useSystemMetrics(isOpen);

    useEffect(() => {
        if (!isOpen) return;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [isOpen]);

    // モーダルを開き直すたびに前回の結果メッセージをクリアする。
    useEffect(() => {
        if (isOpen) setMessage(null);
    }, [isOpen]);

    if (!isOpen) return null;

    const runningCount = containers.filter((c) => c.status === 'running').length;
    const publishedCount = containers.filter((c) => c.published && c.publish_url).length;

    const postTeacherAction = async (path: string, body: Record<string, unknown>) => {
        const res = await securedFetch(`/api/v2/program/teacher/${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ course_id: Number(classId), ...body }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || '操作に失敗しました');
        return data;
    };

    const handleUnpublishOne = async (c: ProgramContainer) => {
        setBusyAction(c.container_name);
        setMessage(null);
        try {
            await postTeacherAction('unpublish', { user_id: c.user_id });
            setMessage({ type: 'success', text: `${c.student_name || 'この生徒'}の公開を停止しました` });
            await onRefresh();
        } catch (err) {
            setMessage({ type: 'error', text: err instanceof Error ? err.message : '公開の停止に失敗しました' });
        } finally {
            setBusyAction(null);
        }
    };

    // 教師ダッシュボードからの再開。ロック中でも実行できる(ロックは生徒
    // 本人の再開だけを防ぐためのもの) - 事情確認のために教師が一時的に
    // 起動する、といった運用を想定している。
    const handleResume = async (c: ProgramContainer) => {
        setBusyAction(c.container_name);
        setMessage(null);
        try {
            await postTeacherAction('resume', { user_id: c.user_id });
            setMessage({ type: 'success', text: `${c.student_name || 'この生徒'}のコンテナを再開しました` });
            await onRefresh();
        } catch (err) {
            setMessage({ type: 'error', text: err instanceof Error ? err.message : '再開に失敗しました' });
        } finally {
            setBusyAction(null);
        }
    };

    // 安全対策: 緊急停止(docker kill、シャットダウンの猶予を与えない強制終了)。
    // 生徒がコンテナ内で悪質な操作をしている場合に即座に止める。
    const handleEmergencyStop = async (c: ProgramContainer) => {
        if (!confirm(`${c.student_name || 'この生徒'}のコンテナを緊急停止します(強制終了、保存されていない作業内容は失われます)。よろしいですか？`)) {
            return;
        }
        setBusyAction(c.container_name);
        setMessage(null);
        try {
            await postTeacherAction('emergency-stop', { user_id: c.user_id });
            setMessage({ type: 'success', text: `${c.student_name || 'この生徒'}のコンテナを緊急停止しました` });
            await onRefresh();
        } catch (err) {
            setMessage({ type: 'error', text: err instanceof Error ? err.message : '緊急停止に失敗しました' });
        } finally {
            setBusyAction(null);
        }
    };

    // 安全対策: 再開ロック。ロック中は生徒本人がコンテナを再開できなくなる
    // (バックエンドのResumeProgramContainerが弾く)。解除も先生のみ行える。
    const handleToggleLock = async (c: ProgramContainer) => {
        let reason = '';
        if (!c.locked) {
            reason = window.prompt('ロックする理由を入力してください(任意、生徒には表示されません)', '') ?? '';
        } else if (!confirm(`${c.student_name || 'この生徒'}のロックを解除します。よろしいですか？`)) {
            return;
        }
        setBusyAction(c.container_name);
        setMessage(null);
        try {
            await postTeacherAction('lock', { user_id: c.user_id, locked: !c.locked, reason });
            setMessage({
                type: 'success',
                text: c.locked
                    ? `${c.student_name || 'この生徒'}のロックを解除しました`
                    : `${c.student_name || 'この生徒'}をロックしました(再開できなくなります)`,
            });
            await onRefresh();
        } catch (err) {
            setMessage({ type: 'error', text: err instanceof Error ? err.message : 'ロック状態の変更に失敗しました' });
        } finally {
            setBusyAction(null);
        }
    };

    const handleUnpublishAll = async () => {
        if (publishedCount === 0) return;
        if (!confirm(`公開中の${publishedCount}件をすべて非公開にします。よろしいですか？`)) return;
        setBusyAction('unpublish-all');
        setMessage(null);
        try {
            const data = await postTeacherAction('unpublish-all', {});
            setMessage({ type: 'success', text: `${data.count ?? 0}件の公開を停止しました` });
            await onRefresh();
        } catch (err) {
            setMessage({ type: 'error', text: err instanceof Error ? err.message : '一括公開停止に失敗しました' });
        } finally {
            setBusyAction(null);
        }
    };

    const handleStopAll = async () => {
        if (runningCount === 0) return;
        if (!confirm(`実行中の${runningCount}件をすべて停止します。保存されていない作業内容は失われる可能性があります。よろしいですか？`)) return;
        setBusyAction('stop-all');
        setMessage(null);
        try {
            const data = await postTeacherAction('stop-all', {});
            const skipped = data.skipped_published ?? 0;
            const failed = data.failed ?? 0;
            const parts = [`${data.stopped ?? 0}件停止しました`];
            if (skipped > 0) parts.push(`公開中のため${skipped}件はスキップしました`);
            if (failed > 0) parts.push(`${failed}件は失敗しました`);
            setMessage({ type: failed > 0 ? 'error' : 'success', text: parts.join('。') });
            await onRefresh();
        } catch (err) {
            setMessage({ type: 'error', text: err instanceof Error ? err.message : '一括停止に失敗しました' });
        } finally {
            setBusyAction(null);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}></div>

            <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-4xl z-10 overflow-hidden animate-in zoom-in-95 duration-300 border border-gray-100">
                {/* ヘッダー */}
                <div className="bg-indigo-600 p-8 flex justify-between items-center text-white">
                    <div>
                        <h3 className="text-2xl font-black">教師ダッシュボード</h3>
                        <p className="text-xs text-indigo-100 mt-1">生徒サンドボックス一覧・稼働状況(先生専用)</p>
                    </div>
                    <button type="button" onClick={onClose} className="hover:bg-white/20 p-2 rounded-full transition-all">
                        ✕
                    </button>
                </div>

                {/* リソース使用状況ダッシュボード(ホスト全体): CPU/メモリ/
                    ディスク使用率バー。80%超で黄色、90%超で赤色に変わる。 */}
                {metrics && (
                    <div className="px-8 pt-6 flex flex-wrap items-center gap-x-6 gap-y-2">
                        <MetricBar label="CPU" percent={metrics.host.cpu_percent} />
                        <MetricBar label="RAM" percent={metrics.host.mem_percent} />
                        <MetricBar label="Disk" percent={metrics.host.disk_percent} />
                    </div>
                )}

                {/* サマリー & 一括操作 */}
                <div className={`px-8 flex flex-wrap items-center gap-3 ${metrics ? 'pt-3' : 'pt-6'}`}>
                    <span className="text-xs font-black px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200">
                        🟢 稼働中 {runningCount} / {containers.length}
                    </span>
                    <span className="text-xs font-black px-3 py-1.5 rounded-xl bg-blue-50 text-blue-700 border border-blue-200">
                        🌐 Web公開中: {metrics ? metrics.published.count : publishedCount}
                        {metrics ? ` / ${metrics.published.max}台` : '件'}
                    </span>
                    <div className="flex-1" />
                    <button
                        type="button"
                        onClick={handleUnpublishAll}
                        disabled={busyAction !== null || publishedCount === 0}
                        className="px-3 py-1.5 bg-white border border-blue-200 shadow-sm rounded-xl text-xs font-black text-blue-700 hover:bg-blue-50 disabled:opacity-40 disabled:hover:bg-white transition-all"
                    >
                        {busyAction === 'unpublish-all' ? '処理中...' : '🌐 公開を一括停止'}
                    </button>
                    <button
                        type="button"
                        onClick={handleStopAll}
                        disabled={busyAction !== null || runningCount === 0}
                        className="px-3 py-1.5 bg-white border border-gray-200 shadow-sm rounded-xl text-xs font-black text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white transition-all"
                    >
                        {busyAction === 'stop-all' ? '処理中...' : '⏸ コンテナを一括停止'}
                    </button>
                </div>

                {message && (
                    <div
                        className={`mx-8 mt-4 px-4 py-2 rounded-xl text-xs font-black ${
                            message.type === 'success'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-red-50 text-red-700 border border-red-200'
                        }`}
                    >
                        {message.text}
                    </div>
                )}

                {/* 一覧 */}
                <div className="p-8 pt-4 overflow-y-auto max-h-[60vh]">
                    {containers.length === 0 ? (
                        <p className="text-center text-gray-400 font-bold py-10">まだこのクラスにコンテナがありません</p>
                    ) : (
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-[11px] text-gray-400 font-black uppercase tracking-wider border-b border-gray-100">
                                    <th className="py-2 pr-4">生徒</th>
                                    <th className="py-2 pr-4">状態</th>
                                    <th className="py-2 pr-4">公開状況</th>
                                    <th className="py-2 pr-4">リソース</th>
                                    <th className="py-2 pr-4">最終アクティビティ</th>
                                    <th className="py-2 pr-4">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {containers.map((c) => {
                                    const isPublished = c.published && Boolean(c.publish_url);
                                    const remainingMs = isPublished ? new Date(c.publish_expires_at).getTime() - now : 0;
                                    const isBusy = busyAction === c.container_name;
                                    // リソース使用状況ダッシュボード: 稼働中コンテナのみDocker統計に
                                    // 現れる(CollectSystemMetricsがstatus='running'のみ対象とする
                                    // ため) - user_id + course_idの組で一致させる(同じ生徒が別の
                                    // コースにもコンテナを持ち得るため)。
                                    const resourceMetrics = metrics?.containers.find(
                                        (m) => m.user_id === c.user_id && m.course_id === Number(classId),
                                    );
                                    const isHighLoad = !!resourceMetrics && resourceMetrics.cpu_percent > HIGH_CPU_THRESHOLD;
                                    return (
                                        <tr
                                            key={c.container_name}
                                            className={`border-b border-gray-50 last:border-0 ${
                                                isHighLoad ? 'bg-red-50 ring-2 ring-inset ring-red-400 animate-pulse' : ''
                                            }`}
                                        >
                                            <td className="py-3 pr-4 font-bold text-gray-800">
                                                {c.student_name || 'わからない'}
                                                <div className="text-[11px] text-gray-400 font-normal">{c.name || '無題の環境'}</div>
                                            </td>
                                            <td className="py-3 pr-4">
                                                <span
                                                    className={`text-xs px-2.5 py-0.5 rounded-full font-black ${
                                                        c.status === 'running'
                                                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                                            : 'bg-gray-100 text-gray-600 border border-gray-200'
                                                    }`}
                                                >
                                                    {c.status === 'running' ? '🟢 実行中' : '⏸ 停止中'}
                                                </span>
                                                {c.locked && (
                                                    <span
                                                        className="ml-1.5 text-xs px-2 py-0.5 rounded-full font-black bg-amber-50 text-amber-700 border border-amber-200"
                                                        title={c.locked_reason || undefined}
                                                    >
                                                        🔒 ロック中
                                                    </span>
                                                )}
                                            </td>
                                            <td className="py-3 pr-4">
                                                {isPublished ? (
                                                    <div className="flex flex-col gap-0.5">
                                                        <a
                                                            href={c.publish_url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-xs font-black text-blue-600 hover:underline"
                                                        >
                                                            🌐 公開中 ↗
                                                        </a>
                                                        <span className="text-[11px] text-gray-400">
                                                            ⏱️ {formatRemaining(remainingMs)}
                                                        </span>
                                                    </div>
                                                ) : (
                                                    <span className="text-xs text-gray-400 font-bold">非公開</span>
                                                )}
                                            </td>
                                            <td className="py-3 pr-4">
                                                {resourceMetrics ? (
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="text-[11px] font-bold text-gray-600 whitespace-nowrap">
                                                            💻 CPU: {resourceMetrics.cpu_percent.toFixed(0)}% | 🧠 RAM:{' '}
                                                            {resourceMetrics.mem_mb.toFixed(0)}MB
                                                        </span>
                                                        {isHighLoad && (
                                                            <span className="text-[11px] font-black text-red-600">
                                                                ⚠️ 高負荷検出
                                                            </span>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-[11px] text-gray-300">-</span>
                                                )}
                                            </td>
                                            <td className="py-3 pr-4 text-gray-500 text-xs">
                                                {c.last_active_at ? formatRelative(c.last_active_at, now) : '-'}
                                            </td>
                                            <td className="py-3 pr-4">
                                                <div className="flex flex-wrap items-center gap-1.5 max-w-[260px]">
                                                    {c.status !== 'running' && (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleResume(c)}
                                                            disabled={busyAction !== null}
                                                            title={c.locked ? 'ロック中でも教師は再開できます(生徒本人の再開は引き続きできません)' : undefined}
                                                            className="px-2.5 py-1 bg-white border border-emerald-200 shadow-sm rounded-lg text-[11px] font-black text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 disabled:hover:bg-white transition-all"
                                                        >
                                                            ▶ 再開
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={() => setLiveSessionTarget({ userId: c.user_id, name: c.student_name })}
                                                        disabled={c.status !== 'running'}
                                                        title={c.status !== 'running' ? '稼働中のコンテナのみ参加できます' : undefined}
                                                        className="px-2.5 py-1 bg-white border border-indigo-200 shadow-sm rounded-lg text-[11px] font-black text-indigo-600 hover:bg-indigo-50 disabled:opacity-40 disabled:hover:bg-white transition-all"
                                                    >
                                                        🔴 セッションに参加
                                                    </button>
                                                    {isPublished && (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleUnpublishOne(c)}
                                                            disabled={busyAction !== null}
                                                            className="px-2.5 py-1 bg-white border border-red-200 shadow-sm rounded-lg text-[11px] font-black text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:hover:bg-white transition-all"
                                                        >
                                                            {isBusy ? '処理中...' : '公開停止'}
                                                        </button>
                                                    )}
                                                    {/* 安全対策: 緊急停止(docker kill)/再開ロック。生徒が悪質な
                                                        操作をした場合の対応用。 */}
                                                    <button
                                                        type="button"
                                                        onClick={() => handleEmergencyStop(c)}
                                                        disabled={busyAction !== null || c.status !== 'running'}
                                                        title={c.status !== 'running' ? '稼働中のコンテナのみ緊急停止できます' : '強制終了(docker kill)します'}
                                                        className="px-2.5 py-1 bg-red-600 border border-red-600 shadow-sm rounded-lg text-[11px] font-black text-white hover:bg-red-700 disabled:opacity-40 disabled:hover:bg-red-600 transition-all"
                                                    >
                                                        🚨 緊急停止
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleToggleLock(c)}
                                                        disabled={busyAction !== null}
                                                        title={
                                                            c.locked
                                                                ? 'ロックを解除すると生徒本人が再開できるようになります'
                                                                : 'ロックすると生徒本人が再開できなくなります'
                                                        }
                                                        className={`px-2.5 py-1 shadow-sm rounded-lg text-[11px] font-black disabled:opacity-40 transition-all border ${
                                                            c.locked
                                                                ? 'bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100'
                                                                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                                        }`}
                                                    >
                                                        {c.locked ? '🔓 ロック解除' : '🔒 ロック'}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

            <TeacherLiveSessionModal
                isOpen={liveSessionTarget !== null}
                onClose={() => setLiveSessionTarget(null)}
                classId={classId}
                studentUserId={liveSessionTarget?.userId ?? ''}
                studentName={liveSessionTarget?.name ?? ''}
            />
        </div>
    );
}
