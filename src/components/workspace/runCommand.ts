import { SANDBOX_WORKSPACE_PATH } from './types';

// activeFilePathは常にSANDBOX_WORKSPACE_PATH配下の絶対パス
// (ResolveSandboxPath、program_service.go)。ここから「プロジェクトルート
// (ワークスペースルート)からの相対パス」を取り出す。
export function relativeToWorkspace(absolutePath: string): string {
    const prefix = `${SANDBOX_WORKSPACE_PATH}/`;
    if (absolutePath.startsWith(prefix)) return absolutePath.slice(prefix.length);
    if (absolutePath === SANDBOX_WORKSPACE_PATH) return '';
    // ワークスペース外のパスは通常来ない想定だが、念のため先頭のスラッシュ
    // だけ落として素通しする。
    return absolutePath.replace(/^\/+/, '');
}

// シェルのダブルクォート文字列として安全に埋め込めるようエスケープする
// (バックスラッシュ→エスケープ、ダブルクォート→エスケープ)。ファイル名/
// ディレクトリ名に空白が含まれる場合に、パス全体を1つの引数として渡す
// ための引用符付け。
function quoteForShell(value: string): string {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// 拡張子(ドット無し・小文字)→実行コマンドの組み立て関数。対応表に無い
// 拡張子(.json/.md/.html/.css等)は「実行不可能なファイル」として扱う。
const RUN_COMMAND_BUILDERS: Record<string, (quotedRelativePath: string) => string> = {
    py: (p) => `python3 ${p}`,
    js: (p) => `node ${p}`,
    go: (p) => `go run ${p}`,
    sh: (p) => `bash ${p}`,
};

// .py/.js/.go/.sh等(.html以外の実行可能ファイル)を「Webプレビュー」ボタン
// (実行ボタンとは別、WorkspaceLayout.handleToggleWebPreview参照)で開いた
// 時に既定で表示するURL。生徒のプログラムが実際に何番のポートでlisten
// するかはコード次第で分からないため、教育用サンドボックスでの定番
// (Flaskの開発サーバー既定ポート)をそのまま既定値にする -
// WebPreviewPane自身の「URLモード」の既定値(DEFAULT_URL)と同じ値を共有
// し、ここを起点に生徒が実際のポートへURLバーで変更できる。
export const DEFAULT_PREVIEW_SERVER_URL = 'http://localhost:5000';

// 「実行」ボタンが実際に行うアクションの種別。プレビューパネルの開閉は
// 一切担わない(「Webプレビュー」ボタンの専任、WorkspaceLayout参照) -
// このボタンは純粋に「プログラムを実行する/しない」だけを表す。
// - kind:'terminal'(.py/.js/.go/.sh): ターミナルへ起動コマンドを送信する。
// - kind:'preview'(.html/.htm): サーバープロセスとして実行するものが無い
//   ため、「実行」ボタン自体は非活性にする(プレビューは「Webプレビュー」
//   ボタン側でこの種別を見て静的ファイル表示に切り替える)。
// - kind:'none': それ以外の拡張子(.json/.md/.css等)。実行不可能 - ボタンを
//   非活性にする。
export type RunAction = { kind: 'terminal'; command: string } | { kind: 'preview' } | { kind: 'none' };

const PREVIEW_EXTENSIONS = new Set(['html', 'htm']);

// activeFilePath(開いているファイルの絶対パス)から、「実行」ボタンが行う
// べきアクションを決める。
export function resolveRunAction(absolutePath: string): RunAction {
    const name = absolutePath.split('/').pop() ?? '';
    const dotIndex = name.lastIndexOf('.');
    if (dotIndex <= 0) return { kind: 'none' }; // 拡張子なし、またはドット始まりの隠しファイル
    const ext = name.slice(dotIndex + 1).toLowerCase();

    if (PREVIEW_EXTENSIONS.has(ext)) return { kind: 'preview' };

    const build = RUN_COMMAND_BUILDERS[ext];
    if (!build) return { kind: 'none' };
    return { kind: 'terminal', command: build(quoteForShell(relativeToWorkspace(absolutePath))) };
}
