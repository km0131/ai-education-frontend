// バックエンドのsandboxWorkspacePath(internal/service/program_service.go)と
// 一致させる - サンドボックスコンテナ内のワークスペースルートは常にここ固定
// (ファイルツリー/エディタのactiveFilePathは常にこの配下の絶対パス)。
export const SANDBOX_WORKSPACE_PATH = '/root/workspace';

// サンドボックスのファイルツリー1エントリ。バックエンドの
// GET /api/v2/program/container/files のレスポンス項目と対応する
// (internal/service/file_service.go の SandboxFileEntry)。
export interface FileTreeItem {
    name: string;
    path: string;
    is_dir: boolean;
    size: number;
}

// Monaco Editorで開いている1ファイル。contentは編集中(未保存かもしれない)の
// バッファ、savedContentは最後にバックエンドへ書き込む/読み込むのに成功した
// 内容のスナップショット。両者が異なる間は「未保存の変更あり」の状態になる。
export interface ActiveFile {
    path: string;
    name: string;
    language: string;
    content: string;
    savedContent: string;
}

// VS Codeのように複数ファイルをタブで同時に開いておくための1タブ分の状態。
// ActiveFileに、保存中/直近の保存エラーというタブ固有の状態を足したもの
// (保存はタブごとに独立して進行するため - 別タブの保存中に他タブを編集
// できる)。
export interface OpenFile extends ActiveFile {
    isSaving: boolean;
    saveError: string | null;
}

// ファイルツリー/エディタタブのファイル種別アイコンは、VS Codeの既定アイコン
// テーマ「Seti」をそのまま使う(FileIcon.tsx/setiIconData.ts参照)。

// 「変更履歴」タブ(HistoryPanel)向けの型。バックエンドの
// internal/service/git_service.go の GitCommit/GitDiffFile/GitCommitDiff と
// 対応する。
export interface GitCommit {
    hash: string;
    author: string;
    message: string;
    date: string;
}

export type GitDiffFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';

export interface GitDiffFile {
    path: string;
    status: GitDiffFileStatus;
}

export interface GitCommitDiff {
    commit: GitCommit;
    files: GitDiffFile[];
    selected_path: string;
    original: string;
    modified: string;
}

// 「ソース管理」パネル(GitPanel、Sidebar.tsx)の変更ファイル一覧向けの型。
// バックエンドのGitStatusEntry(git_service.go)と対応する。
export type GitStatusFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked';

export interface GitStatusFile {
    path: string;
    status: GitStatusFileStatus;
}

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
    py: 'python',
    md: 'markdown',
    js: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    jsx: 'javascript',
    json: 'json',
    html: 'html',
    css: 'css',
    sh: 'shell',
};

export function languageFromFileName(name: string): string {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    return EXTENSION_LANGUAGE_MAP[ext] ?? 'plaintext';
}

export function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

// parentPath/joinPath は常にPOSIX形式(サンドボックスコンテナ内のパス)を
// 前提とする - ブラウザ実行環境のOSに関わらず"/"区切りで扱ってよい。
export function parentPath(p: string): string {
    const idx = p.lastIndexOf('/');
    return idx <= 0 ? '/' : p.slice(0, idx);
}

export function joinPath(dir: string, name: string): string {
    return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;
}
