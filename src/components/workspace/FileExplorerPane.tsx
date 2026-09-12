'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { securedFetch } from '@/src/lib/api';
import { ContextMenu, ContextMenuState } from './ContextMenu';
import { PromptModal, PromptModalState } from './PromptModal';
import { ConfirmModal, ConfirmModalState } from './ConfirmModal';
import { Icon } from './Icon';
import { FileTreeItem, joinPath, parentPath } from './types';
import { FileIcon } from './FileIcon';

interface FileExplorerPaneProps {
    classId: string;
    activeFilePath: string | null;
    onSelectFile: (item: FileTreeItem) => void;
    onPathRemoved: (removedPath: string) => void;
    onPathRenamed: (oldPath: string, newPath: string) => void;
    // 「保存」機能はここ(左のファイル操作ヘッダー)に一元化する - エディタは
    // 複数ファイルをタブで開けるため、「保存」は常に今アクティブなタブに対して
    // 効く単一の操作として、隠しファイル表示トグルの隣に置く。
    isActiveFileDirty: boolean;
    isSavingActiveFile: boolean;
    onSaveActiveFile: () => void;
    // onMutated: 作成/移動(リネーム含む)/削除が成功するたびに呼ばれる
    // (講師サポート画面からの操作をWebSocket経由で生徒側へ即時反映させる
    // workspace-refreshブロードキャストのため、WorkspaceLayout参照)。
    onMutated?: () => void;
    // refreshSignal: 値が変わるたびにルート+展開中のディレクトリを再取得する
    // (相手側の操作によるworkspace-refresh受信時に、こちらのツリー表示も
    // 追従させるため)。
    refreshSignal?: number;
    // readOnly: クラスメイト間の相互閲覧(Peer Viewer)モード。作成/リネーム/
    // 削除/ドラッグ移動用のUIをすべて隠し、閲覧(ツリーの開閉・ファイル選択)
    // だけを許可する(TreeNodeのコメント参照)。
    readOnly?: boolean;
}

type DirState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; items: FileTreeItem[] };

interface DraggedItem {
    path: string;
    isDir: boolean;
}

// ディレクトリ1階層分をバックエンドから取得する。dirPathを省略するとサーバー側の
// 既定(コンテナのworkspaceルート)が使われる。
async function fetchDir(classId: string, dirPath?: string): Promise<{ path: string; items: FileTreeItem[] }> {
    const params = new URLSearchParams({ course_id: classId });
    if (dirPath) params.set('path', dirPath);

    const res = await securedFetch(`/api/v2/program/container/files?${params.toString()}`, { method: 'GET' });
    if (!res.ok) throw new Error('ファイル一覧の取得に失敗しました');

    const data = await res.json();
    return {
        path: typeof data?.path === 'string' ? data.path : dirPath ?? '',
        items: Array.isArray(data?.items) ? data.items : [],
    };
}

function readDraggedItem(e: React.DragEvent): DraggedItem | null {
    const raw = e.dataTransfer.getData('application/json');
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.path === 'string') return { path: parsed.path, isDir: Boolean(parsed.isDir) };
    } catch {
        // 無視: このアプリ以外からのドラッグ等
    }
    return null;
}

// ドット始まり(.git, .gitignore等)を「隠しファイル」として扱う - 生徒が
// 誤って.gitの中身を編集/削除してしまう事故を防ぐため、既定では隠す。
const isHiddenName = (name: string) => name.startsWith('.');

function visibleItems(items: FileTreeItem[], showHiddenFiles: boolean): FileTreeItem[] {
    return showHiddenFiles ? items : items.filter((item) => !isHiddenName(item.name));
}

