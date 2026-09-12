// LSP(Language Server Protocol)は`Content-Length: <n>\r\n\r\n<JSON本文>`という
// ヘッダー付きJSON-RPC 2.0がワイヤフォーマット。バックエンドのLspWebSocket
// (internal/handler/lsp_handler.go)はexecした言語サーバーの標準入出力バイト列を
// そのままバイナリフレームで中継するだけなので、このフレーミングの組み立て/
// 分解自体はクライアント側(ここ)の責務になる。
//
// monaco-languageclient(本家ライブラリ)は`@codingame/monaco-vscode-api`という
// VS Codeの内部APIをまるごと移植する巨大な代替パッケージ群への依存を要求し、
// 既存の`@monaco-editor/react`ベースの構成と相性が悪い(webpack/viteの
// module alias設定が必要、等)。そのためこのプロジェクトでは、プレーンな
// monaco-editorのネイティブAPI(registerCompletionItemProvider等、
// lspProviders.ts参照)向けに、必要最小限のLSPクライアントをここで自作する。

interface JsonRpcErrorBody {
    code: number;
    message: string;
    data?: unknown;
}

interface JsonRpcMessage {
    jsonrpc: '2.0';
    id?: number;
    method?: string;
    params?: unknown;
    result?: unknown;
    error?: JsonRpcErrorBody;
}

type NotificationHandler = (params: unknown) => void;

// WebSocketクローズコード(RFC 6455 7.4.2、4000-4999はプライベート利用域)。
// バックエンド(lsp_handler.goのlspCloseCodeIdleTimeout)と値を一致させる
// 必要がある - 「編集中のみ起動+アイドル自動停止」による意図した切断だけを
// この値で識別し、それ以外(言語サーバーのクラッシュ、ブラウザ側の切断等)は
// すべて「予期しない切断」としてひとまとめに扱う(LSPプロセスクラッシュ時の
// リトライ・ユーザー通知フロー、useLspDocument.ts参照)。
export const LSP_CLOSE_CODE_IDLE_TIMEOUT = 4000;

export interface LspCloseInfo {
    code: number;
    reason: string;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
}

// バッファ中の最初の"\r\n\r\n"(ヘッダー終端)の直後の位置を返す。見つからなければ-1。
function findHeaderEnd(buf: Uint8Array): number {
    for (let i = 0; i + 3 < buf.length; i++) {
        if (buf[i] === 13 && buf[i + 1] === 10 && buf[i + 2] === 13 && buf[i + 3] === 10) {
            return i + 4;
        }
    }
    return -1;
}

// 1つのWebSocket接続(=コンテナ内でexecされた1つの言語サーバープロセス)に
// 対応するJSON-RPCクライアント。1接続を複数ファイルで共有することを想定し
// (lspManager.ts参照)、リクエストのid採番・通知の配送を一括して扱う。
export class LspConnection {
    private ws: WebSocket;
    private nextId = 1;
    private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    private notificationHandlers = new Map<string, Set<NotificationHandler>>();
    private closeHandlers = new Set<(info: LspCloseInfo) => void>();
    private recvBuffer: Uint8Array = new Uint8Array(0);
    private closed = false;
    // WebSocketの実際のCloseEventから得たコード/理由。onerror発火時点では
    // まだ確定していない(WebSocket仕様上、onerrorの直後に必ずoncloseが
    // 続けて発火するため、oncloseが唯一の正式な情報源 - onerrorはoncloseに
    // 先んじてhandleClose()を呼んでしまわないよう、ログ以外の副作用を
    // 持たせない)。
    private closeInfo: LspCloseInfo = { code: 1005, reason: '' };

    constructor(ws: WebSocket) {
        this.ws = ws;
        this.ws.binaryType = 'arraybuffer';
        this.ws.onmessage = (event) => {
            if (typeof event.data === 'string') return;
            this.feed(new Uint8Array(event.data as ArrayBuffer));
        };
        this.ws.onclose = (event) => this.handleClose({ code: event.code, reason: event.reason });
        this.ws.onerror = () => {
            // WebSocket仕様上この直後に必ずoncloseが発火するため、ここでは
            // 何もしない(先にhandleCloseを走らせてしまうと、oncloseが運ぶ
            // 本当のクローズコード/理由を取りこぼす)。
        };
    }

    private handleClose(info: LspCloseInfo) {
        if (this.closed) return;
        this.closed = true;
        this.closeInfo = info;
        for (const { reject } of this.pending.values()) {
            reject(new Error('LSP接続が切断されました'));
        }
        this.pending.clear();
        for (const handler of this.closeHandlers) handler(info);
        this.closeHandlers.clear();
    }

    // サーバー側の切断(アイドルタイムアウト、言語サーバーのクラッシュ、
    // ブラウザ側の切断等)で一度だけ呼ばれる。infoにはWebSocketの実際の
    // クローズコード/理由が入り、呼び出し側(useLspDocument.ts)はこれで
    // 「意図した切断(アイドルタイムアウト、LSP_CLOSE_CODE_IDLE_TIMEOUT)」
    // と「予期しない切断(それ以外すべて - クラッシュ、ネットワーク切断等)」
    // を区別する - 前者は次に実際の編集操作があるまで黙って待つ(遅延再接続、
    // タブを開いたまま放置しているだけで新しいプロセスが立ち上がって
    // しまうと、アイドルタイムアウト自体が意味を成さなくなるため)。後者は
    // バックオフ付きの自動リトライ+ユーザー通知の対象にする(LSPプロセス
    // クラッシュ時のリトライ・ユーザー通知フロー)。ここ自体では自動的に
    // 再接続しない - 判断も再接続の実行も呼び出し側の責務。
    onClose(handler: (info: LspCloseInfo) => void): () => void {
        if (this.closed) {
            handler(this.closeInfo);
            return () => {};
        }
        this.closeHandlers.add(handler);
        return () => this.closeHandlers.delete(handler);
    }

