'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Sidebar } from './Sidebar';
import { EditorPane } from './EditorPane';
import { WebPreviewPane, PreviewRequest } from './WebPreviewPane';
import { TerminalsPane, TerminalsHandle } from './TerminalsPane';
import { ConnectionPhase } from './TerminalPane';
import { AiChatPane } from './AiChatPane';
import { ResizeHandle } from './ResizeHandle';
import { Icon } from './Icon';
import { ToastHost } from './Toast';
import { clamp, FileTreeItem, languageFromFileName, OpenFile } from './types';
import { DEFAULT_PREVIEW_SERVER_URL, resolveRunAction } from './runCommand';
import { securedFetch, setActingAsUser } from '@/src/lib/api';
import { useLiveEditorChannel } from './live/useLiveEditorChannel';
import { applyIncomingCursor, applyIncomingEditorChange } from './live/liveEditorRegistry';
import { LiveMessage } from './live/liveTypes';
import { LiveSessionBanner } from './live/LiveSessionBanner';
import { LiveTerminalPane } from './live/LiveTerminalPane';

const TERMINAL_HEIGHT_MIN = 120;
const TERMINAL_HEIGHT_MAX = 700;
const TERMINAL_HEIGHT_DEFAULT = 260;

const CHAT_WIDTH_MIN = 240;
const CHAT_WIDTH_MAX = 640;
const CHAT_WIDTH_DEFAULT = 340;

const WEB_PREVIEW_WIDTH_MIN = 320;
const WEB_PREVIEW_WIDTH_MAX = 960;
const WEB_PREVIEW_WIDTH_DEFAULT = 480;

// teacherContext: 講師サポート画面(TeacherLiveSessionModal.tsx)がこの
// ワークスペースを「生徒本人の代わりに」開く場合に渡す。設定されている間は
// (1) securedFetchへ?as_user=<asUserId>を自動付与させ(setActingAsUser、
// バックエンドのresolveTeacherActingAs参照)ファイル/Git/公開の各パネルを
// 一切改変せずそのまま対象生徒へ向け直す、(2) ライブセッションのチケット
// 発行を講師向けエンドポイントへ切り替える、(3) AIチャットを非表示にし、
// (4) 複数タブの独立ターミナル(TerminalsPane、生徒本人専用のticket発行に
// 依存)の代わりに生徒と共有する1つのpty(LiveTerminalPane)を使う、という
// 4点だけをこのコンポーネント内で切り替える。それ以外(ファイルツリー・
// エディタ・LSP・Git・公開パネル)は生徒側と全く同じコードパスを通る。
export interface WorkspaceTeacherContext {
    asUserId: string;
    studentName: string;
}

interface WorkspaceLayoutProps {
    isOpen: boolean;
    onClose: () => void;
    classId: string;
    title?: string;
    teacherContext?: WorkspaceTeacherContext;
}

const PHASE_LABEL: Record<ConnectionPhase, string> = {
    connecting: '接続中...',
    open: '接続済み',
    closed: '切断されました',
    error: '接続エラー',
};

const PHASE_DOT: Record<ConnectionPhase, string> = {
    connecting: 'bg-[#cca700] animate-pulse',
    open: 'bg-[#6a9955]',
    closed: 'bg-[#8a8a8a]',
    error: 'bg-[#f44747]',
};

