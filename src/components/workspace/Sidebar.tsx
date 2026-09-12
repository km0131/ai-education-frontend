'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FileExplorerPane } from './FileExplorerPane';
import { HistoryPanel } from './HistoryPanel';
import { PublishPanel } from './PublishPanel';
import { ResizeHandle } from './ResizeHandle';
import { clamp, FileTreeItem, GitStatusFile, GitStatusFileStatus } from './types';
import { securedFetch } from '@/src/lib/api';
import { Icon } from './Icon';

type SidebarPanel = 'files' | 'git' | 'history' | 'publish' | null;

const PANEL_WIDTH_MIN = 160;
const PANEL_WIDTH_MAX = 480;
const PANEL_WIDTH_DEFAULT = 224;

// 「変更履歴」タブはDiff表示(Monaco DiffEditor)を横に並べるため、ファイル
// ツリー/ソース管理パネルよりずっと広い幅を必要とする - 専用の幅レンジを
// 別管理し、タブ切り替え時にお互いの幅を奪わないようにする。
const HISTORY_PANEL_WIDTH_MIN = 480;
const HISTORY_PANEL_WIDTH_MAX = 960;
const HISTORY_PANEL_WIDTH_DEFAULT = 640;

interface SidebarProps {
    classId: string;
    activeFilePath: string | null;
    onSelectFile: (item: FileTreeItem) => void;
    onPathRemoved: (removedPath: string) => void;
    onPathRenamed: (oldPath: string, newPath: string) => void;
    onBeforeCommit?: () => Promise<void>;
    isActiveFileDirty: boolean;
    isSavingActiveFile: boolean;
    onSaveActiveFile: () => void;
    // onMutated/refreshSignal: 講師サポート画面と生徒画面それぞれの
    // ワークスペースを同一のworkspace-refresh WSメッセージで即時同期させる
    // ための仕組み(WorkspaceLayout参照) - onMutatedは自分側の操作成功時に
    // 呼び、相手側へブロードキャストする。refreshSignalは相手からの通知を
    // 受けて値が変わり、各パネルがそれをきっかけに再取得する。どちらも
    // ライブセッションが無い(講師が参加していない)通常利用時はundefinedの
    // ままで、既存の挙動を変えない。
    onMutated?: (reason: 'git' | 'file' | 'publish') => void;
    refreshSignal?: number;
}

interface GitPanelProps {
    classId: string;
    onBeforeCommit?: () => Promise<void>;
    onMutated?: (reason: 'git' | 'file' | 'publish') => void;
    refreshSignal?: number;
}

// ステータス1文字あたりの表示(VS Codeのソース管理パネルの配色に寄せる -
// 追加=緑、削除=赤、変更/リネーム/コピー=黄、未追跡=灰)。
const STATUS_LABEL: Record<GitStatusFileStatus, { letter: string; className: string; title: string }> = {
    added: { letter: 'A', className: 'text-[#6a9955]', title: '追加' },
    modified: { letter: 'M', className: 'text-[#cca700]', title: '変更' },
    deleted: { letter: 'D', className: 'text-[#f44747]', title: '削除' },
    renamed: { letter: 'R', className: 'text-[#cca700]', title: 'リネーム' },
    copied: { letter: 'C', className: 'text-[#cca700]', title: 'コピー' },
    untracked: { letter: 'U', className: 'text-[#8a8a8a]', title: '未追跡' },
};

