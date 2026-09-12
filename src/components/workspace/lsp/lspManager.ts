import { API_URL, securedFetch } from '@/src/lib/api';
import { SANDBOX_WORKSPACE_PATH } from '../types';
import { connectLsp, LspConnection } from './lspProtocol';

interface ManagedConnection {
    refCount: number;
    connectionPromise: Promise<LspConnection | null>;
}

// (classId, 拡張子)ごとに1本のWebSocket接続(=1つの起動済み言語サーバー
// プロセス)を共有する - ファイルを開くたびに新しいプロセスを立てると、
// プロジェクト全体を見た補完・診断ができなくなる上に無駄にプロセスが増える。
const connections = new Map<string, ManagedConnection>();

// asUserId: 講師サポート画面が生徒本人の代わりにLSPへ接続する場合の対象
// 生徒ID(IssueTeacherShellTicket、internal/handler/teacher_dashboard_handler.go
// 参照) - 通常の生徒本人利用時はundefinedのまま。teacher/studentで接続を
// 混同しないよう、キーにも含める。
function keyFor(classId: string, extension: string, asUserId?: string): string {
    return asUserId ? `${classId}:${extension}:as:${asUserId}` : `${classId}:${extension}`;
}

// 「今開いているMonacoモデル→どの接続・どのLSP側URIで扱われているか」の
// 対応表。lspProviders.tsの補完/ホバープロバイダは、Monacoから渡される
// modelそのものの既定URI(model.uri.toString())からこれを引いて、正しい
// 接続へリクエストを転送する(1つの言語IDに複数の拡張子/接続が対応し得る
// ため、言語ID単位ではなくモデル単位で引く)。
export interface LiveDocument {
    connection: LspConnection;
    lspUri: string;
}

const liveDocuments = new Map<string, LiveDocument>();

export function registerLiveDocument(modelUri: string, doc: LiveDocument): void {
    liveDocuments.set(modelUri, doc);
}

export function unregisterLiveDocument(modelUri: string): void {
    liveDocuments.delete(modelUri);
}

export function getLiveDocument(modelUri: string): LiveDocument | undefined {
    return liveDocuments.get(modelUri);
}

// extension(ファイル名の拡張子、ドット無し・小文字)用の接続を取得する。
// 同じ(classId, extension)の組み合わせでは1本の接続を共有する
// (参照カウント方式 - 最後の利用者がreleaseした時に実際に接続を閉じる)。
// .ai/lsp-config.jsonにその拡張子の設定が無い場合はバックエンドが404を
// 返しWebSocketのアップグレード自体が失敗する - その場合はnullを返す
// (エラー表示はしない。LSPは無くても普通に編集できる機能拡張のため)。
export async function acquireLspConnection(
    classId: string,
    extension: string,
    asUserId?: string,
): Promise<LspConnection | null> {
    const key = keyFor(classId, extension, asUserId);
    let managed = connections.get(key);
    if (!managed) {
        const connectionPromise = startConnection(classId, extension, asUserId);
        managed = { refCount: 0, connectionPromise };
        connections.set(key, managed);

        // 接続が(アイドルタイムアウト・クラッシュ・ブラウザ側切断のいずれで
        // あれ)閉じたら、このマップエントリを必ず取り除く - こうしないと、
        // 既に死んだ接続がrefCountが0に戻るまでマップに居座り続け
        // (releaseLspConnectionでしか削除されないため)、その間に来た
        // acquireLspConnection呼び出しが皆この死んだ接続を掴んでしまう
        // (補完が無言で効かなくなる、というLSPクラッシュ対応以前からの
        // 潜在バグ)。takeover(下記)で既に別の新しい接続に差し替わっている
        // 場合は何もしない(世代のズレを防ぐ、ABA問題と同じ考え方)。
        connectionPromise.then((conn) => {
            if (!conn) return;
            conn.onClose(() => {
                if (connections.get(key)?.connectionPromise === connectionPromise) {
                    connections.delete(key);
                }
            });
        });
    }
    managed.refCount++;
    return managed.connectionPromise;
}

// acquireLspConnectionと対で呼ぶ。参照カウントが0になったら接続(=言語サーバー
// プロセス)を実際に閉じる - タブを閉じた/エディタを閉じた時にプロセスを
// 残さないため。
export function releaseLspConnection(classId: string, extension: string, asUserId?: string): void {
    const key = keyFor(classId, extension, asUserId);
    const managed = connections.get(key);
    if (!managed) return;
    managed.refCount--;
    if (managed.refCount <= 0) {
        connections.delete(key);
        managed.connectionPromise.then((conn) => conn?.dispose()).catch(() => {});
    }
}

async function startConnection(classId: string, extension: string, asUserId?: string): Promise<LspConnection | null> {
    try {
        // asUserIdが指定されている(講師サポート画面から生徒のLSPへ接続する)
        // 場合は、講師専用のチケット発行エンドポイントを使う - 通常の
        // /container/ticketは呼び出し者自身のサンドボックスにしか発行できない
        // (authorizeSandboxRequest、program_handler.go)ため。
        const ticketPath = asUserId ? '/api/v2/program/teacher/shell-ticket' : '/api/v2/program/container/ticket';
        const ticketBody = asUserId
            ? { course_id: Number(classId), user_id: asUserId }
            : { course_id: Number(classId) };
        const ticketRes = await securedFetch(ticketPath, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ticketBody),
        });
        const ticketData = await ticketRes.json().catch(() => ({}));
        if (!ticketRes.ok || !ticketData.ticket) return null;

        // pathはバックエンドが拡張子から起動コマンドを引くためだけに使う
        // (LspCommandForFile、lsp_service.go)ので、その拡張子を持つ適当な
        // ファイル名であればよい - 実在するファイルである必要はない。
        const wsBase = API_URL.replace(/^http/, 'ws');
        const params = new URLSearchParams({
            ticket: ticketData.ticket,
            path: `${SANDBOX_WORKSPACE_PATH}/_.${extension}`,
        });
        const conn = await connectLsp(`${wsBase}/api/v2/program/container/lsp?${params.toString()}`);

        const rootUri = `file://${SANDBOX_WORKSPACE_PATH}`;
        await conn.request('initialize', {
            processId: null,
            rootUri,
            workspaceFolders: [{ uri: rootUri, name: 'workspace' }],
            capabilities: {
                workspace: { configuration: true, workspaceFolders: false },
                textDocument: {
                    synchronization: { dynamicRegistration: false },
                    completion: { dynamicRegistration: false, completionItem: { snippetSupport: false } },
                    hover: { dynamicRegistration: false, contentFormat: ['markdown', 'plaintext'] },
                    publishDiagnostics: { relatedInformation: false },
                },
            },
        });
        conn.notify('initialized', {});
        return conn;
    } catch {
        return null;
    }
}
