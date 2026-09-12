'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FileExplorerPane } from './FileExplorerPane';
import { EditorPane } from './EditorPane';
import { Icon } from './Icon';
import { FileTreeItem, languageFromFileName, OpenFile } from './types';
import { securedFetch, setActingAsUser } from '@/src/lib/api';
import { useLiveEditorChannel } from './live/useLiveEditorChannel';
import { applyIncomingCursor, applyIncomingEditorChange } from './live/liveEditorRegistry';
import { LiveMessage } from './live/liveTypes';

interface PeerViewerPanelProps {
    isOpen: boolean;
    onClose: () => void;
    classId: string;
    targetUserId: string;
    targetName: string;
}

// 生徒間でのリアルタイム相互閲覧(Peer Viewer、読み取り専用)機能。
// WorkspaceLayout.tsxの「👥 クラスメイトの作品」パネルからクラスメイトを
// 選ぶと開く、完全に別コンポーネントの読み取り専用ビューア - WorkspaceLayout
// (teacherContext)をそのまま再利用しなかったのは、(1)講師モードは
// 双方向(自分のファイル操作をeditor-openで相手にも伝える)なのに対し、
// こちらは常に一方向(対象生徒の操作だけを受信し、閲覧者自身のファイル
// 選択/カーソル移動は一切送信しない)、(2)ターミナル/Git/公開/AIチャットを
// 丸ごと持たない、という違いが大きく、WorkspaceLayoutへ条件分岐を増やす
// よりも独立したコンポーネントにする方が見通しが良いため。
//
// 書き込み系エンドポイントへのアクセスはバックエンド側で403になる
// (authorizeSandboxCourseはteacherのas_userしか受け付けないため、
// internal/handler/file.goのresolveViewerActingAs/resolveTeacherActingAs
// 参照)。フロント側の「読み取り専用UI」はその上に立つ、あくまで見た目の
// 徹底であり、安全性そのものはサーバー側の認可で担保している。
export function PeerViewerPanel({ isOpen, onClose, classId, targetUserId, targetName }: PeerViewerPanelProps) {
    const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
    const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
    const [isFileLoading, setIsFileLoading] = useState(false);
    const [fileError, setFileError] = useState<string | null>(null);
    const [refreshNonce, setRefreshNonce] = useState(0);

    // 開いている間だけsecuredFetch(src/lib/api.ts)へ「対象生徒として読む」
    // ことを伝える - FileExplorerPane/EditorPane(のファイル取得)は一切
    // 変更せずに対象生徒のワークスペースへ向け直せる(講師サポート画面の
    // teacherContextと同じ仕組み)。
    useEffect(() => {
        if (!isOpen) return;
        setActingAsUser(targetUserId);
        return () => setActingAsUser(null);
    }, [isOpen, targetUserId]);

    const openFilesRef = useRef(openFiles);
    useEffect(() => {
        openFilesRef.current = openFiles;
    }, [openFiles]);

    // refreshCleanOpenFiles: 対象生徒側のgit操作(pull/revert等)でファイル
    // 内容が変わった時に追従する。閲覧者は編集できない(content===savedContent
    // が常に成り立つ)ため、開いている全タブを無条件に再取得してよい。
    const refreshCleanOpenFiles = useCallback(async () => {
        for (const target of openFilesRef.current) {
            try {
                const params = new URLSearchParams({ course_id: classId, path: target.path });
                const res = await securedFetch(`/api/v2/program/container/file?${params.toString()}`, {
                    method: 'GET',
                });
                if (!res.ok) continue;
                const data = await res.json().catch(() => ({}));
                const content = data.content ?? '';
                setOpenFiles((prev) =>
                    prev.map((f) => (f.path === target.path ? { ...f, content, savedContent: content } : f)),
                );
            } catch {
                // 無視: 次のworkspace-refreshで改めて追従する。
            }
        }
    }, [classId]);

    // 意図的にeditor-openは扱わない - 作成者(閲覧対象の生徒)がファイルを
    // 切り替えても、閲覧者の画面までは連動して切り替わらない(閲覧者は自分
    // が開いたファイルだけを見続ける)。一方、既に開いているファイルの内容
    // (editor-change/カーソル位置)や、ファイルツリー・git操作による変更
    // (workspace-refresh)はこれまで通りリアルタイムに反映する - 「連動は
    // しないが中身はリアルタイム更新してほしい」という要件に対応する。
    const handleLiveMessage = useCallback(
        (msg: LiveMessage) => {
            switch (msg.type) {
                case 'editor-change':
                    applyIncomingEditorChange(msg);
                    break;
                case 'editor-cursor':
                    applyIncomingCursor(msg);
                    break;
                case 'workspace-refresh':
                    setRefreshNonce((n) => n + 1);
                    if (msg.reason === 'git' || msg.reason === 'file') {
                        void refreshCleanOpenFiles();
                    }
                    break;
                default:
                    break;
            }
        },
        [refreshCleanOpenFiles],
    );

    useLiveEditorChannel({
        ticketPath: '/api/v2/program/peer/live-session-ticket',
        ticketBody: { course_id: Number(classId), user_id: targetUserId },
        onMessage: handleLiveMessage,
        enabled: isOpen,
    });

    // handleSelectFile: 閲覧者自身がファイルツリーから選んだ時の、完全に
    // ローカルな操作(editor-openは送らない) - 対象生徒や他の閲覧者の画面を
    // 巻き込まない(一方向: 対象生徒→閲覧者のみ追従する設計、コンポーネント
    // 冒頭のコメント参照)。
    const handleSelectFile = useCallback(
        async (item: FileTreeItem) => {
            if (openFiles.some((f) => f.path === item.path)) {
                setActiveFilePath(item.path);
                return;
            }
            const isFirstFile = openFiles.length === 0;
            if (isFirstFile) {
                setIsFileLoading(true);
                setFileError(null);
            }
            try {
                const params = new URLSearchParams({ course_id: classId, path: item.path });
                const res = await securedFetch(`/api/v2/program/container/file?${params.toString()}`, {
                    method: 'GET',
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || 'ファイルの取得に失敗しました');

                const content = data.content ?? '';
                const newFile: OpenFile = {
                    path: item.path,
                    name: item.name,
                    language: languageFromFileName(item.name),
                    content,
                    savedContent: content,
                    isSaving: false,
                    saveError: null,
                };
                setOpenFiles((prev) => (prev.some((f) => f.path === item.path) ? prev : [...prev, newFile]));
                setActiveFilePath(item.path);
            } catch (err) {
                const message = err instanceof Error ? err.message : 'ファイルの取得に失敗しました';
                if (isFirstFile) {
                    setFileError(message);
                } else {
                    alert(message);
                }
            } finally {
                if (isFirstFile) setIsFileLoading(false);
            }
        },
        [classId, openFiles],
    );

    const handleCloseTab = useCallback(
        (path: string) => {
            const idx = openFiles.findIndex((f) => f.path === path);
            const next = openFiles.filter((f) => f.path !== path);
            setOpenFiles(next);
            if (path === activeFilePath) {
                const fallback = next[idx] ?? next[idx - 1] ?? null;
                setActiveFilePath(fallback?.path ?? null);
            }
        },
        [openFiles, activeFilePath],
    );

    // 受信したリモート変更をReact stateへも反映する(useLiveEditorSyncの
    // onRemoteChange経由)。<Editor value=.../>はcontrolledプロパティのため、
    // ここでstateを追従させないと次の再レンダーで巻き戻ってしまう
    // (liveEditorRegistry.tsのコメント参照)。
    const handleEditorChange = useCallback((path: string, content: string) => {
        setOpenFiles((prev) => prev.map((f) => (f.path === path ? { ...f, content, savedContent: content } : f)));
    }, []);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex flex-col bg-[#1e1e1e] text-[#cccccc]">
            {/* 一番上: 閲覧中インフォメーションバナー(読み取り専用) */}
            <div className="shrink-0 px-4 py-2 bg-indigo-500/90 text-white text-xs font-bold flex items-center justify-between">
                <span>👁️ {targetName || 'クラスメイト'}さんのコードを閲覧中(読み取り専用)</span>
                <button
                    type="button"
                    onClick={onClose}
                    className="hover:bg-white/20 p-1 rounded-full transition-all"
                    title="閉じる"
                >
                    <Icon name="close" />
                </button>
            </div>

            <div className="flex-1 flex min-h-0">
                <div className="w-56 shrink-0 border-r border-[#3c3c3c] bg-[#252526]">
                    <FileExplorerPane
                        classId={classId}
                        activeFilePath={activeFilePath}
                        onSelectFile={handleSelectFile}
                        onPathRemoved={() => {}}
                        onPathRenamed={() => {}}
                        isActiveFileDirty={false}
                        isSavingActiveFile={false}
                        onSaveActiveFile={() => {}}
                        refreshSignal={refreshNonce}
                        readOnly
                    />
                </div>

                <div className="flex-1 min-h-0 min-w-0">
                    <EditorPane
                        classId={classId}
                        openFiles={openFiles}
                        activeFilePath={activeFilePath}
                        isLoading={isFileLoading}
                        errorMessage={fileError}
                        onSelectTab={setActiveFilePath}
                        onCloseTab={handleCloseTab}
                        onChange={handleEditorChange}
                        onSave={() => {}}
                        runAction={{ kind: 'none' }}
                        onRun={() => {}}
                        isWebPreviewOpen={false}
                        onToggleWebPreview={() => {}}
                        liveSend={() => {}}
                        asUserId={targetUserId}
                        readOnly
                    />
                </div>
            </div>
        </div>
    );
}
