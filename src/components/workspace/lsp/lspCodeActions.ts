import type { OnMount } from '@monaco-editor/react';

// `@monaco-editor/react`のOnMountコールバックの第2引数の型からmonaco名前空間の
// 型を借りる(lspProviders.tsと同じ理由 - monaco-editorパッケージを直接
// importせずに済む)。
type Monaco = Parameters<OnMount>[1];
type EditorModel = ReturnType<Monaco['editor']['getModel']>;
type CodeActionProvider = Parameters<Monaco['languages']['registerCodeActionProvider']>[1];
type ProvideCodeActionsArgs = Parameters<NonNullable<CodeActionProvider['provideCodeActions']>>;

// Flask(sandbox-base イメージに標準搭載、ai-education-backend/sandbox-images/
// sandbox-base/Dockerfile参照)の代表的な公開シンボル→インポート元モジュール。
// pyright自身のプロジェクト解析(自動import機能)には頼らず、あくまで
// 「よくあるうっかりimport忘れ」を助けるための決め打ちの簡易対応表 -
// 生徒が最初に書くFlaskアプリで実際によく使う名前を優先して収録している。
const KNOWN_IMPORTS: Record<string, string> = {
    Flask: 'flask',
    Blueprint: 'flask',
    Response: 'flask',
    render_template: 'flask',
    render_template_string: 'flask',
    request: 'flask',
    redirect: 'flask',
    url_for: 'flask',
    jsonify: 'flask',
    session: 'flask',
    abort: 'flask',
    flash: 'flask',
    make_response: 'flask',
    send_file: 'flask',
    send_from_directory: 'flask',
    current_app: 'flask',
    g: 'flask',
};

// pyrightの`"X" is not defined`(reportUndefinedVariable)という診断メッセージ
// から識別子名を取り出す。
const UNDEFINED_VARIABLE_PATTERN = /^"([A-Za-z_][A-Za-z0-9_]*)" is not defined$/;

function extractUndefinedName(message: string, code: string | undefined): string | null {
    // codeが取れている場合は`reportUndefinedVariable`以外を弾く(誤検出防止)。
    // 言語サーバーによってはcodeを送ってこないこともあるので、その場合は
    // メッセージの形だけで判定する。
    if (code && code !== 'reportUndefinedVariable') return null;
    const match = UNDEFINED_VARIABLE_PATTERN.exec(message.trim());
    return match ? match[1] : null;
}

type ImportInsertion =
    // 既にそのモジュールから同じシンボルがimport済み - 何もしない
    // (診断が「未定義」と言っている以上まず起きないはずだが、念のための
    // 安全弁 - buildImportEditへ進めず、呼び出し元でアクション自体を
    // 出さないようにする)。
    | { kind: 'already-imported' }
    // 既存の`from <module> import ...`行にシンボルを追記する。
    | { kind: 'append'; lineNumber: number; newText: string }
    // 新しい行として挿入する(直前に挿入。ファイル末尾より後ろ=lineCount+1を
    // 指すこともある - 既存importの直後がファイル末尾そのもの、というケース)。
    | { kind: 'insert'; lineNumber: number };

// ファイル先頭を素朴に走査し、`from <module> import <name>`の挿入位置を
// 決める。既に同じモジュールからのimport行があれば、そこにシンボルを
// 追記する形にする(2本目の重複するfrom-import行を増やさないため)。
// AST解析はせず、あくまで「よくある単純なファイル構造」向けの簡易ロジック。
function planImportInsertion(model: EditorModel, moduleName: string, symbolName: string): ImportInsertion {
    const lineCount = model!.getLineCount();
    const fromImportRe = new RegExp(`^from\\s+${moduleName}\\s+import\\s+(.+)$`);
    let insertAfterLine = 0;
    let sawImport = false;

    for (let line = 1; line <= lineCount; line++) {
        const text = model!.getLineContent(line);
        const trimmed = text.trim();

        const match = fromImportRe.exec(trimmed);
        if (match) {
            const names = match[1].split(',').map((n) => n.trim());
            if (names.includes(symbolName)) return { kind: 'already-imported' };
            return { kind: 'append', lineNumber: line, newText: `${text}, ${symbolName}` };
        }

        if (trimmed === '' || trimmed.startsWith('#')) {
            // まだimport行に出会っていなければ、先頭のシェバン/コメント/空行の
            // 直後を候補にしておく(シェバンの前に挿入してしまわないため)。
            if (!sawImport) insertAfterLine = line;
            continue;
        }
        if (/^(import\s+|from\s+\S+\s+import\s+)/.test(trimmed)) {
            sawImport = true;
            insertAfterLine = line;
            continue;
        }
        break; // import/コメント/空行以外の実コードに到達したら走査終了
    }

    return { kind: 'insert', lineNumber: insertAfterLine + 1 };
}

