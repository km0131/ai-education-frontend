'use client';

import React, { useEffect, useState } from 'react';

export interface ProgramContainer {
    name: string;
    container_name: string;
    student_name: string;
    status: string; // "running" | "stopped"
    published: boolean;
    // publish_url/publish_expires_at: バックエンド(ListProgramContainers、
    // internal/handler/program_handler.go)が単一サブドメイン公開機能
    // (NextPlan.md フェーズ7)のために付与する。published=falseの間は
    // publish_urlが空文字列/publish_expires_atがゼロ値になる - 必ず
    // publishedを先に見てから使うこと。
    publish_url: string;
    publish_expires_at: string;
    // last_active_at: 教師ダッシュボード(TeacherDashboardModal.tsx)の稼働状況
    // 表示に使う(idle_sandbox_service.goのアイドルタイムアウト判定と同じ値)。
    last_active_at: string;
    // user_id: 教師ダッシュボードが個別の公開停止操作の対象を指定するのに
    // 使う(POST /api/v2/program/teacher/unpublish)。
    user_id: string;
    // locked/locked_reason: 教師ダッシュボードの安全対策(緊急停止/再開ロック)。
    // locked=trueの間、生徒本人はこのコンテナを再開できない
    // (バックエンドのProgramSandbox.Lockedと対応)。
    locked: boolean;
    locked_reason: string;
    is_mine: boolean;
}

interface ContainerCardProps {
    container: ProgramContainer;
    onResume: () => void;
    onStop: () => void;
    onDelete: () => void;
    onOpenWorkspace: () => void;
    // onOpenPeerView: 生徒間でのリアルタイム相互閲覧(Peer Viewer、読み取り
    // 専用)。他の生徒(is_mine=false)のカードをクリックした時に呼ぶ
    // (handleCardClick参照) - 実行中のコンテナのみ閲覧できる。
    onOpenPeerView: () => void;
    isBusy: boolean;
}

// ミリ秒の残り時間を「23時間45分」のような表示に整形する。
// src/components/workspace/PublishPanel.tsxのformatRemainingと同じ考え方だが、
// このカードはIDEワークスペース(src/components/workspace/)とは別のページ
// (クラス画面のコンテナ一覧)に属するため、あえて依存を作らずローカルに
// 複製している(小さい純粋関数のため重複コストは低い)。
function formatRemaining(ms: number): string {
    if (ms <= 0) return 'まもなく終了';
    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) return `残り${hours}時間${minutes}分`;
    return `残り${minutes}分`;
}

