import type { OnMount } from '@monaco-editor/react';
import { LiveEditorChangeMessage, LiveEditorCursorMessage } from './liveTypes';

type MonacoEditor = Parameters<OnMount>[0];
type Monaco = Parameters<OnMount>[1];

interface RegisteredLiveModel {
    editor: MonacoEditor;
    monaco: Monaco;
    // applyingRemote: リモートの変更をmodel.applyEdits()で反映している間だけ
    // trueにするガード。これが無いと、リモート変更の適用が
    // onDidChangeContentを再度発火させ、それをまた送信してしまう
    // (無限にエコーし合う)。
    applyingRemote: { current: boolean };
    cursorDecorationIds: string[];
    // onRemoteChange: applyIncomingEditorChangeがmodel.applyEdits()した直後、
    // 更新後の全文で呼ばれる。呼び出し元(EditorTabBody/
    // TeacherLiveSessionModal)はこれで自分が持つReact stateのcontentも
    // 更新する必要がある - @monaco-editor/reactの<Editor value=.../>は
    // 「valueプロパティとmodelの現在値が食い違っていたら強制的にmodelへ
    // 書き戻す」ため、これを怠るとリモートの変更が次の再レンダーで古い
    // valueによって巻き戻されてしまう。
    onRemoteChange?: (content: string) => void;
}

// path(ワークスペース絶対パス)→今このタブで開いているMonacoエディタ、の
// 対応表。lspManager.tsのliveDocuments(LSP用)と全く同じ考え方 -
// useLiveEditorSync.ts(送信側、タブごとにマウント)とWorkspaceLayout.tsx
// (受信側、WebSocket 1本をまとめて持つ)を仲介する。
const registry = new Map<string, RegisteredLiveModel>();

export function registerLiveEditorModel(path: string, entry: RegisteredLiveModel): void {
    registry.set(path, entry);
}

export function unregisterLiveEditorModel(path: string): void {
    const entry = registry.get(path);
    if (entry) {
        entry.editor.deltaDecorations(entry.cursorDecorationIds, []);
    }
    registry.delete(path);
}

const injectedCursorNameStyles = new Set<string>();

// ensureCursorNameStyleInjected: リモートカーソルの「名前バナー」を、
// Monacoの装飾オプション(CSSクラス名しか指定できない)経由でも実際の名前
// 文字列を表示できるようにするため、名前ごとに1回だけ
// `::after{content:"..."}`規則を動的に<style>として注入する
// (VS Code Live Share等でも使われる手法)。
function ensureCursorNameStyleInjected(name: string): string {
    const safeName = name.replace(/[^a-zA-Z0-9_぀-ヿ一-鿿]/g, '') || 'guest';
    const className = `live-remote-cursor-label-${safeName}`;
    if (injectedCursorNameStyles.has(className)) return className;
    injectedCursorNameStyles.add(className);
    const style = document.createElement('style');
    style.textContent = `.${className}::after { content: "👨‍🏫 ${name}"; }`;
    document.head.appendChild(style);
    return className;
}

// applyIncomingEditorChange applies a remote content change to the LOCAL
// model for the same path, if this tab currently has it open - もし開いて
// いなければ何もしない(そのファイルを自分で開くまでは見えないだけで、
// エラーにはしない)。
export function applyIncomingEditorChange(msg: LiveEditorChangeMessage): void {
    const entry = registry.get(msg.path);
    if (!entry) return;
    const model = entry.editor.getModel();
    if (!model) return;

    entry.applyingRemote.current = true;
    try {
        model.applyEdits(
            msg.changes.map((change) => ({
                range: new entry.monaco.Range(
                    change.range.startLineNumber,
                    change.range.startColumn,
                    change.range.endLineNumber,
                    change.range.endColumn,
                ),
                text: change.text,
            })),
        );
        entry.onRemoteChange?.(model.getValue());
    } finally {
        entry.applyingRemote.current = false;
    }
}

// applyIncomingCursor draws (or clears) the remote cursor decoration -
// editor.deltaDecorations()を使い、前回分を置き換える形で常に最新の1つだけ
// 残す。
export function applyIncomingCursor(msg: LiveEditorCursorMessage): void {
    const entry = registry.get(msg.path);
    if (!entry) return;

    const decorations = msg.position
        ? [
              {
                  range: new entry.monaco.Range(
                      msg.position.lineNumber,
                      msg.position.column,
                      msg.position.lineNumber,
                      msg.position.column,
                  ),
                  options: {
                      className: 'live-remote-cursor',
                      afterContentClassName: ensureCursorNameStyleInjected(msg.name || '先生'),
                      stickiness: entry.monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
                  },
              },
          ]
        : [];
    entry.cursorDecorationIds = entry.editor.deltaDecorations(entry.cursorDecorationIds, decorations);
}
