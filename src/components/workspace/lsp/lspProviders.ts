import type { OnMount } from '@monaco-editor/react';
import { getLiveDocument } from './lspManager';

// `@monaco-editor/react`のOnMountコールバックの第2引数の型からmonaco名前空間の
// 型を借りる - monaco-editorパッケージを直接importせずに済む(実体は
// @monaco-editor/reactが動的ロードするグローバルなmonacoインスタンス1つを
// 全エディタで共有している)。
type Monaco = Parameters<OnMount>[1];
type EditorModel = ReturnType<Monaco['editor']['getModel']>;
type Position = { lineNumber: number; column: number };

interface LspPosition {
    line: number;
    character: number;
}

function toLspPosition(position: Position): LspPosition {
    return { line: position.lineNumber - 1, character: position.column - 1 };
}

interface LspCompletionItem {
    label: string;
    kind?: number;
    detail?: string;
    documentation?: string | { value: string };
    insertText?: string;
}

// LSPのCompletionItemKind(数値)→Monacoの`languages.CompletionItemKind`の
// メンバー名。両者は概念は対応するが数値がそのまま一致するとは限らないため、
// 名前を経由してmonaco側の実際の値を引く。
const LSP_COMPLETION_KIND_NAMES: Record<number, string> = {
    1: 'Text',
    2: 'Method',
    3: 'Function',
    4: 'Constructor',
    5: 'Field',
    6: 'Variable',
    7: 'Class',
    8: 'Interface',
    9: 'Module',
    10: 'Property',
    11: 'Unit',
    12: 'Value',
    13: 'Enum',
    14: 'Keyword',
    15: 'Snippet',
    16: 'Color',
    17: 'File',
    18: 'Reference',
    19: 'Folder',
    20: 'EnumMember',
    21: 'Constant',
    22: 'Struct',
    23: 'Event',
    24: 'Operator',
    25: 'TypeParameter',
};

function toMonacoCompletionKind(monaco: Monaco, lspKind: number | undefined): number {
    const name = LSP_COMPLETION_KIND_NAMES[lspKind ?? 1] ?? 'Text';
    const kindEnum = monaco.languages.CompletionItemKind as unknown as Record<string, number>;
    return kindEnum[name] ?? kindEnum.Text;
}

function toDocumentationText(doc: LspCompletionItem['documentation']): string | undefined {
    if (!doc) return undefined;
    return typeof doc === 'string' ? doc : doc.value;
}

interface LspRange {
    start: LspPosition;
    end: LspPosition;
}

interface LspDiagnostic {
    range: LspRange;
    message: string;
    severity?: number;
    // pyrightの`reportUndefinedVariable`等、診断の種別を表すルールコード。
    // CodeActionProvider(lspCodeActions.ts)がクイックフィックス対象の診断を
    // 見分けるのに使う。LSPの仕様上、文字列そのものか{value: ...}の場合がある。
    code?: string | number | { value: string | number };
}

function normalizeDiagnosticCode(code: LspDiagnostic['code']): string | undefined {
    if (code === undefined) return undefined;
    if (typeof code === 'object') return String(code.value);
    return String(code);
}

function toMonacoMarker(monaco: Monaco, diagnostic: LspDiagnostic) {
    const severityMap: Record<number, number> = {
        1: monaco.MarkerSeverity.Error,
        2: monaco.MarkerSeverity.Warning,
        3: monaco.MarkerSeverity.Info,
        4: monaco.MarkerSeverity.Hint,
    };
    return {
        severity: severityMap[diagnostic.severity ?? 1] ?? monaco.MarkerSeverity.Error,
        message: diagnostic.message,
        code: normalizeDiagnosticCode(diagnostic.code),
        startLineNumber: diagnostic.range.start.line + 1,
        startColumn: diagnostic.range.start.character + 1,
        endLineNumber: diagnostic.range.end.line + 1,
        endColumn: diagnostic.range.end.character + 1,
    };
}

export function diagnosticsToMarkers(monaco: Monaco, diagnostics: LspDiagnostic[]) {
    return diagnostics.map((d) => toMonacoMarker(monaco, d));
}

interface LspHoverContents {
    contents: string | { value: string } | Array<string | { value: string }>;
}

function extractHoverText(contents: LspHoverContents['contents']): string {
    if (typeof contents === 'string') return contents;
    if (Array.isArray(contents)) {
        return contents.map((c) => (typeof c === 'string' ? c : c.value)).join('\n\n');
    }
    return contents.value ?? '';
}

const registeredLanguages = new Set<string>();

// 補完・ホバーのMonacoプロバイダは「言語ID」単位でグローバルに一度だけ登録
// する(Monaco自体の制約 - 同じ言語IDに複数回登録すると結果が重複表示される)。
// 実際にどのLSP接続へ転送するかは、呼び出し時にMonacoから渡されるmodelの
// 既定URIからlspManagerの対応表(registerLiveDocument)を引いて決める - 1つの
// 言語IDに複数の拡張子/接続が対応し得るため、言語ID単位ではなくファイル
// (model)ごとに正しい接続へ振り分ける。.ai/lsp-config.jsonが未設定でその
// ファイルに接続が無い場合は、空の結果を返すだけで何もエラーにしない。
export function ensureLanguageProvidersRegistered(monaco: Monaco, languageId: string): void {
    if (registeredLanguages.has(languageId)) return;
    registeredLanguages.add(languageId);

    monaco.languages.registerCompletionItemProvider(languageId, {
        triggerCharacters: ['.'],
        provideCompletionItems: async (model: EditorModel, position: Position) => {
            const live = model && getLiveDocument(model.uri.toString());
            if (!live) return { suggestions: [] };
            try {
                const result = await live.connection.request<unknown>('textDocument/completion', {
                    textDocument: { uri: live.lspUri },
                    position: toLspPosition(position),
                });
                const items: LspCompletionItem[] = Array.isArray(result)
                    ? (result as LspCompletionItem[])
                    : ((result as { items?: LspCompletionItem[] } | null)?.items ?? []);
                const word = model!.getWordUntilPosition(position);
                const range = {
                    startLineNumber: position.lineNumber,
                    endLineNumber: position.lineNumber,
                    startColumn: word.startColumn,
                    endColumn: word.endColumn,
                };
                return {
                    suggestions: items.map((item) => ({
                        label: item.label,
                        kind: toMonacoCompletionKind(monaco, item.kind),
                        detail: item.detail,
                        documentation: toDocumentationText(item.documentation),
                        insertText: item.insertText ?? item.label,
                        range,
                    })),
                };
            } catch {
                return { suggestions: [] };
            }
        },
    });

    monaco.languages.registerHoverProvider(languageId, {
        provideHover: async (model: EditorModel, position: Position) => {
            const live = model && getLiveDocument(model.uri.toString());
            if (!live) return null;
            try {
                const result = await live.connection.request<LspHoverContents | null>('textDocument/hover', {
                    textDocument: { uri: live.lspUri },
                    position: toLspPosition(position),
                });
                if (!result?.contents) return null;
                const text = extractHoverText(result.contents);
                return text ? { contents: [{ value: text }] } : null;
            } catch {
                return null;
            }
        },
    });
}