// insertionが'already-imported'の場合はnullを返す(呼び出し側でアクション
// 自体を出さない)。
function buildImportEdit(
    model: EditorModel,
    insertion: ImportInsertion,
    moduleName: string,
    symbolName: string,
): { range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }; text: string } | null {
    if (insertion.kind === 'already-imported') return null;

    const importStatement = `from ${moduleName} import ${symbolName}`;

    if (insertion.kind === 'append') {
        const { lineNumber, newText } = insertion;
        return {
            range: {
                startLineNumber: lineNumber,
                startColumn: 1,
                endLineNumber: lineNumber,
                endColumn: model!.getLineMaxColumn(lineNumber),
            },
            text: newText,
        };
    }

    const lineCount = model!.getLineCount();
    if (insertion.lineNumber > lineCount) {
        // 既存importの直後がファイル末尾そのもの - 最終行の末尾に改行込みで追記する。
        const lastLineLength = model!.getLineMaxColumn(lineCount);
        return {
            range: { startLineNumber: lineCount, startColumn: lastLineLength, endLineNumber: lineCount, endColumn: lastLineLength },
            text: `\n${importStatement}`,
        };
    }

    return {
        range: { startLineNumber: insertion.lineNumber, startColumn: 1, endLineNumber: insertion.lineNumber, endColumn: 1 },
        text: `${importStatement}\n`,
    };
}

let registered = false;

// Python向けのクイックフィックス(💡)プロバイダ。診断(publishDiagnostics→
// Monacoマーカー、lspProviders.ts参照)のうち「未定義変数」と分かるものを
// 対象に、KNOWN_IMPORTSにある既知のシンボルであれば「importを追加する」
// 修正を提案する。言語サーバーへ新たにリクエストは投げない、完全に
// クライアント側だけで完結する簡易実装(rename/call hierarchy等の高度な
// 機能はこの実装のスコープ外)。
export function ensurePythonCodeActionProviderRegistered(monaco: Monaco): void {
    if (registered) return;
    registered = true;

    monaco.languages.registerCodeActionProvider('python', {
        provideCodeActions: (
            model: ProvideCodeActionsArgs[0],
            _range: ProvideCodeActionsArgs[1],
            context: ProvideCodeActionsArgs[2],
        ) => {
            const actions: Array<{
                title: string;
                kind: string;
                diagnostics: unknown[];
                isPreferred: boolean;
                edit: { edits: Array<{ resource: unknown; textEdit: unknown; versionId: number }> };
            }> = [];
            const offered = new Set<string>();

            for (const marker of context.markers) {
                if (marker.owner !== 'lsp') continue;
                const name = extractUndefinedName(marker.message, marker.code as string | undefined);
                if (!name || offered.has(name)) continue;
                const moduleName = KNOWN_IMPORTS[name];
                if (!moduleName) continue;
                offered.add(name);

                const insertion = planImportInsertion(model, moduleName, name);
                const textEdit = buildImportEdit(model, insertion, moduleName, name);
                if (!textEdit) continue; // 既にimport済み(通常は診断自体が出ないはずの安全弁)

                actions.push({
                    title: `"${moduleName}" から ${name} をインポート`,
                    kind: 'quickfix',
                    diagnostics: [marker],
                    isPreferred: true,
                    edit: {
                        edits: [{ resource: model.uri, textEdit, versionId: model.getVersionId() }],
                    },
                });
            }

            return { actions, dispose: () => {} };
        },
    });
}
