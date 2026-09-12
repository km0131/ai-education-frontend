'use client';

import { useEffect, useRef } from 'react';
import type { OnMount } from '@monaco-editor/react';
import { registerLiveEditorModel, unregisterLiveEditorModel } from './liveEditorRegistry';
import { LiveMessage } from './liveTypes';

type MonacoEditor = Parameters<OnMount>[0];
type Monaco = Parameters<OnMount>[1];

// カーソル位置イベントは1文字動かすだけでも大量に発火するため、この間隔
// より短い間は送らない(帯域・再描画コストを抑えるための単純な間引き)。
const CURSOR_THROTTLE_MS = 150;

// 講師による生徒セッションのリアルタイム監視・共同操作(ライブセッション
// 同期)。1ファイル分のMonacoモデルを、開いている間だけレジストリ
// (liveEditorRegistry.ts)に登録し、ローカルでの変更/カーソル移動を送信
// する。受信した変更の適用自体は登録されたレジストリ経由で一括して行う
// (WorkspaceLayout.tsx/TeacherLiveSessionModal.tsxのWebSocketメッセージ
// ハンドラ側の責務) - このフックは「送る」側だけを担当する。
export function useLiveEditorSync(
    path: string,
    monaco: Monaco | null,
    editor: MonacoEditor | null,
    send: (msg: LiveMessage) => void,
    myName: string,
    // onRemoteChange: リモートの変更が適用された後、更新後の全文で呼ばれる -
    // 呼び出し元はこれで自分が保持しているReact state(EditorTabBodyなら
    // OpenFile.content)を更新し、<Editor value=.../>との食い違いによる
    // 巻き戻りを防ぐ(liveEditorRegistry.tsのコメント参照)。
    onRemoteChange?: (content: string) => void,
): void {
    const sendRef = useRef(send);
    const onRemoteChangeRef = useRef(onRemoteChange);
    useEffect(() => {
        sendRef.current = send;
        onRemoteChangeRef.current = onRemoteChange;
    }, [send, onRemoteChange]);

    useEffect(() => {
        if (!monaco || !editor) return;
        const model = editor.getModel();
        if (!model) return;

        const applyingRemoteRef = { current: false };
        registerLiveEditorModel(path, {
            editor,
            monaco,
            applyingRemote: applyingRemoteRef,
            cursorDecorationIds: [],
            onRemoteChange: (content) => onRemoteChangeRef.current?.(content),
        });

        const contentDisposable = model.onDidChangeContent((event) => {
            if (applyingRemoteRef.current) return;
            sendRef.current({
                type: 'editor-change',
                path,
                changes: event.changes.map((change) => ({
                    range: {
                        startLineNumber: change.range.startLineNumber,
                        startColumn: change.range.startColumn,
                        endLineNumber: change.range.endLineNumber,
                        endColumn: change.range.endColumn,
                    },
                    text: change.text,
                })),
            });
        });

        let lastCursorSentAt = 0;
        const cursorDisposable = editor.onDidChangeCursorPosition((event) => {
            const now = Date.now();
            if (now - lastCursorSentAt < CURSOR_THROTTLE_MS) return;
            lastCursorSentAt = now;
            sendRef.current({
                type: 'editor-cursor',
                path,
                position: { lineNumber: event.position.lineNumber, column: event.position.column },
                name: myName,
            });
        });

        return () => {
            contentDisposable.dispose();
            cursorDisposable.dispose();
            unregisterLiveEditorModel(path);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [path, monaco, editor]);
}