// Git操作パネル。ワークスペース全体のコミット機能はここに一元化する
// (旧: 右上ヘッダーの「保存(コミット)」ボタン)。コミット前に、エディタで
// 開いたまま未保存のファイルがあれば先に保存させる(onBeforeCommit)ことで、
// 元のヘッダー実装と同じ挙動 - 未保存の編集内容もコミットへ含める - を保つ。
// 変更ファイル一覧(git status)は講師サポート画面と生徒画面のどちらから
// 開いても同じコンテナのworkspaceへ直接問い合わせるだけなので、片方が
// 編集・保存・作成/削除した内容がもう片方にも自然に見える(特別な同期
// メッセージは不要 - Git自体の状態がコンテナ上に1つしか無いため)。
// refreshSignalは、相手側が保存/コミット/ファイル操作を行った際の
// workspace-refresh通知を受けて変わり、それをきっかけに再取得する
// (WorkspaceLayout/Sidebar参照)。
function GitPanel({ classId, onBeforeCommit, onMutated, refreshSignal }: GitPanelProps) {
    const [message, setMessage] = useState('');
    const [isCommitting, setIsCommitting] = useState(false);
    const [result, setResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [statusFiles, setStatusFiles] = useState<GitStatusFile[] | null>(null);
    const [isStatusLoading, setIsStatusLoading] = useState(true);

    const loadStatus = useCallback(async () => {
        try {
            const params = new URLSearchParams({ course_id: classId });
            const res = await securedFetch(`/api/v2/sandbox/git/status?${params.toString()}`, { method: 'GET' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) return;
            setStatusFiles(Array.isArray(data.files) ? data.files : []);
        } catch {
            // 変更ファイル一覧の取得失敗は致命的ではない(コミット自体は
            // 引き続き行える) - 静かに無視し、次の再取得を待つ。
        } finally {
            setIsStatusLoading(false);
        }
    }, [classId]);

    useEffect(() => {
        loadStatus();
    }, [loadStatus]);

    const isFirstRefreshSignal = useRef(true);
    useEffect(() => {
        if (isFirstRefreshSignal.current) {
            isFirstRefreshSignal.current = false;
            return;
        }
        loadStatus();
    }, [refreshSignal, loadStatus]);

    const handleCommit = async () => {
        if (!message.trim() || isCommitting) return;
        setIsCommitting(true);
        setResult(null);
        try {
            await onBeforeCommit?.();
            const res = await securedFetch('/api/v2/program/container/commit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ course_id: Number(classId), message }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || '保存(コミット)に失敗しました');
            setResult({ type: 'success', text: '変更を保存しました' });
            setMessage('');
            await loadStatus();
            onMutated?.('git');
        } catch (err) {
            setResult({
                type: 'error',
                text: err instanceof Error ? err.message : '保存(コミット)に失敗しました',
            });
        } finally {
            setIsCommitting(false);
        }
    };

    return (
        <div className="flex flex-col h-full text-[#cccccc]">
            <div className="px-3 py-2 text-[11px] font-bold tracking-wider text-[#bbbbbb] uppercase shrink-0 flex items-center justify-between">
                <span>ソース管理</span>
                <button title="更新" onClick={loadStatus} className="text-[#cccccc] hover:text-white">
                    <Icon name="refresh" />
                </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
                {isStatusLoading && (
                    <div className="px-3 pb-2 text-xs text-[#8a8a8a]">変更ファイルを確認中...</div>
                )}
                {!isStatusLoading && statusFiles !== null && statusFiles.length === 0 && (
                    <div className="px-3 pb-2 text-xs text-[#8a8a8a]">変更はありません</div>
                )}
                {!isStatusLoading && statusFiles !== null && statusFiles.length > 0 && (
                    <ul className="px-1 pb-2">
                        {statusFiles.map((file) => {
                            const label = STATUS_LABEL[file.status];
                            return (
                                <li
                                    key={file.path}
                                    title={`${label.title}: ${file.path}`}
                                    className="flex items-center gap-2 px-2 py-1 text-xs text-[#cccccc] hover:bg-[#2a2d2e] rounded"
                                >
                                    <span className={`w-3 shrink-0 font-bold ${label.className}`}>{label.letter}</span>
                                    <span className="truncate">{file.path}</span>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
            <div className="px-3 pb-2 shrink-0">
                <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    disabled={isCommitting}
                    placeholder="コミットメッセージを入力..."
                    className="w-full h-16 resize-none rounded-md bg-[#3c3c3c] text-[#cccccc] text-xs px-2 py-1.5 placeholder:text-[#6a6a6a] border border-[#3c3c3c] focus:outline-none focus:border-[#007acc] disabled:opacity-60"
                />
            </div>
            <div className="px-3 pb-2 shrink-0">
                <button
                    onClick={handleCommit}
                    disabled={isCommitting || !message.trim()}
                    className="w-full py-1.5 rounded-md bg-[#0e639c] hover:bg-[#1177bb] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold transition-colors"
                >
                    {isCommitting ? '保存中...' : '変更を保存(コミット)'}
                </button>
            </div>
            {result && (
                <div
                    className={`px-3 pb-3 text-[11px] font-bold shrink-0 ${
                        result.type === 'success' ? 'text-[#6a9955]' : 'text-[#f44747]'
                    }`}
                >
                    <Icon name={result.type === 'success' ? 'check' : 'warning'} /> {result.text}
                </div>
            )}
        </div>
    );
}

// 最左のアイコンバー(エクスプローラー/ソース管理)とサイドパネル。アイコンクリックでパネルの開閉をトグルする。
export function Sidebar({
    classId,
    activeFilePath,
    onSelectFile,
    onPathRemoved,
    onPathRenamed,
    onBeforeCommit,
    isActiveFileDirty,
    isSavingActiveFile,
    onSaveActiveFile,
    onMutated,
    refreshSignal,
}: SidebarProps) {
    const [panel, setPanel] = useState<SidebarPanel>('files');
    const [panelWidth, setPanelWidth] = useState(PANEL_WIDTH_DEFAULT);
    const [historyPanelWidth, setHistoryPanelWidth] = useState(HISTORY_PANEL_WIDTH_DEFAULT);

    const togglePanel = (target: SidebarPanel) => {
        setPanel((current) => (current === target ? null : target));
    };

    const isHistory = panel === 'history';
    const currentWidth = isHistory ? historyPanelWidth : panelWidth;
    const setCurrentWidth = isHistory ? setHistoryPanelWidth : setPanelWidth;
    const [widthMin, widthMax] = isHistory
        ? [HISTORY_PANEL_WIDTH_MIN, HISTORY_PANEL_WIDTH_MAX]
        : [PANEL_WIDTH_MIN, PANEL_WIDTH_MAX];

    return (
        <div className="flex h-full shrink-0">
            {/* アイコンバー */}
            <div className="w-12 bg-[#333333] flex flex-col items-center gap-1 py-2 shrink-0">
                <button
                    title="ファイル操作"
                    onClick={() => togglePanel('files')}
                    className={`w-10 h-10 flex items-center justify-center text-xl rounded-md transition-colors ${
                        panel === 'files' ? 'bg-[#505050] border-l-2 border-[#007acc]' : 'hover:bg-[#3c3c3c]'
                    }`}
                >
                    <Icon name="files" />
                </button>
                <button
                    title="ソース管理"
                    onClick={() => togglePanel('git')}
                    className={`w-10 h-10 flex items-center justify-center text-xl rounded-md transition-colors ${
                        panel === 'git' ? 'bg-[#505050] border-l-2 border-[#007acc]' : 'hover:bg-[#3c3c3c]'
                    }`}
                >
                    <Icon name="source-control" />
                </button>
                <button
                    title="変更履歴"
                    onClick={() => togglePanel('history')}
                    className={`w-10 h-10 flex items-center justify-center text-xl rounded-md transition-colors ${
                        panel === 'history' ? 'bg-[#505050] border-l-2 border-[#007acc]' : 'hover:bg-[#3c3c3c]'
                    }`}
                >
                    <Icon name="history" />
                </button>
                <button
                    title="公開"
                    onClick={() => togglePanel('publish')}
                    className={`w-10 h-10 flex items-center justify-center text-xl rounded-md transition-colors ${
                        panel === 'publish' ? 'bg-[#505050] border-l-2 border-[#007acc]' : 'hover:bg-[#3c3c3c]'
                    }`}
                >
                    <Icon name="broadcast" />
                </button>
            </div>

            {/* サイドパネル */}
            {panel && (
                <>
                    <div style={{ width: currentWidth }} className="bg-[#252526] shrink-0 overflow-hidden">
                        {panel === 'files' && (
                            <FileExplorerPane
                                classId={classId}
                                activeFilePath={activeFilePath}
                                onSelectFile={onSelectFile}
                                onPathRemoved={onPathRemoved}
                                onPathRenamed={onPathRenamed}
                                isActiveFileDirty={isActiveFileDirty}
                                isSavingActiveFile={isSavingActiveFile}
                                onSaveActiveFile={onSaveActiveFile}
                                onMutated={onMutated ? () => onMutated('file') : undefined}
                                refreshSignal={refreshSignal}
                            />
                        )}
                        {panel === 'git' && (
                            <GitPanel
                                classId={classId}
                                onBeforeCommit={onBeforeCommit}
                                onMutated={onMutated}
                                refreshSignal={refreshSignal}
                            />
                        )}
                        {panel === 'history' && (
                            <HistoryPanel classId={classId} onMutated={onMutated} refreshSignal={refreshSignal} />
                        )}
                        {panel === 'publish' && (
                            <PublishPanel classId={classId} onMutated={onMutated} refreshSignal={refreshSignal} />
                        )}
                    </div>
                    <ResizeHandle
                        axis="x"
                        onResize={(delta) => setCurrentWidth((w) => clamp(w + delta, widthMin, widthMax))}
                    />
                </>
            )}
        </div>
    );
}
