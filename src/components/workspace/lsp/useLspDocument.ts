import { useEffect, useRef } from 'react';
import type { OnMount } from '@monaco-editor/react';
import { OpenFile } from '../types';
import { acquireLspConnection, registerLiveDocument, releaseLspConnection, unregisterLiveDocument } from './lspManager';
import { diagnosticsToMarkers, ensureLanguageProvidersRegistered } from './lspProviders';
import { ensurePythonCodeActionProviderRegistered } from './lspCodeActions';
import { LSP_CLOSE_CODE_IDLE_TIMEOUT, LspConnection } from './lspProtocol';
import { pushToast } from '../Toast';

type Monaco = Parameters<OnMount>[1];
type MonacoEditor = Parameters<OnMount>[0];

// LSPプロセスクラッシュ時のリトライ・ユーザー通知フロー(NextPlan.md
// フェーズ6): アイドルタイムアウト(意図した切断)以外の理由で接続が切れた
// 場合、次の編集操作を待たずにこの間隔で自動的につなぎ直す。1回失敗する
// たびに少し間隔を空ける(単純な固定リトライだと、言語サーバーが起動直後に
// 毎回すぐクラッシュするような壊れた設定の時、際限なく再起動を試み続けて
// コンテナに負荷をかけ続けてしまうため)。
const LSP_RETRY_DELAYS_MS = [1000, 3000, 8000];

function extensionOf(filePath: string): string {
    const name = filePath.split('/').pop() ?? '';
    const dotIndex = name.lastIndexOf('.');
    return dotIndex === -1 ? '' : name.slice(dotIndex + 1).toLowerCase();
}

// ファイルパスをそのままLSP側のdocument URIとして使う - サンドボックス
// コンテナ内の実パスなので、file://を付けるだけで言語サーバー(コンテナ内
// プロセス)から見た実在のファイルを正しく指せる(SANDBOX_WORKSPACE_PATH
// 配下である前提、program_service.goのResolveSandboxPathと同じ)。
function lspUriFor(filePath: string): string {
    return `file://${filePath}`;
}