function TreeNode({
    item,
    depth,
    activeFilePath,
    activeDirPath,
    expandedPaths,
    childStates,
    showHiddenFiles,
    onToggleDir,
    onSelectFile,
    onCreate,
    onRename,
    onDelete,
    onDropMove,
    onContextMenu,
    readOnly,
}: {
    item: FileTreeItem;
    depth: number;
    activeFilePath: string | null;
    activeDirPath: string | null;
    expandedPaths: Set<string>;
    childStates: Record<string, DirState>;
    showHiddenFiles: boolean;
    onToggleDir: (dirPath: string) => void;
    onSelectFile: (item: FileTreeItem) => void;
    onCreate: (parentPath: string, isDir: boolean) => void;
    onRename: (item: FileTreeItem) => void;
    onDelete: (item: FileTreeItem) => void;
    onDropMove: (dragged: DraggedItem, targetDirPath: string) => void;
    onContextMenu: (e: React.MouseEvent, item: FileTreeItem) => void;
    // readOnly: クラスメイト間の相互閲覧(Peer Viewer、読み取り専用)モード。
    // ドラッグ移動・右クリックメニュー・作成/リネーム/削除の各操作用UIを
    // すべて隠す - サーバー側でも書き込み系エンドポイントはこのユーザーを
    // 自分自身としてしか扱わない(authorizeSandboxCourseがteacherのas_user
    // しか受け付けないため、クラスメイトのas_user指定は403になる)ため二重の
    // 安全策だが、UIとしても操作できるように見せないことが要件。
    readOnly?: boolean;
}) {
    const [isDragOver, setIsDragOver] = useState(false);
    const indent = 12 + depth * 14;
    const isExpanded = item.is_dir && expandedPaths.has(item.path);
    const isActive = item.path === activeFilePath || (item.is_dir && item.path === activeDirPath && item.path !== activeFilePath);
    const state = item.is_dir ? childStates[item.path] : undefined;
    const visibleChildren = state?.status === 'ready' ? visibleItems(state.items, showHiddenFiles) : [];

    const handleRowClick = () => {
        if (item.is_dir) {
            onToggleDir(item.path);
        } else {
            onSelectFile(item);
        }
    };

    return (
        <div
            onDragOver={(e) => {
                if (readOnly || !item.is_dir) return;
                e.preventDefault();
                setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => {
                if (readOnly || !item.is_dir) return;
                e.preventDefault();
                e.stopPropagation();
                setIsDragOver(false);
                const dragged = readDraggedItem(e);
                if (dragged) onDropMove(dragged, item.path);
            }}
        >
            <div
                draggable={!readOnly}
                onDragStart={(e) => {
                    if (readOnly) return;
                    e.dataTransfer.setData('application/json', JSON.stringify({ path: item.path, isDir: item.is_dir }));
                    e.dataTransfer.effectAllowed = 'move';
                }}
                onContextMenu={(e) => {
                    e.stopPropagation();
                    if (readOnly) {
                        e.preventDefault();
                        return;
                    }
                    onContextMenu(e, item);
                }}
                style={{ paddingLeft: indent }}
                className={`group w-full flex items-center gap-1 pr-1.5 py-1.5 text-sm transition-colors ${
                    isActive ? 'bg-[#37373d] text-white' : 'text-[#cccccc] hover:bg-[#2a2d2e]'
                } ${isDragOver ? 'outline outline-1 outline-[#007acc] -outline-offset-1' : ''}`}
            >
                <button onClick={handleRowClick} className="flex items-center gap-1.5 flex-1 min-w-0 text-left">
                    <span className="text-[10px] w-3 shrink-0 text-[#8a8a8a]">
                        {item.is_dir && <Icon name={isExpanded ? 'chevron-down' : 'chevron-right'} />}
                    </span>
                    <span className="text-xs shrink-0">
                        {item.is_dir ? (
                            <Icon name={isExpanded ? 'folder-opened' : 'folder'} className="text-[#dcb67a]" />
                        ) : (
                            <FileIcon name={item.name} />
                        )}
                    </span>
                    <span className="truncate">{item.name}</span>
                </button>

                {!readOnly && (
                    <div className="hidden group-hover:flex items-center gap-1.5 shrink-0 pl-1">
                        {item.is_dir && (
                            <>
                                <button
                                    title="新規ファイル"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onCreate(item.path, false);
                                    }}
                                    className="text-[11px] text-[#cccccc] hover:text-white"
                                >
                                    <Icon name="new-file" />
                                </button>
                                <button
                                    title="新規フォルダ"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onCreate(item.path, true);
                                    }}
                                    className="text-[11px] text-[#cccccc] hover:text-white"
                                >
                                    <Icon name="new-folder" />
                                </button>
                            </>
                        )}
                        <button
                            title="名前を変更"
                            onClick={(e) => {
                                e.stopPropagation();
                                onRename(item);
                            }}
                            className="text-[11px] text-[#cccccc] hover:text-white"
                        >
                            <Icon name="edit" />
                        </button>
                        <button
                            title="削除"
                            onClick={(e) => {
                                e.stopPropagation();
                                onDelete(item);
                            }}
                            className="text-[11px] text-[#cccccc] hover:text-white"
                        >
                            <Icon name="trash" />
                        </button>
                    </div>
                )}
            </div>

            {item.is_dir && isExpanded && (
                <div>
                    {(!state || state.status === 'loading') && (
                        <div style={{ paddingLeft: indent + 14 }} className="py-1 text-[11px] text-[#8a8a8a]">
                            読み込み中...
                        </div>
                    )}
                    {state?.status === 'error' && (
                        <div style={{ paddingLeft: indent + 14 }} className="py-1 text-[11px] text-[#f44747]">
                            <Icon name="warning" /> 通信エラー
                        </div>
                    )}
                    {state?.status === 'ready' && visibleChildren.length === 0 && (
                        <div style={{ paddingLeft: indent + 14 }} className="py-1 text-[11px] text-[#8a8a8a]">
                            空のフォルダ
                        </div>
                    )}
                    {state?.status === 'ready' &&
                        visibleChildren.map((child) => (
                            <TreeNode
                                key={child.path}
                                item={child}
                                depth={depth + 1}
                                activeFilePath={activeFilePath}
                                activeDirPath={activeDirPath}
                                expandedPaths={expandedPaths}
                                childStates={childStates}
                                showHiddenFiles={showHiddenFiles}
                                onToggleDir={onToggleDir}
                                onSelectFile={onSelectFile}
                                onCreate={onCreate}
                                onRename={onRename}
                                onDelete={onDelete}
                                onDropMove={onDropMove}
                                onContextMenu={onContextMenu}
                                readOnly={readOnly}
                            />
                        ))}
                </div>
            )}
        </div>
    );
}

