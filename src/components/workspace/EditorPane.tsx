'use client';

import React, { useEffect, useRef, useState } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { OpenFile } from './types';
import { FileIcon } from './FileIcon';
import { MarkdownPreview } from './MarkdownPreview';
import { Icon } from './Icon';
import { useLspDocument } from './lsp/useLspDocument';
import { RunAction } from './runCommand';
import { useLiveEditorSync } from './live/useLiveEditorSync';
import { LiveMessage } from './live/liveTypes';

interface EditorPaneProps {
    classId: string;
    openFiles: OpenFile[];
    activeFilePath: string | null;
    isLoading: boolean;
    errorMessage: string | null;
    onSelectTab: (path: string) => void;
    onCloseTab: (path: string) => void;
    onChange: (path: string, content: string) => void;
    onSave: () => void;
    // 「実行」ボタン。runActionはWorkspaceLayoutがactiveFileの拡張子から
    // 決めたアクション種別 - .py/.js/.go/.shは'terminal'(ターミナルへ送信する
    // コマンド付き)、.html/.htmは'preview'(Webプレビューを直接開く、
    // ターミナルは経由しない)、それ以外は'none'(ボタンを非活性にする)。
    // onRunはクリック時に呼ぶだけで、保存→実際の分岐処理は全て
    // WorkspaceLayout側が担う。
    runAction: RunAction;
    onRun: () => void;
    // 「Webプレビュー」トグル。開閉状態自体はWorkspaceLayoutが持つ(Monaco
    // Editorの右側にsplit表示するレイアウト側の都合のため)。
    isWebPreviewOpen: boolean;
    onToggleWebPreview: () => void;
    // 講師による生徒セッションのリアルタイム監視・共同操作(ライブセッション
    // 同期)。WorkspaceLayoutが1本だけ持つWebSocket接続への送信関数を、
    // タブごとのuseLiveEditorSync(EditorTabBody内)へそのまま渡す。
    liveSend: (msg: LiveMessage) => void;
    // asUserId: 講師サポート画面が生徒本人の代わりにこのペインを操作している
    // 場合の対象生徒ID(useLspDocument経由でlspManager.tsのチケット発行先を
    // 切り替えるためだけに使う - ファイルの取得/保存自体はsecuredFetchの
    // as_userクエリパラメータで既に対応済みのため、ここでは関与しない)。
    asUserId?: string;
    // readOnly: クラスメイト間の相互閲覧(Peer Viewer)モード。Monaco自体を
    // 編集不可にし、実行/Webプレビュー/保存状態表示などの編集系ツールバーを
    // 隠す(タブの切り替え自体は引き続き行える - 複数ファイルの参照は許可)。
    // LSP補完も無効化する(useLspDocumentのenabled引数参照)。
    readOnly?: boolean;
}

type EditorMode = 'edit' | 'preview';

// 1ファイル分のMonacoエディタ本体。非アクティブなタブでもアンマウントせず
// hiddenで隠すだけにする(TerminalsPaneの各ターミナルタブと同じ手法) -
// こうしないとタブを切り替えるたびにMonacoのundo履歴・カーソル位置・
// スクロール位置が失われてしまい、VS Codeのような複数ファイル編集として
// 機能しない。
function EditorTabBody({
    classId,
    file,
    mode,
    active,
    onChange,
    liveSend,
    asUserId,
    readOnly,
}: {
    classId: string;
    file: OpenFile;
    mode: EditorMode;
    active: boolean;
    onChange: (path: string, content: string) => void;
    liveSend: (msg: LiveMessage) => void;
    asUserId?: string;
    readOnly?: boolean;
}) {
    const isMarkdown = file.name.toLowerCase().endsWith('.md');
    // editor/monacoはrefではなくstateに持つ - useLspDocument(下記)のeffectが
    // 「mountされて実際に使えるようになった瞬間」に反応して発火できるように
    // するため(refの代入自体はレンダーをトリガーしない)。
    const [editorInstance, setEditorInstance] = useState<Parameters<OnMount>[0] | null>(null);
    const [monacoInstance, setMonacoInstance] = useState<Parameters<OnMount>[1] | null>(null);
    const handleMount: OnMount = (editor, monaco) => {
        setEditorInstance(editor);
        setMonacoInstance(monaco);
    };
    // Monacoは非表示にしてもDOM上は存在し続けるので、再表示時にeditor.layout()を
    // 呼ばないと描画が崩れたままになることがある(hidden→visibleの既知の癖)。
    useEffect(() => {
        if (active) editorInstance?.layout();
    }, [active, mode, editorInstance]);

    // 拡張子に対応する言語サーバーが.ai/lsp-config.jsonに設定されていれば、
    // 補完・ホバー・診断(赤波線)を有効にする(言語非依存 - Python固有の
    // コードはここには無い、lsp/ディレクトリ参照)。未設定の拡張子では
    // 何も起きない。
    useLspDocument(classId, file, monacoInstance, editorInstance, asUserId, !readOnly);

    // 講師による生徒セッションのリアルタイム監視・共同操作(ライブセッション
    // 同期)。開いている間だけレジストリに登録し、ローカルでの変更/カーソル
    // 移動を送信する(受信した変更の適用自体はWorkspaceLayout.tsxが一括で
    // 行う)。readOnly(クラスメイト間の相互閲覧)時もレジストリへの登録は
    // 必要(対象生徒の変更/カーソルを受信して反映するため)だが、Monaco自体が
    // 編集不可なのでonDidChangeContentがローカル入力で発火することは無く、
    // 実質「受信専用」として働く。
    useLiveEditorSync(file.path, monacoInstance, editorInstance, liveSend, '生徒', (content) =>
        onChange(file.path, content),
    );

    return (
        <div className={active ? 'h-full' : 'hidden'}>
            <div className={mode === 'edit' || !isMarkdown ? 'h-full' : 'hidden'}>
                <Editor
                    height="100%"
                    language={file.language}
                    value={file.content}
                    theme="vs-dark"
                    onChange={(value) => onChange(file.path, value ?? '')}
                    onMount={handleMount}
                    options={{
                        automaticLayout: true,
                        fontSize: 14,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        readOnly: !!readOnly,
                    }}
                />
            </div>
            {isMarkdown && mode === 'preview' && (
                <div className="h-full">
                    <MarkdownPreview content={file.content} />
                </div>
            )}
        </div>
    );
}