// 1ファイル分のLSP同梱: didOpen/didChange/didClose通知、診断
// (publishDiagnostics→Monacoの波線マーカー)、補完/ホバー用グローバル
// プロバイダの初回登録をまとめて面倒を見るフック。EditorPane内の各タブ
// (EditorTabBody)から、そのタブのMonacoエディタがmountされた後に呼ぶ。
//
// 対応する拡張子が.ai/lsp-config.jsonに設定されていない場合は何もしない
// (acquireLspConnectionがnullを返す) - LSPは無くても普通に編集できる
// 機能拡張であり、エラー表示はしない。
//
// 「編集中のみ起動」(NextPlan.md フェーズ6): 最初にファイルを開いた時点で
// 接続する(開く=編集を始める合図)。バックエンドがアイドルタイムアウト
// (LSP_IDLE_TIMEOUT_MINUTES、lsp_service.go)で接続を切った場合、ここでは
// 自動で繋ぎ直さない - タブを開いたまま放置しているだけで新しいプロセスが
// 再び立ち上がってしまうと、アイドルタイムアウト自体が意味を成さなくなる
// ため。再接続は「実際にもう一度編集した(onDidChangeContentが発火した)」
// 時点で初めて行う(遅延再接続)。
//
// 一方、言語サーバーのクラッシュ等アイドルタイムアウト以外の理由で切断
// された場合(バックエンドが送るWebSocketクローズコードで区別する、
// LSP_CLOSE_CODE_IDLE_TIMEOUT/lsp_handler.go参照)は、編集を待たずに
// LSP_RETRY_DELAYS_MSの間隔で自動的につなぎ直しを試みる - クラッシュは
// ユーザーの操作と無関係に起きるため、次に何か入力するまで補完が死んだ
// ままなのは不親切。既定の試行回数を使い切ってもなお繋がらない場合のみ
// トースト通知(Toast.tsx)で知らせ、それ以上の自動リトライは止める
// (LSPプロセスクラッシュ時のリトライ・ユーザー通知フロー)。
export function useLspDocument(
    classId: string,
    file: Pick<OpenFile, 'path' | 'language'>,
    monaco: Monaco | null,
    editor: MonacoEditor | null,
    // asUserId: 講師サポート画面から生徒のLSPへ接続する場合の対象生徒ID
    // (lspManager.tsのacquireLspConnection/releaseLspConnection参照)。
    asUserId?: string,
    // enabled=false: クラスメイト間の相互閲覧(Peer Viewer、読み取り専用)
    // モードでは補完/診断自体が無意味(編集できないため)なので、LSP接続を
    // 一切張らない - 既定はtrueで、既存の呼び出し元の挙動は変えない。
    enabled = true,
): void {
    const versionRef = useRef(1);

    useEffect(() => {
        if (!monaco || !editor || !enabled) return;
        const model = editor.getModel();
        if (!model) return;
        const extension = extensionOf(file.path);
        if (!extension) return;

        const lspUri = lspUriFor(file.path);
        const modelUriKey = model.uri.toString();
        let disposed = false;
        // hasConnection: 今このタブがacquireLspConnectionの参照を1つ保持して
        // いるか(acquire/releaseを常に1:1に保つためのフラグ)。currentConn:
        // 実際に使える(オープン中の)接続 - まだ接続処理中はnullのまま。
        let hasConnection = false;
        let currentConn: LspConnection | null = null;
        let diagnosticsUnsubscribe: (() => void) | null = null;
        let closeUnsubscribe: (() => void) | null = null;
        // retryCount/retryTimer: LSPプロセスクラッシュ時のリトライ・
        // ユーザー通知フロー用の状態。接続に成功するたびに0へ戻す
        // (「直近の切断が連続クラッシュかどうか」だけを見るため、過去の
        // 成功済みセッションの分まで引きずらない)。
        let retryCount = 0;
        let retryTimer: number | null = null;

        ensureLanguageProvidersRegistered(monaco, file.language);
        // クイックフィックス(💡)はPython/Flask向けの決め打ちロジックのみ
        // 実装しているため、'python'ファイルの時だけ登録する(要求仕様通り
        // 言語非依存にはしない - 追加要求「Monaco Native APIによる
        // CodeAction」参照)。
        if (file.language === 'python') {
            ensurePythonCodeActionProviderRegistered(monaco);
        }

        // 接続が(アイドルタイムアウト等で)失われた時の後始末。acquireで確保した
        // 分は必ずここでreleaseし、次のconnect()呼び出しで改めて1つ確保する -
        // 「保持している接続は常にacquire/releaseが1:1」を保つ。
        const teardownConnection = () => {
            diagnosticsUnsubscribe?.();
            diagnosticsUnsubscribe = null;
            closeUnsubscribe?.();
            closeUnsubscribe = null;
            currentConn = null;
            unregisterLiveDocument(modelUriKey);
            monaco.editor.setModelMarkers(model, 'lsp', []);
            if (hasConnection) {
                hasConnection = false;
                releaseLspConnection(classId, extension, asUserId);
            }
        };

        // クラッシュ(アイドルタイムアウト以外の理由での切断)後、次の編集を
        // 待たずにバックオフを挟みながら自動的につなぎ直す。LSP_RETRY_DELAYS_MS
        // を使い切ってもなお繋がらない場合は、コンテナへの負荷を考えて
        // それ以上自動では試みず、トースト通知で知らせるだけにする(その後は
        // 既存の「編集したらconnect()」という遅延再接続に任せる - ユーザーが
        // 実際に編集を続けている限り、そこで改めてリトライが走る)。
        const scheduleRetry = () => {
            if (retryTimer !== null || disposed) return;
            if (retryCount >= LSP_RETRY_DELAYS_MS.length) {
                pushToast(
                    `${file.language}のコード補完が利用できません(接続に繰り返し失敗しました)。編集は通常通り行えます。`,
                    { dedupeKey: `lsp-unavailable:${classId}:${extension}` },
                );
                return;
            }
            const delay = LSP_RETRY_DELAYS_MS[retryCount];
            retryCount += 1;
            retryTimer = window.setTimeout(() => {
                retryTimer = null;
                connect();
            }, delay);
        };

        const connect = () => {
            if (hasConnection || disposed) return;
            hasConnection = true; // acquire成功前でも先に立てておく - connect()の二重呼び出しを防ぐ
            versionRef.current = 1;

            acquireLspConnection(classId, extension, asUserId).then((conn) => {
                if (disposed) {
                    if (conn) releaseLspConnection(classId, extension, asUserId);
                    return;
                }
                if (!conn) {
                    // 未設定の拡張子、またはサーバー混雑(LSP_MAX_CONCURRENT)等で
                    // 接続できなかった - このタブ分の確保は無かったことにする。
                    hasConnection = false;
                    return;
                }

                retryCount = 0; // 接続に成功したので、クラッシュ連続カウントをリセットする
                currentConn = conn;
                registerLiveDocument(modelUriKey, { connection: conn, lspUri });
                conn.notify('textDocument/didOpen', {
                    textDocument: {
                        uri: lspUri,
                        languageId: file.language,
                        version: versionRef.current,
                        text: model.getValue(),
                    },
                });

                diagnosticsUnsubscribe = conn.onNotification('textDocument/publishDiagnostics', (params) => {
                    const payload = params as { uri: string; diagnostics: Parameters<typeof diagnosticsToMarkers>[1] };
                    if (payload.uri !== lspUri) return;
                    monaco.editor.setModelMarkers(model, 'lsp', diagnosticsToMarkers(monaco, payload.diagnostics));
                });

                closeUnsubscribe = conn.onClose((info) => {
                    teardownConnection();
                    if (info.code === LSP_CLOSE_CODE_IDLE_TIMEOUT) {
                        // 意図した切断(「編集中のみ起動」)。ここでは再接続しない -
                        // 次に実際の編集操作があった時だけconnect()が再び呼ばれる。
                        return;
                    }
                    // 予期しない切断(言語サーバーのクラッシュ等) - LSPプロセス
                    // クラッシュ時のリトライ・ユーザー通知フロー。
                    scheduleRetry();
                });
            });
        };

        connect();

        const changeDisposable = model.onDidChangeContent(() => {
            if (!currentConn) {
                // 接続が無い(まだ接続処理中/アイドルタイムアウト後) - 実際に
                // 編集された今、必要ならconnect()を(再)実行する。接続処理中
                // (hasConnection=true, currentConn=null)ならconnect()は何もしない
                // - didOpen送信時点のmodel.getValue()が既に最新の内容を含む
                // ため、確立の合間に打たれた変更を取りこぼすことはない。
                connect();
                return;
            }
            versionRef.current += 1;
            currentConn.notify('textDocument/didChange', {
                textDocument: { uri: lspUri, version: versionRef.current },
                contentChanges: [{ text: model.getValue() }],
            });
        });

        return () => {
            disposed = true;
            changeDisposable.dispose();
            teardownConnection();
            if (retryTimer !== null) {
                window.clearTimeout(retryTimer);
                retryTimer = null;
            }
        };
        // file.languageが変わることは実質無い(拡張子で決まるため)が、依存に
        // 含めて明示しておく。
    }, [classId, file.path, file.language, monaco, editor, asUserId, enabled]);
}