// コンテナ内のワークスペースをバックエンド(Docker API経由)から取得して表示する
// ファイルツリー。フォルダはクリックした時に初めてその階層を取得する遅延読み込み。
// 新規作成・リネーム・削除・(ドラッグ&ドロップによる)移動のCRUD操作を、各行の
// ホバー時アイコンと右クリックのコンテキストメニューの両方から行える
// (バックエンド未実装/通信失敗時はその場に通信エラーを表示する)。
export function FileExplorerPane({
    classId,
    activeFilePath,
    onSelectFile,
    onPathRemoved,
    onPathRenamed,
    isActiveFileDirty,
    isSavingActiveFile,
    onSaveActiveFile,
    onMutated,
    refreshSignal,
    readOnly,
}: FileExplorerPaneProps) {
    const [rootPath, setRootPath] = useState<string | null>(null);
    const [rootState, setRootState] = useState<DirState>({ status: 'loading' });
    const [childStates, setChildStates] = useState<Record<string, DirState>>({});
    const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
    const [activeDirPath, setActiveDirPath] = useState<string | null>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [promptModal, setPromptModal] = useState<PromptModalState | null>(null);
    const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null);
    // 初学者が.git等を誤って触ってしまう事故を防ぐため、既定では隠しファイルを
    // 非表示にする(ヘッダーのトグルボタンで表示切り替え)。
    const [showHiddenFiles, setShowHiddenFiles] = useState(false);

    const loadRoot = useCallback(() => {
        setRootState({ status: 'loading' });
        fetchDir(classId)
            .then(({ path, items }) => {
                setRootPath(path);
                setRootState({ status: 'ready', items });
            })
            .catch(() => setRootState({ status: 'error' }));
    }, [classId]);

    const loadDir = useCallback((dirPath: string) => {
        setChildStates((prev) => ({ ...prev, [dirPath]: { status: 'loading' } }));
        fetchDir(classId, dirPath)
            .then(({ items }) => setChildStates((prev) => ({ ...prev, [dirPath]: { status: 'ready', items } })))
            .catch(() => setChildStates((prev) => ({ ...prev, [dirPath]: { status: 'error' } })));
    }, [classId]);

    useEffect(() => {
        loadRoot();
    }, [loadRoot]);

    // expandedPathsRef: refreshSignal受信時に「今展開中のディレクトリ」を
    // 再取得するための最新値参照(レンダー中の直接代入を避けるため、
    // useLiveEditorChannel.ts等と同じ形でeffect経由でのみ更新する)。
    const expandedPathsRef = useRef(expandedPaths);
    useEffect(() => {
        expandedPathsRef.current = expandedPaths;
    }, [expandedPaths]);

    // refreshSignalは講師/生徒どちらか一方の操作結果をもう一方へ即時反映
    // させるためのworkspace-refresh受信通知(WorkspaceLayout参照) - 値が
    // 変わるたびにルート+展開中のディレクトリを再取得する。初回マウント分は
    // loadRootの効果と重複するのでスキップする。
    const isFirstRefreshSignal = useRef(true);
    useEffect(() => {
        if (isFirstRefreshSignal.current) {
            isFirstRefreshSignal.current = false;
            return;
        }
        loadRoot();
        expandedPathsRef.current.forEach((dirPath) => loadDir(dirPath));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshSignal]);

    const refreshDirOrRoot = useCallback(
        (dirPath: string) => {
            if (rootPath !== null && dirPath === rootPath) {
                loadRoot();
            } else {
                loadDir(dirPath);
            }
        },
        [rootPath, loadRoot, loadDir],
    );

    const handleToggleDir = useCallback(
        (dirPath: string) => {
            setActiveDirPath(dirPath);
            setExpandedPaths((prev) => {
                const next = new Set(prev);
                if (next.has(dirPath)) {
                    next.delete(dirPath);
                } else {
                    next.add(dirPath);
                }
                return next;
            });
            if (!childStates[dirPath]) {
                loadDir(dirPath);
            }
        },
        [childStates, loadDir],
    );

    const handleSelectFile = useCallback(
        (item: FileTreeItem) => {
            setActiveDirPath(parentPath(item.path));
            onSelectFile(item);
        },
        [onSelectFile],
    );

    const handleCreate = useCallback(
        (parent: string, isDir: boolean) => {
            setPromptModal({
                title: isDir ? '新しいフォルダ' : '新しいファイル',
                label: isDir ? 'フォルダ名' : 'ファイル名',
                confirmLabel: '作成',
                onSubmit: async (name) => {
                    const targetPath = joinPath(parent, name);
                    try {
                        const res = await securedFetch('/api/v2/program/container/file', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ course_id: Number(classId), path: targetPath, is_dir: isDir }),
                        });
                        const data = await res.json().catch(() => ({}));
                        if (!res.ok) throw new Error(data.error || '作成に失敗しました');
                        refreshDirOrRoot(parent);
                        onMutated?.();
                    } catch (err) {
                        alert(err instanceof Error ? err.message : '作成に失敗しました');
                    }
                },
            });
        },
        [classId, refreshDirOrRoot, onMutated],
    );

    const doMove = useCallback(
        async (oldPath: string, newPath: string) => {
            if (oldPath === newPath) return;
            try {
                const res = await securedFetch('/api/v2/program/container/file', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ course_id: Number(classId), old_path: oldPath, new_path: newPath }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || '移動に失敗しました');
                refreshDirOrRoot(parentPath(oldPath));
                refreshDirOrRoot(parentPath(newPath));
                onPathRenamed(oldPath, newPath);
                onMutated?.();
            } catch (err) {
                alert(err instanceof Error ? err.message : '移動に失敗しました');
            }
        },
        [classId, refreshDirOrRoot, onPathRenamed, onMutated],
    );

    const handleRename = useCallback(
        (item: FileTreeItem) => {
            setPromptModal({
                title: '名前を変更',
                label: '新しい名前',
                initialValue: item.name,
                confirmLabel: '変更',
                onSubmit: (newName) => {
                    if (newName === item.name) return;
                    doMove(item.path, joinPath(parentPath(item.path), newName));
                },
            });
        },
        [doMove],
    );

    const handleDropMove = useCallback(
        (dragged: DraggedItem, targetDirPath: string) => {
            const newPath = joinPath(targetDirPath, dragged.path.split('/').pop() || dragged.path);
            if (newPath === dragged.path) return;
            if (dragged.isDir && (targetDirPath === dragged.path || targetDirPath.startsWith(dragged.path + '/'))) {
                alert('フォルダを自分自身、またはその中には移動できません');
                return;
            }
            doMove(dragged.path, newPath);
        },
        [doMove],
    );

    const handleDelete = useCallback(
        (item: FileTreeItem) => {
            setConfirmModal({
                title: item.is_dir ? 'フォルダを削除' : 'ファイルを削除',
                message: item.is_dir
                    ? `フォルダ「${item.name}」と、その中の全てのファイルを削除しますか？`
                    : `ファイル「${item.name}」を削除しますか？`,
                confirmLabel: '削除',
                danger: true,
                onConfirm: async () => {
                    try {
                        const res = await securedFetch('/api/v2/program/container/file', {
                            method: 'DELETE',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ course_id: Number(classId), path: item.path }),
                        });
                        const data = await res.json().catch(() => ({}));
                        if (!res.ok) throw new Error(data.error || '削除に失敗しました');
                        refreshDirOrRoot(parentPath(item.path));
                        onPathRemoved(item.path);
                        onMutated?.();
                    } catch (err) {
                        alert(err instanceof Error ? err.message : '削除に失敗しました');
                    }
                },
            });
        },
        [classId, refreshDirOrRoot, onPathRemoved, onMutated],
    );

    const openItemContextMenu = useCallback(
        (e: React.MouseEvent, item: FileTreeItem) => {
            e.preventDefault();
            const items: ContextMenuState['items'] = [];
            if (item.is_dir) {
                items.push({ label: '新しいファイル', onClick: () => handleCreate(item.path, false) });
                items.push({ label: '新しいフォルダ', onClick: () => handleCreate(item.path, true) });
            } else {
                items.push({ label: '開く', onClick: () => handleSelectFile(item) });
            }
            items.push({ label: '名前を変更', onClick: () => handleRename(item) });
            items.push({ label: '削除', onClick: () => handleDelete(item), danger: true });
            setContextMenu({ x: e.clientX, y: e.clientY, items });
        },
        [handleCreate, handleRename, handleDelete, handleSelectFile],
    );

    const openRootContextMenu = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            if (!rootPath) return;
            setContextMenu({
                x: e.clientX,
                y: e.clientY,
                items: [
                    { label: '新しいファイル', onClick: () => handleCreate(rootPath, false) },
                    { label: '新しいフォルダ', onClick: () => handleCreate(rootPath, true) },
                ],
            });
        },
        [rootPath, handleCreate],
    );

    const createTargetDir = activeDirPath ?? rootPath;
    const visibleRootItems = rootState.status === 'ready' ? visibleItems(rootState.items, showHiddenFiles) : [];

    return (
        <div className="flex flex-col h-full text-[#cccccc]">
            <div className="px-3 py-2 flex items-center justify-between shrink-0">
                <span className="text-[11px] font-bold tracking-wider text-[#bbbbbb] uppercase">
                    エクスプローラー
                </span>
                <div className="flex items-center gap-2">
                    {!readOnly && (
                        <button
                            title="ファイルを保存 (Ctrl+S)"
                            disabled={!isActiveFileDirty || isSavingActiveFile}
                            onClick={onSaveActiveFile}
                            className="text-xs text-[#cccccc] hover:text-white disabled:opacity-30 disabled:hover:text-[#cccccc]"
                        >
                            <Icon name="save" />
                        </button>
                    )}
                    <button
                        title={showHiddenFiles ? '隠しファイルを隠す' : '隠しファイルを表示'}
                        onClick={() => setShowHiddenFiles((v) => !v)}
                        className={`text-xs hover:text-white ${showHiddenFiles ? 'text-white' : 'text-[#8a8a8a]'}`}
                    >
                        <Icon name={showHiddenFiles ? 'eye-closed' : 'eye'} />
                    </button>
                    {!readOnly && (
                        <>
                            <button
                                title="新規ファイル"
                                disabled={createTargetDir === null}
                                onClick={() => createTargetDir && handleCreate(createTargetDir, false)}
                                className="text-xs text-[#cccccc] hover:text-white disabled:opacity-30 disabled:hover:text-[#cccccc]"
                            >
                                <Icon name="new-file" />
                            </button>
                            <button
                                title="新規フォルダ"
                                disabled={createTargetDir === null}
                                onClick={() => createTargetDir && handleCreate(createTargetDir, true)}
                                className="text-xs text-[#cccccc] hover:text-white disabled:opacity-30 disabled:hover:text-[#cccccc]"
                            >
                                <Icon name="new-folder" />
                            </button>
                        </>
                    )}
                </div>
            </div>

            <div
                onClick={() => rootPath && setActiveDirPath(rootPath)}
                onContextMenu={(e) => {
                    if (readOnly) {
                        e.preventDefault();
                        return;
                    }
                    openRootContextMenu(e);
                }}
                onDragOver={(e) => {
                    if (readOnly) return;
                    e.preventDefault();
                }}
                onDrop={(e) => {
                    if (readOnly) return;
                    e.preventDefault();
                    if (!rootPath) return;
                    const dragged = readDraggedItem(e);
                    if (dragged) handleDropMove(dragged, rootPath);
                }}
                className={`px-2 pb-1 text-xs font-bold flex items-center gap-1 cursor-pointer hover:bg-[#2a2d2e] ${
                    rootPath && activeDirPath === rootPath ? 'text-white' : 'text-[#cccccc]'
                }`}
            >
                <Icon name="folder-opened" />
                <span>workspace</span>
            </div>

            <div
                className="flex-1 overflow-y-auto"
                onContextMenu={(e) => {
                    if (readOnly) {
                        e.preventDefault();
                        return;
                    }
                    openRootContextMenu(e);
                }}
            >
                {rootState.status === 'loading' && (
                    <div className="px-3 py-4 text-xs text-[#8a8a8a]">読み込み中...</div>
                )}

                {rootState.status === 'error' && (
                    <div className="px-3 py-4 flex flex-col items-start gap-2">
                        <span className="text-xs font-bold text-[#f44747]">
                            <Icon name="warning" /> 通信エラー
                        </span>
                        <span className="text-[11px] text-[#8a8a8a]">ファイル一覧を取得できませんでした</span>
                        <button
                            onClick={loadRoot}
                            className="mt-1 px-2.5 py-1 rounded-md bg-[#3c3c3c] hover:bg-[#4a4a4a] text-[11px] font-bold text-[#cccccc] transition-colors"
                        >
                            再試行
                        </button>
                    </div>
                )}

                {rootState.status === 'ready' && visibleRootItems.length === 0 && (
                    <div className="px-3 py-4 text-xs text-[#8a8a8a]">ファイルがありません</div>
                )}

                {rootState.status === 'ready' &&
                    visibleRootItems.map((item) => (
                        <TreeNode
                            key={item.path}
                            item={item}
                            depth={0}
                            activeFilePath={activeFilePath}
                            activeDirPath={activeDirPath}
                            expandedPaths={expandedPaths}
                            childStates={childStates}
                            showHiddenFiles={showHiddenFiles}
                            onToggleDir={handleToggleDir}
                            onSelectFile={handleSelectFile}
                            onCreate={handleCreate}
                            onRename={handleRename}
                            onDelete={handleDelete}
                            onDropMove={handleDropMove}
                            onContextMenu={openItemContextMenu}
                            readOnly={readOnly}
                        />
                    ))}
            </div>

            <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />
            <PromptModal state={promptModal} onClose={() => setPromptModal(null)} />
            <ConfirmModal state={confirmModal} onClose={() => setConfirmModal(null)} />
        </div>
    );
}