    isClosed(): boolean {
        return this.closed;
    }

    private feed(chunk: Uint8Array) {
        this.recvBuffer = concatBytes(this.recvBuffer, chunk);

        for (;;) {
            const headerEnd = findHeaderEnd(this.recvBuffer);
            if (headerEnd === -1) return;

            const headerText = new TextDecoder('ascii').decode(this.recvBuffer.subarray(0, headerEnd));
            const match = /Content-Length:\s*(\d+)/i.exec(headerText);
            if (!match) {
                // フレーミングが壊れている - 復旧不能なので切断する。
                this.ws.close();
                return;
            }
            const contentLength = parseInt(match[1], 10);
            const bodyEnd = headerEnd + contentLength;
            if (this.recvBuffer.length < bodyEnd) return; // 本文がまだ全部届いていない

            const bodyBytes = this.recvBuffer.subarray(headerEnd, bodyEnd);
            this.recvBuffer = this.recvBuffer.subarray(bodyEnd);

            try {
                this.dispatch(JSON.parse(new TextDecoder('utf-8').decode(bodyBytes)) as JsonRpcMessage);
            } catch {
                // 1メッセージ分の破損(JSONとして壊れている)は無視して次へ進む。
            }
        }
    }

    private dispatch(message: JsonRpcMessage) {
        // レスポンス(idはあるがmethodが無い) - 対応するPromiseを解決する。
        if (typeof message.id === 'number' && !message.method) {
            const pending = this.pending.get(message.id);
            if (!pending) return;
            this.pending.delete(message.id);
            if (message.error) {
                pending.reject(new Error(message.error.message));
            } else {
                pending.resolve(message.result);
            }
            return;
        }

        // サーバー→クライアントのリクエスト(idとmethodの両方がある)。
        // このクライアントは補完/ホバー/診断の受信専用に割り切っているため、
        // サーバー起動時によく飛んでくる`workspace/configuration`だけ最低限
        // 応答する(無視すると一部の言語サーバーがタイムアウト待ちで固まる
        // ことがある) - それ以外はnullを返す汎用フォールバック。
        if (typeof message.id === 'number' && message.method) {
            let result: unknown = null;
            if (message.method === 'workspace/configuration') {
                const items = (message.params as { items?: unknown[] } | undefined)?.items ?? [];
                result = items.map(() => null);
            }
            this.send({ jsonrpc: '2.0', id: message.id, result });
            return;
        }

        // 通知(idが無い)。
        if (message.method) {
            const handlers = this.notificationHandlers.get(message.method);
            if (handlers) {
                for (const handler of handlers) handler(message.params);
            }
        }
    }

    private send(message: JsonRpcMessage) {
        if (this.ws.readyState !== WebSocket.OPEN) return;
        const body = new TextEncoder().encode(JSON.stringify(message));
        const header = new TextEncoder().encode(`Content-Length: ${body.length}\r\n\r\n`);
        const frame = new Uint8Array(header.length + body.length);
        frame.set(header, 0);
        frame.set(body, header.length);
        this.ws.send(frame);
    }

    // 応答が永遠に来ないケース(言語サーバー側の不具合等)で、呼び出し元が
    // 無音のまま固まってしまわないよう、一定時間で必ずreject()するように
    // しておく防御的なタイムアウト。
    private static readonly requestTimeoutMs = 10000;

    request<T = unknown>(method: string, params?: unknown): Promise<T> {
        if (this.closed) return Promise.reject(new Error('LSP接続が切断されています'));
        const id = this.nextId++;
        return new Promise<T>((resolve, reject) => {
            const timer = window.setTimeout(() => {
                if (this.pending.delete(id)) {
                    reject(new Error(`LSPリクエストがタイムアウトしました: ${method}`));
                }
            }, LspConnection.requestTimeoutMs);
            this.pending.set(id, {
                resolve: (v) => {
                    window.clearTimeout(timer);
                    (resolve as (v: unknown) => void)(v);
                },
                reject: (e) => {
                    window.clearTimeout(timer);
                    reject(e);
                },
            });
            this.send({ jsonrpc: '2.0', id, method, params });
        });
    }

    notify(method: string, params?: unknown): void {
        if (this.closed) return;
        this.send({ jsonrpc: '2.0', method, params });
    }

    // 戻り値は登録解除用の関数(React effectのcleanupから直接呼べる形)。
    onNotification(method: string, handler: NotificationHandler): () => void {
        let set = this.notificationHandlers.get(method);
        if (!set) {
            set = new Set();
            this.notificationHandlers.set(method, set);
        }
        set.add(handler);
        return () => set!.delete(handler);
    }

    dispose(): void {
        this.handleClose({ code: 1000, reason: 'client-dispose' });
        this.ws.close();
    }
}

export function connectLsp(wsUrl: string): Promise<LspConnection> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        ws.binaryType = 'arraybuffer';
        const handleOpen = () => {
            ws.removeEventListener('error', handleError);
            resolve(new LspConnection(ws));
        };
        const handleError = () => {
            ws.removeEventListener('open', handleOpen);
            reject(new Error('言語サーバーへの接続に失敗しました'));
        };
        ws.addEventListener('open', handleOpen, { once: true });
        ws.addEventListener('error', handleError, { once: true });
    });
}