// VS Code風の統合Web IDE画面。教材/コンテナカードのクリックから全画面で起動する
// ワークスペースのルートレイアウト。TopBar / Sidebar / Editor / Terminal / AIChat
// の各領域を組み合わせるだけの器で、ファイルツリー・ファイル内容・ターミナルは
// バックエンド(Docker API経由)と実際に連携している(AIChatは応答生成自体は
// スタブだが、提案の適用→自動コミットは実際のAPIを呼ぶ本物の処理)。
// Git操作(コミット)はSidebar内のSourceControlパネル(GitPanel)に集約しており、
// エディタは複数ファイルを同時にタブで開ける(VS Code風、EditorPane参照)。
// 「保存」は常に今アクティブなタブに対する単一の操作として、左のファイル
// 操作ヘッダー(隠しファイル表示トグルの隣、FileExplorerPane参照)に置く。
export function WorkspaceLayout({ isOpen, onClose, classId, title, teacherContext }: WorkspaceLayoutProps) {
    // 講師サポート画面として開いている間だけ、securedFetchに「代理操作対象」
    // をセットする(src/lib/api.ts参照) - マウント中ずっとではなく、
    // teacherContextの値が変わる・アンマウントされる瞬間に必ず解除する。
    useEffect(() => {
        setActingAsUser(teacherContext?.asUserId ?? null);
        return () => setActingAsUser(null);
    }, [teacherContext?.asUserId]);
    const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
    const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
    // isFileLoading/fileErrorは「まだ1つもタブが開いていない状態で最初の
    // 1つを開こうとしている」時だけ使う(エディタ全体を占有する案内表示)。
    // 既に何か開いている状態で別のファイルを追加で開く場合は、今見えている
    // タブの表示を崩さないよう、失敗時はalert()で軽く知らせるだけにする
    // (FileExplorerPaneの作成/削除/移動の失敗表示と同じ方針)。
    const [isFileLoading, setIsFileLoading] = useState(false);
    const [fileError, setFileError] = useState<string | null>(null);
    const [terminalPhase, setTerminalPhase] = useState<ConnectionPhase>('connecting');
    const [terminalHeight, setTerminalHeight] = useState(TERMINAL_HEIGHT_DEFAULT);
    const [chatWidth, setChatWidth] = useState(CHAT_WIDTH_DEFAULT);
    const [isWebPreviewOpen, setIsWebPreviewOpen] = useState(false);
    const [webPreviewWidth, setWebPreviewWidth] = useState(WEB_PREVIEW_WIDTH_DEFAULT);
    // 「Webプレビュー」ボタンへ「これを表示して」と伝えるための一回性の
    // リクエスト。'file'(静的HTML)と'url'(サーバーのルートURL)を1つの
    // 判別可能ユニオンにまとめている - 以前は2つの独立したstateに分けて
    // いたが、片方を更新してももう片方の古い値が残ったままになり、
    // WebPreviewPane側で両方のeffectが競合して意図しない方が表示される
    // バグがあった(拡張子で完全に排他な1つの状態として扱うことで、この
    // 種の競合を構造的に起こり得なくする)。同じ対象へ再度リクエストしても
    // 確実に読み込み直されるよう、対象そのものだけでなくnonceも含める。
    const [previewRequest, setPreviewRequest] = useState<PreviewRequest | null>(null);
    const terminalsRef = useRef<TerminalsHandle>(null);

    const activeFile = openFiles.find((f) => f.path === activeFilePath) ?? null;
    const runAction = activeFile ? resolveRunAction(activeFile.path) : { kind: 'none' as const };

    // 講師による生徒セッションのリアルタイム監視・共同操作(ライブセッション
    // 同期)。teacherPresenceは講師が参加中かどうか(バナー/共有ターミナルの
    // 表示切り替えに使う)。openFiles/activeFilePathは既にこの上で宣言済み
    // なので、講師が参加した瞬間に「今アクティブなファイルの全文」を
    // そのままeditor-syncとして送れる(refで最新値を保持し、
    // useLiveEditorChannelのonMessageコールバック内の古い値参照を避ける)。
    const [teacherPresence, setTeacherPresence] = useState<{ joined: boolean; name: string }>({
        joined: false,
        name: '',
    });
    const openFilesRef = useRef(openFiles);
    const activeFilePathRef = useRef(activeFilePath);
    // liveSendRef: useLiveEditorChannelがsendを返すのはhandleLiveMessageを
    // 引数として渡した「後」なので、循環を避けるためrefで受け渡す
    // (handleLiveMessage自体は下のuseLiveEditorChannel呼び出しより先に
    // 定義されるが、実際に呼ばれるのは常にその後 - WebSocketの
    // メッセージ受信は非同期のため、refへの代入は間に合っている)。
    const liveSendRef = useRef<(msg: LiveMessage) => void>(() => {});
    useEffect(() => {
        openFilesRef.current = openFiles;
        activeFilePathRef.current = activeFilePath;
    }, [openFiles, activeFilePath]);

    // workspace-refresh(講師のGit/ファイル/公開操作、または生徒側の同操作を
    // 相手へ即時反映させるための合図、liveTypes.ts参照)を受け取るたびに
    // 増分するだけのカウンタ。Sidebar配下の各パネル(FileExplorerPane/
    // HistoryPanel/PublishPanel)はこれをrefreshSignalとして受け取り、値が
    // 変わるたびに自分の状態を再取得する。
    const [workspaceRefreshNonce, setWorkspaceRefreshNonce] = useState(0);

    // git pull/revertやファイル作成/削除等、Monacoのeditor-change中継を
    // 経由しない変更に追従するため、既に開いているタブのうち「ローカルで
    // 未編集(content===savedContent)」のものだけ内容を再取得する - 編集中の
    // タブを問答無用で上書きしてしまわないようにするため。
    const refreshCleanOpenFiles = useCallback(async () => {
        const targets = openFilesRef.current.filter((f) => f.content === f.savedContent);
        for (const target of targets) {
            try {
                const params = new URLSearchParams({ course_id: classId, path: target.path });
                const res = await securedFetch(`/api/v2/program/container/file?${params.toString()}`, {
                    method: 'GET',
                });
                if (!res.ok) continue;
                const data = await res.json().catch(() => ({}));
                const content = data.content ?? '';
                setOpenFiles((prev) =>
                    prev.map((f) => (f.path === target.path && f.content === f.savedContent ? { ...f, content, savedContent: content } : f)),
                );
            } catch {
                // 再取得の失敗は静かに無視する(次のworkspace-refreshか、
                // 手動でのタブ再選択で改めて追従する)。
            }
        }
    }, [classId]);

    // openRemoteFile: 相手(講師/生徒どちらでも)がeditor-openで知らせてきた
    // ファイルへ、自分の画面も追従する。既にタブが開いていればアクティブに
    // 切り替えるだけ、まだ開いていなければ自分自身の権限(securedFetchの
    // as_userクエリ、src/lib/api.ts参照)でファイル内容を取得してから開く -
    // 相手から送られてきたcontentをそのまま信用するのではなく、常に自分の
    // 認可チェックを通した最新の内容を使う。handleSelectFile(下記)とは違い、
    // ここではeditor-openを送り返さない(相手発の追従で新たな追従を誘発する
    // 無限往復を避けるため)。
    const openRemoteFile = useCallback(
        async (path: string, name: string) => {
            if (openFilesRef.current.some((f) => f.path === path)) {
                setActiveFilePath(path);
                return;
            }
            try {
                const params = new URLSearchParams({ course_id: classId, path });
                const res = await securedFetch(`/api/v2/program/container/file?${params.toString()}`, {
                    method: 'GET',
                });
                if (!res.ok) return;
                const data = await res.json().catch(() => ({}));
                const content = data.content ?? '';
                const newFile: OpenFile = {
                    path,
                    name,
                    language: languageFromFileName(name),
                    content,
                    savedContent: content,
                    isSaving: false,
                    saveError: null,
                };
                setOpenFiles((prev) => (prev.some((f) => f.path === path) ? prev : [...prev, newFile]));
                setActiveFilePath(path);
            } catch {
                // 追従に失敗しても致命的ではない(手動でファイルツリーから
                // 開き直せる)。
            }
        },
        [classId],
    );

    const handleLiveMessage = useCallback((msg: LiveMessage) => {
        switch (msg.type) {
            case 'presence': {
                setTeacherPresence({ joined: msg.teacher_joined, name: msg.name || '' });
                if (msg.teacher_joined) {
                    const path = activeFilePathRef.current;
                    const file = openFilesRef.current.find((f) => f.path === path);
                    if (file) {
                        liveSendRef.current({ type: 'editor-open', path: file.path, name: file.name });
                    }
                }
                break;
            }
            case 'editor-change':
                applyIncomingEditorChange(msg);
                break;
            case 'editor-cursor':
                applyIncomingCursor(msg);
                break;
            case 'editor-open':
                void openRemoteFile(msg.path, msg.name);
                break;
            case 'workspace-refresh':
                setWorkspaceRefreshNonce((n) => n + 1);
                if (msg.reason === 'git' || msg.reason === 'file') {
                    void refreshCleanOpenFiles();
                }
                break;
            default:
                break;
        }
    }, [refreshCleanOpenFiles, openRemoteFile]);

    const { send: liveSend } = useLiveEditorChannel({
        ticketPath: teacherContext
            ? '/api/v2/program/teacher/live-session-ticket'
            : '/api/v2/program/container/live-session-ticket',
        ticketBody: teacherContext
            ? { course_id: Number(classId), user_id: teacherContext.asUserId }
            : { course_id: Number(classId) },
        onMessage: handleLiveMessage,
        enabled: isOpen,
    });
    useEffect(() => {
        liveSendRef.current = liveSend;
    }, [liveSend]);

    // onWorkspaceMutated: 自分側(講師/生徒どちらでも)のGit/ファイル/公開の
    // 操作が成功した直後に各パネルから呼ばれ、相手側へworkspace-refreshを
    // 送る(Sidebar.tsx→GitPanel/FileExplorerPane/HistoryPanel/PublishPanel)。
    const handleWorkspaceMutated = useCallback(
        (reason: 'git' | 'file' | 'publish') => {
            liveSend({ type: 'workspace-refresh', reason });
        },
        [liveSend],
    );

    useEffect(() => {
        if (!isOpen) return;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, [isOpen]);

    // ファイルツリーで選択されたファイルを開く。既にタブとして開いていれば
    // (未保存の編集内容を保ったまま)そのタブに切り替えるだけ、まだ開いて
    // いなければ内容を取得して新しいタブとして追加する。
    const handleSelectFile = useCallback(
        async (item: FileTreeItem) => {
            if (openFiles.some((f) => f.path === item.path)) {
                setActiveFilePath(item.path);
                // 講師/生徒どちらが操作した場合でも、相手の画面をこのファイルへ
                // 追従させる(editor-open、双方向のリアルタイム画面共有)。
                liveSend({ type: 'editor-open', path: item.path, name: item.name });
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
                liveSend({ type: 'editor-open', path: item.path, name: item.name });
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
        [classId, openFiles, liveSend],
    );

    const handleEditorChange = useCallback((path: string, content: string) => {
        setOpenFiles((prev) => prev.map((f) => (f.path === path ? { ...f, content } : f)));
    }, []);

    // Ctrl/Cmd+Sまたは保存ボタン(左のファイル操作ヘッダー)から呼ばれる。常に
    // 「今アクティブなタブ」を保存する。保存に成功したらsavedContentを
    // 追従させ、以後「未保存の変更あり」の表示が消えるようにする。保存中に
    // 別のタブへ切り替えられていた場合に備え、保存対象のpathで一貫して
    // 状態を更新する(アクティブが変わっても保存自体はそのタブに対して進む)。
    // async/Promiseを返す実装のままにしておく - Sidebar経由のGitPanelが
    // 「保存(コミット)」前にonBeforeCommitとしてこれをawaitし、未保存の
    // 編集内容をコミット前に確実に書き込ませているため(先に完了を待たないと
    // ファイル書き込みとgit commitが競合し得る)。
    const handleSaveFile = useCallback(async () => {
        const target = openFiles.find((f) => f.path === activeFilePath);
        if (!target || target.content === target.savedContent) return;
        const { path, content } = target;

        setOpenFiles((prev) => prev.map((f) => (f.path === path ? { ...f, isSaving: true, saveError: null } : f)));
        try {
            const res = await securedFetch('/api/v2/program/container/file', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ course_id: Number(classId), path, content }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || '保存に失敗しました');
            setOpenFiles((prev) =>
                prev.map((f) => (f.path === path ? { ...f, savedContent: content, isSaving: false } : f)),
            );
            // 保存(ディスクへの書き込み)はコミット前でもgit statusを変化させる
            // ため、相手側のソース管理パネル(変更ファイル一覧)にも即時反映
            // させる(workspace-refresh、'git'理由)。
            handleWorkspaceMutated('git');
        } catch (err) {
            const message = err instanceof Error ? err.message : '保存に失敗しました';
            setOpenFiles((prev) =>
                prev.map((f) => (f.path === path ? { ...f, isSaving: false, saveError: message } : f)),
            );
        }
    }, [activeFilePath, openFiles, classId, handleWorkspaceMutated]);

    // 「実行」ボタン(EditorPane)。プログラムの実行(保存→ターミナルへの
    // 起動コマンド送信)のみを行い、Webプレビューパネルの開閉には一切
    // 関与しない - プレビューの表示/非表示は「Webプレビュー」ボタン
    // (handleToggleWebPreview、下記)にすべて任せる。runAction.kindが
    // 'terminal'(.py/.js/.go/.sh等)の時だけ有効(EditorPane側でボタンも
    // その時だけ活性化する) - 'preview'(.html/.htm、実行対象がそもそも
    // 無い)と'none'では呼ばれない。
    const handleRunActiveFile = useCallback(async () => {
        if (runAction.kind !== 'terminal') return;
        await handleSaveFile();
        terminalsRef.current?.runInActiveTerminal(runAction.command);
    }, [runAction, handleSaveFile]);

    // 「Webプレビュー」トグルボタン(EditorPane、実行ボタンとは別)。
    // プレビューパネルの開閉・表示内容は完全にこちらが担う。開く時、今
    // アクティブなファイルの種類で表示内容を切り替える(kind:'file'と
    // kind:'url'は互いに排他な1つのユニオン型 - 常にどちらか一方しか
    // 存在しないため、WebPreviewPane側で両方が競合するバグは構造上
    // 起こり得ない):
    //   - runAction.kind==='preview'(.html/.htm): そのファイルを静的
    //     ファイルとして直接表示する(kind:'file'、preview-file静的配信、
    //     preview_handler.go)。
    //   - それ以外(.py/.js/.go/.sh等、または非実行ファイル): 既定の
    //     サーバーURL(http://localhost:5000)をリバースプロキシ経由で
    //     表示する(kind:'url')。実際にサーバーを起動するのは別途
    //     「実行」ボタンの役目。
    // 閉じる時は何もしない。
    const handleToggleWebPreview = useCallback(() => {
        if (!isWebPreviewOpen) {
            setPreviewRequest((prev): PreviewRequest =>
                runAction.kind === 'preview' && activeFile
                    ? { kind: 'file', path: activeFile.path, nonce: (prev?.nonce ?? 0) + 1 }
                    : { kind: 'url', url: DEFAULT_PREVIEW_SERVER_URL, nonce: (prev?.nonce ?? 0) + 1 },
            );
        }
        setIsWebPreviewOpen((v) => !v);
    }, [isWebPreviewOpen, runAction, activeFile]);

    // 未保存の変更を抱えたタブが1つでもあればカード一覧へ戻る前に確認する。
    const handleClose = useCallback(() => {
        if (openFiles.some((f) => f.content !== f.savedContent)) {
            if (!window.confirm('保存されていない変更があります。破棄してカード一覧へ戻りますか？')) return;
        }
        onClose();
    }, [openFiles, onClose]);

    // エディタタブの「×」。未保存の変更があれば個別に確認する。閉じたのが
    // アクティブなタブなら、隣のタブ(無ければ何も開いていない状態)へ切り替える。
    const handleCloseTab = useCallback(
        (path: string) => {
            const target = openFiles.find((f) => f.path === path);
            if (target && target.content !== target.savedContent) {
                if (!window.confirm(`「${target.name}」に保存されていない変更があります。閉じてよろしいですか？`)) {
                    return;
                }
            }
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

    // ファイルツリー側での削除・リネーム/移動が、開いているタブ(またはその
    // 親フォルダ)に影響した場合、エディタ側の表示も追従させる。
    const handlePathRemoved = useCallback(
        (removedPath: string) => {
            const isRemoved = (p: string) => p === removedPath || p.startsWith(`${removedPath}/`);
            setOpenFiles((prev) => prev.filter((f) => !isRemoved(f.path)));
            setActiveFilePath((prevActive) => {
                if (!prevActive || !isRemoved(prevActive)) return prevActive;
                const remaining = openFiles.filter((f) => !isRemoved(f.path));
                if (remaining.length === 0) return null;
                const removedIdx = openFiles.findIndex((f) => f.path === prevActive);
                return remaining[Math.min(removedIdx, remaining.length - 1)]?.path ?? remaining[0].path;
            });
        },
        [openFiles],
    );

    const handlePathRenamed = useCallback((oldPath: string, newPath: string) => {
        const remap = (p: string): string | null => {
            if (p === oldPath) return newPath;
            if (p.startsWith(`${oldPath}/`)) return newPath + p.slice(oldPath.length);
            return null;
        };
        setOpenFiles((prev) =>
            prev.map((f) => {
                const nextPath = remap(f.path);
                if (nextPath === null) return f;
                const name = nextPath.split('/').pop() || nextPath;
                return { ...f, path: nextPath, name, language: languageFromFileName(name) };
            }),
        );
        setActiveFilePath((prevActive) => (prevActive ? remap(prevActive) ?? prevActive : prevActive));
    }, []);

    // AIChatPaneでAI提案が適用(ファイル書き込み+自動コミット)された後に
    // 呼ばれる。適用先を開いているタブがあれば、そのバッファをすでに保存・
    // コミット済みの内容に合わせる - そうしないとエディタ側が古い内容の
    // ままになったり、実際には保存済みなのに「未保存の変更あり」表示が
    // 残ってしまう。
    const handleFileApplied = useCallback((path: string, content: string) => {
        setOpenFiles((prev) =>
            prev.map((f) => (f.path === path ? { ...f, content, savedContent: content } : f)),
        );
    }, []);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex flex-col bg-[#1e1e1e] text-[#cccccc]">
            <ToastHost />

            {/* 講師による生徒セッションのリアルタイム監視・共同操作(ライブ
                セッション同期): 講師が参加している間、画面の一番上に通知
                バナー+共有ターミナルを表示する(生徒本人の画面のみ - 講師
                自身の画面(teacherContext有り)には自分自身についての通知は
                届かない、broadcastPresence参照)。カード一覧へ戻るボタン等の
                通常のTop Navより前に置き、講師がサポート中であることと
                共有ターミナルを最優先で気づけるようにする。*/}
            {!teacherContext && teacherPresence.joined && (
                <>
                    <LiveSessionBanner teacherName={teacherPresence.name} />
                    <div className="h-56 shrink-0 border-b border-[#3c3c3c]">
                        <LiveTerminalPane classId={classId} role="student" />
                    </div>
                </>
            )}

            {/* Top Nav */}
            <div className="h-12 shrink-0 flex items-center justify-between px-4 bg-[#2d2d2d] border-b border-[#3c3c3c]">
                <div className="flex items-center gap-4 min-w-0">
                    <button
                        onClick={handleClose}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold text-[#cccccc] bg-[#3c3c3c] hover:bg-[#4a4a4a] transition-colors shrink-0"
                    >
                        <Icon name="arrow-left" />
                        <span>カード一覧へ戻る</span>
                    </button>
                    <h1 className="text-sm font-bold text-[#ffffff] truncate">{title || 'ワークスペース'}</h1>
                </div>
                {!teacherContext && (
                    <div className="flex items-center gap-3 shrink-0">
                        <span className={`w-2 h-2 rounded-full ${PHASE_DOT[terminalPhase]}`} />
                        <span className="text-xs text-[#cccccc]">{PHASE_LABEL[terminalPhase]}</span>
                    </div>
                )}
            </div>

            {/* Body */}
            <div className="flex-1 flex min-h-0">
                <Sidebar
                    classId={classId}
                    activeFilePath={activeFilePath}
                    onSelectFile={handleSelectFile}
                    onPathRemoved={handlePathRemoved}
                    onPathRenamed={handlePathRenamed}
                    onBeforeCommit={handleSaveFile}
                    isActiveFileDirty={!!activeFile && activeFile.content !== activeFile.savedContent}
                    isSavingActiveFile={activeFile?.isSaving ?? false}
                    onSaveActiveFile={handleSaveFile}
                    onMutated={handleWorkspaceMutated}
                    refreshSignal={workspaceRefreshNonce}
                />

                {/* Main-Left: Editor(+ 任意でWebプレビューをsplit表示、上) + Terminal(下) */}
                <div className="flex-1 flex flex-col min-h-0 border-r border-[#3c3c3c] min-w-0">
                    <div className="flex-1 flex min-h-0">
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
                                onSave={handleSaveFile}
                                runAction={runAction}
                                onRun={handleRunActiveFile}
                                isWebPreviewOpen={isWebPreviewOpen}
                                onToggleWebPreview={handleToggleWebPreview}
                                liveSend={liveSend}
                                asUserId={teacherContext?.asUserId}
                            />
                        </div>
                        {isWebPreviewOpen && (
                            <>
                                <ResizeHandle
                                    axis="x"
                                    onResize={(delta) =>
                                        setWebPreviewWidth((w) =>
                                            clamp(w - delta, WEB_PREVIEW_WIDTH_MIN, WEB_PREVIEW_WIDTH_MAX),
                                        )
                                    }
                                />
                                <div style={{ width: webPreviewWidth }} className="shrink-0 min-h-0 border-l border-[#3c3c3c]">
                                    <WebPreviewPane
                                        classId={classId}
                                        request={previewRequest}
                                        onClose={() => setIsWebPreviewOpen(false)}
                                    />
                                </div>
                            </>
                        )}
                    </div>
                    <ResizeHandle
                        axis="y"
                        onResize={(delta) =>
                            setTerminalHeight((h) => clamp(h - delta, TERMINAL_HEIGHT_MIN, TERMINAL_HEIGHT_MAX))
                        }
                    />
                    <div style={{ height: terminalHeight }} className="shrink-0 min-h-0">
                        {teacherContext ? (
                            // 講師サポート画面: 独立した複数タブターミナル
                            // (TerminalsPane)は生徒本人専用のticket発行に
                            // 依存する(authorizeSandboxRequest、あえて
                            // as_userを通していない)ため使えない - 代わりに
                            // 生徒と共有する1つのpty(LiveTerminalPane)を使う。
                            <LiveTerminalPane classId={classId} role="teacher" targetUserId={teacherContext.asUserId} />
                        ) : (
                            <TerminalsPane ref={terminalsRef} classId={classId} onActivePhaseChange={setTerminalPhase} />
                        )}
                    </div>
                </div>

                {/* 講師サポート画面ではAIチャットを非表示にする(タスク要件:
                    AI Chatの除外)。*/}
                {!teacherContext && (
                    <>
                        <ResizeHandle
                            axis="x"
                            onResize={(delta) => setChatWidth((w) => clamp(w - delta, CHAT_WIDTH_MIN, CHAT_WIDTH_MAX))}
                        />
                        <div style={{ width: chatWidth }} className="shrink-0 min-h-0">
                            <AiChatPane classId={classId} activeFile={activeFile} onFileApplied={handleFileApplied} />
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