export function EditorPane({
    classId,
    openFiles,
    activeFilePath,
    isLoading,
    errorMessage,
    onSelectTab,
    onCloseTab,
    onChange,
    onSave,
    runAction,
    onRun,
    isWebPreviewOpen,
    onToggleWebPreview,
    liveSend,
    asUserId,
    readOnly,
}: EditorPaneProps) {
    const activeFile = openFiles.find((f) => f.path === activeFilePath) ?? null;
    const isMarkdown = !!activeFile && activeFile.name.toLowerCase().endsWith('.md');

    // Ctrl/Cmd+Sは編集モード・プレビューモード両方で効くよう、Monaco自身の
    // キーバインドではなくこのペイン全体のonKeyDownで一箇所にまとめて処理する
    // (プレビュー中はMonacoが非表示=フォーカスを持たないため、Monaco自身の
    // addCommandでは拾えない)。常に「今アクティブなタブ」を保存する
    // (呼び出し元のonSaveがそう実装されている)。refで常に最新のonSaveを参照する。
    const onSaveRef = useRef(onSave);
    useEffect(() => {
        onSaveRef.current = onSave;
    }, [onSave]);

    const [mode, setMode] = useState<EditorMode>('edit');
    // 別のタブに切り替えたら常に編集モードへ戻す(プレビューを見ていたタブから
    // 別のファイルに切り替えたのに、プレビュー画面のまま残ってしまうと
    // 分かりづらいため)。
    useEffect(() => {
        setMode('edit');
    }, [activeFilePath]);

    // 保存成功のトースト的な表示(Ctrl+S/保存ボタン共通)。isSavingがtrue→false
    // に変わった瞬間にエラーが無ければ「保存しました」を数秒だけ出す
    // (それまではdirtyドットが消えるだけで成功が視覚的に分かりにくかったため)。
    // タブを切り替えた瞬間は前のタブの状態を引きずらないようリセットする。
    const [showSavedBadge, setShowSavedBadge] = useState(false);
    const wasSavingRef = useRef(false);
    useEffect(() => {
        setShowSavedBadge(false);
        wasSavingRef.current = activeFile?.isSaving ?? false;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeFilePath]);
    useEffect(() => {
        const isSaving = activeFile?.isSaving ?? false;
        const wasSaving = wasSavingRef.current;
        wasSavingRef.current = isSaving;
        if (wasSaving && !isSaving && !activeFile?.saveError) {
            setShowSavedBadge(true);
            const timer = window.setTimeout(() => setShowSavedBadge(false), 2000);
            return () => window.clearTimeout(timer);
        }
    }, [activeFile?.isSaving, activeFile?.saveError]);

    const handleKeyDownCapture = (e: React.KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            onSaveRef.current();
        }
    };

    if (openFiles.length === 0) {
        return (
            <div className="flex flex-col h-full min-h-0 bg-[#1e1e1e] items-center justify-center gap-2 text-sm px-6 text-center">
                {isLoading && <span className="text-[#8a8a8a]">ファイルを読み込んでいます...</span>}
                {!isLoading && errorMessage && (
                    <span className="text-[#f44747] font-bold">
                        <Icon name="warning" /> 通信エラー: {errorMessage}
                    </span>
                )}
                {!isLoading && !errorMessage && (
                    <span className="text-[#8a8a8a]">左のファイル一覧からファイルを選択してください</span>
                )}
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full min-h-0 bg-[#1e1e1e]" onKeyDownCapture={handleKeyDownCapture}>
            {/* タブバー: 開いている全ファイル + (右側)今アクティブなタブに対する操作 */}
            <div className="flex items-stretch justify-between bg-[#252526] border-b border-[#3c3c3c] shrink-0 min-w-0">
                <div className="flex items-stretch overflow-x-auto min-w-0">
                    {openFiles.map((f) => {
                        const isDirty = f.content !== f.savedContent;
                        const isActive = f.path === activeFilePath;
                        return (
                            <div
                                key={f.path}
                                role="button"
                                tabIndex={0}
                                title={f.path}
                                onClick={() => onSelectTab(f.path)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') onSelectTab(f.path);
                                }}
                                className={`group flex items-center gap-1.5 px-3 py-2 text-sm shrink-0 border-r border-t-2 border-[#3c3c3c] cursor-pointer transition-colors ${
                                    isActive
                                        ? 'bg-[#1e1e1e] text-white border-t-[#007acc]'
                                        : 'text-[#969696] hover:bg-[#2a2d2e] border-t-transparent'
                                }`}
                            >
                                <FileIcon name={f.name} />
                                <span className="whitespace-nowrap">{f.name}</span>
                                <button
                                    type="button"
                                    title="閉じる"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onCloseTab(f.path);
                                    }}
                                    className="ml-1 rounded p-0.5 hover:bg-[#4a4a4a] transition-colors shrink-0"
                                >
                                    {isDirty ? (
                                        <>
                                            <Icon name="circle-filled" className="group-hover:hidden" />
                                            <Icon name="close" className="hidden group-hover:inline" />
                                        </>
                                    ) : (
                                        <Icon name="close" className="opacity-0 group-hover:opacity-100" />
                                    )}
                                </button>
                            </div>
                        );
                    })}
                </div>

                <div className="flex items-center gap-2 px-3 shrink-0">
                    {isMarkdown && (
                        <div className="flex items-center rounded-md bg-[#1e1e1e] border border-[#3c3c3c] overflow-hidden mr-1">
                            <button
                                onClick={() => setMode('edit')}
                                className={`px-2.5 py-1 text-[11px] font-bold transition-colors ${
                                    mode === 'edit' ? 'bg-[#0e639c] text-white' : 'text-[#cccccc] hover:bg-[#3c3c3c]'
                                }`}
                            >
                                編集
                            </button>
                            <button
                                onClick={() => setMode('preview')}
                                className={`px-2.5 py-1 text-[11px] font-bold transition-colors ${
                                    mode === 'preview' ? 'bg-[#0e639c] text-white' : 'text-[#cccccc] hover:bg-[#3c3c3c]'
                                }`}
                            >
                                プレビュー
                            </button>
                        </div>
                    )}
                    {!readOnly && (
                        <>
                            {activeFile?.isSaving && <span className="text-[11px] text-[#8a8a8a]">保存中...</span>}
                            {activeFile && !activeFile.isSaving && activeFile.saveError && (
                                <span className="text-[11px] text-[#f44747]" title={activeFile.saveError}>
                                    <Icon name="warning" /> 保存に失敗しました
                                </span>
                            )}
                            {activeFile && !activeFile.isSaving && !activeFile.saveError && showSavedBadge && (
                                <span className="text-[11px] text-[#6a9955]">
                                    <Icon name="check" /> 保存しました
                                </span>
                            )}
                            <button
                                onClick={onToggleWebPreview}
                                title={
                                    runAction.kind === 'preview'
                                        ? 'このHTMLファイルをプレビュー'
                                        : 'Webプレビュー(http://localhost:5000)'
                                }
                                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-bold transition-colors ${
                                    isWebPreviewOpen
                                        ? 'bg-[#0e639c] text-white'
                                        : 'bg-[#3c3c3c] hover:bg-[#4a4a4a] text-[#cccccc]'
                                }`}
                            >
                                <Icon name="browser" />
                                Webプレビュー
                            </button>
                            <button
                                onClick={onRun}
                                disabled={runAction.kind !== 'terminal'}
                                title={runAction.kind === 'terminal' ? `実行: ${runAction.command}` : '実行不可能なファイルです'}
                                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-bold transition-colors ${
                                    runAction.kind === 'terminal'
                                        ? 'bg-[#238636] hover:bg-[#2ea043] text-white'
                                        : 'bg-[#3c3c3c] text-[#6a6a6a] cursor-not-allowed'
                                }`}
                            >
                                <Icon name="play" />
                                実行
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* エディタ本体: 開いている全タブ分マウントしたまま、非アクティブは隠す */}
            <div className="flex-1 min-h-0 relative">
                {openFiles.map((f) => (
                    <EditorTabBody
                        key={f.path}
                        classId={classId}
                        file={f}
                        mode={mode}
                        active={f.path === activeFilePath}
                        onChange={onChange}
                        liveSend={liveSend}
                        asUserId={asUserId}
                        readOnly={readOnly}
                    />
                ))}
            </div>
        </div>
    );
}