export const ContainerCard: React.FC<ContainerCardProps> = ({
    container,
    onResume,
    onStop,
    onDelete,
    onOpenWorkspace,
    onOpenPeerView,
    isBusy,
}) => {
    const isRunning = container.status === 'running';
    const isPublished = container.published && Boolean(container.publish_url);
    const themeBg = 'bg-indigo-600';
    // 実行中の自分のコンテナのみ、ワークスペース(VS Code風の統合Web IDE画面)を開ける
    const canOpenWorkspace = container.is_mine && isRunning;

    const [copied, setCopied] = useState(false);
    const [now, setNow] = useState(() => Date.now());

    // 残り公開時間のリアルタイム表示 - サーバーへ問い合わせ直すのではなく、
    // 取得済みのpublish_expires_atから1秒ごとにクライアント側で再計算するだけ。
    useEffect(() => {
        if (!isPublished) return;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [isPublished]);

    const remainingMs = isPublished ? new Date(container.publish_expires_at).getTime() - now : 0;

    // クラスメイト(is_mine=false)のカードは、実行中であればクリックで
    // 閲覧モード(Peer Viewer、読み取り専用)を開く - 公開サイトを直接開く
    // 導線は引き続きカード内の「🌐 Webサイトを開く」ボタン(stopPropagation
    // 済み)から行える。自分のカードの挙動(公開URL/ワークスペースを開く)は
    // 変更しない。
    const handleCardClick = () => {
        if (!container.is_mine) {
            if (isRunning) onOpenPeerView();
            return;
        }
        if (isPublished) {
            window.open(container.publish_url, '_blank', 'noopener,noreferrer');
            return;
        }
        if (canOpenWorkspace) onOpenWorkspace();
    };

    const handleCopyUrl = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!navigator.clipboard) return;
        navigator.clipboard.writeText(container.publish_url).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        });
    };

    return (
        <div
            onClick={handleCardClick}
            className={`group bg-white rounded-3xl border border-gray-100 overflow-hidden hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 flex flex-col h-76 relative ${
                (container.is_mine && (isPublished || canOpenWorkspace)) || (!container.is_mine && isRunning)
                    ? 'cursor-pointer'
                    : ''
            }`}
            title={!container.is_mine && !isRunning ? '実行中の環境のみ閲覧できます' : undefined}
        >
            {/* カードヘッダー */}
            <div className={`${themeBg} h-28 p-5 relative flex flex-col justify-between text-white`}>
                <h3 className="text-xl font-black truncate pr-16">{container.name || '無題の環境'}</h3>
                <p className="text-xs font-bold opacity-90 truncate">作った人: {container.student_name || 'わからない'}</p>
            </div>

            {/* 作成者アイコン風バッジ */}
            <div className="absolute top-20 right-4 w-14 h-14 bg-white rounded-full p-1 shadow-md z-10">
                <div className={`${themeBg} w-full h-full rounded-full flex items-center justify-center text-white text-xl font-black opacity-95`}>
                    {container.student_name ? container.student_name.charAt(0) : 'W'}
                </div>
            </div>

            {/* コンテンツ */}
            <div className="p-5 pt-8 flex-1 flex flex-col justify-between">
                <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                        <span className="text-[11px] text-gray-400 font-bold">状態:</span>
                        <span className={`text-xs px-2.5 py-0.5 rounded-full font-black ${
                            isRunning
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-gray-100 text-gray-600 border border-gray-200'
                        }`}>
                            {isRunning ? '🟢 実行中' : '⏸ 停止中'}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-[11px] text-gray-400 font-bold">公開:</span>
                        <span className={`text-xs px-2.5 py-0.5 rounded-full font-black ${
                            isPublished
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : 'bg-gray-100 text-gray-500 border border-gray-200'
                        }`}>
                            {isPublished ? '🌐 公開中' : '非公開'}
                        </span>
                    </div>

                    {isPublished && (
                        <>
                            <div className="flex items-center gap-1.5">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        window.open(container.publish_url, '_blank', 'noopener,noreferrer');
                                    }}
                                    className="flex items-center gap-1 text-xs font-black text-blue-600 hover:text-blue-800 hover:underline"
                                >
                                    🌐 Webサイトを開く ↗
                                </button>
                                <button
                                    onClick={handleCopyUrl}
                                    title="公開URLをコピー"
                                    className="text-gray-400 hover:text-gray-600 transition-colors"
                                >
                                    {copied ? '✅' : '📋'}
                                </button>
                            </div>
                            <div className="text-xs text-gray-500 font-bold">
                                ⏱️ {formatRemaining(remainingMs)}
                            </div>
                        </>
                    )}

                    {/* 生徒間でのリアルタイム相互閲覧(Peer Viewer)。クリックで
                        読み取り専用の閲覧モードが開けることを知らせる。 */}
                    {!container.is_mine && isRunning && (
                        <div className="text-xs text-indigo-500 font-bold">
                            👁️ クリックしてコードを閲覧
                        </div>
                    )}

                    {/* 安全対策: 先生が緊急停止+ロックした状態。本人には再開できない
                        理由が分かるよう明示する。 */}
                    {container.locked && (
                        <div
                            className="text-xs px-2.5 py-1 rounded-lg bg-red-50 text-red-700 border border-red-200 font-bold"
                            title={container.locked_reason || undefined}
                        >
                            🔒 先生によりロックされています
                        </div>
                    )}
                </div>
            </div>

            {/* フッター: 自分のコンテナにだけ操作ボタンを出す */}
            {container.is_mine && (
                <div className="px-5 py-4 border-t border-gray-50 flex flex-wrap justify-end gap-2 bg-gray-50/30 relative z-20">
                    {!isRunning && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onResume();
                            }}
                            disabled={isBusy || container.locked}
                            title={container.locked ? '先生によりロックされているため再開できません' : undefined}
                            className="px-3 py-1.5 bg-white border border-gray-200 shadow-sm rounded-xl text-xs font-black text-gray-600 hover:bg-gray-50 hover:text-emerald-600 disabled:opacity-40 transition-all"
                        >
                            再開
                        </button>
                    )}
                    {isRunning && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onOpenWorkspace();
                            }}
                            disabled={isBusy}
                            className="px-3 py-1.5 bg-slate-900 border border-slate-900 shadow-sm rounded-xl text-xs font-black text-white hover:bg-slate-700 disabled:opacity-40 transition-all"
                        >
                            ワークスペースを開く
                        </button>
                    )}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onStop();
                        }}
                        disabled={isBusy || !isRunning || isPublished}
                        title={isPublished ? '公開中のコンテナは停止できません。先にIDE画面で公開を停止してください。' : undefined}
                        className="px-3 py-1.5 bg-white border border-gray-200 shadow-sm rounded-xl text-xs font-black text-gray-600 hover:bg-gray-50 hover:text-indigo-600 disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-gray-600 transition-all"
                    >
                        停止
                    </button>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete();
                        }}
                        disabled={isBusy || isPublished}
                        title={isPublished ? '公開中のコンテナは削除できません。先にIDE画面で公開を停止してください。' : undefined}
                        className="px-3 py-1.5 bg-white border border-red-200 shadow-sm rounded-xl text-xs font-black text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:hover:bg-white transition-all"
                    >
                        削除
                    </button>
                </div>
            )}
        </div>
    );
};
