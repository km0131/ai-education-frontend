'use client';

import React, { useEffect, useRef, useState } from 'react';
import { API_URL, securedFetch } from '@/src/lib/api';
import { Icon } from './Icon';
import { DEFAULT_PREVIEW_SERVER_URL, relativeToWorkspace } from './runCommand';

// WorkspaceLayout(「Webプレビュー」ボタン)からの表示リクエスト。'file'と
// 'url'を1つの判別可能ユニオンにまとめている - 以前は{fileRequest, urlRequest}
// という2つの独立したprops(+2つの独立したuseEffect)に分けていたが、
// どちらも「片方だけ更新され、もう片方はnullに戻る」という保証が無く、
// 前回開いた時の古い方の値が次にマウントされた時もまだ残っていたため、
// マウント時に両方のeffectが発火して競合し、意図しない方が最終的に勝つ
// バグがあった(拡張子によって完全に排他的な1つの状態として扱うことで、
// この種の競合を構造的に起こり得なくする)。nonceは同じ対象への再実行でも
// 確実に再読み込みさせるためのもの(pathやurlの値だけだと変わらず、
// effectが再発火しないケースがあるため)。
export type PreviewRequest =
    | { kind: 'file'; path: string; nonce: number }
    | { kind: 'url'; url: string; nonce: number };

interface WebPreviewPaneProps {
    classId: string;
    onClose?: () => void;
    request?: PreviewRequest | null;
}

const DEFAULT_URL = DEFAULT_PREVIEW_SERVER_URL;

interface ParsedTarget {
    port: number;
    pathAndQuery: string;
}

// 今どちらの方法でプレビューしているかを覚えておく - Reload時にURL入力欄の
// 表示テキスト(file:///...という見た目上のプレースホルダ)を誤ってURLとして
// 再解釈しないようにするため。
type PreviewSource = { kind: 'url'; input: string } | { kind: 'file'; absolutePath: string };

// 生徒が普段Flaskの起動ログで見慣れている`http://localhost:5000`という
// 書き方をそのまま入力できるようにする(VS CodeのSimple Browserと同じ
// UX) - 実際の到達方法(認証付きリバースプロキシ、preview_handler.go)は
// この関数がポート/パスへ分解した後、内部で組み立てる。
function parseTargetUrl(input: string): ParsedTarget | null {
    let url: URL;
    try {
        url = new URL(input);
    } catch {
        return null;
    }
    const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
    if (!Number.isFinite(port) || port <= 0 || port > 65535) return null;
    return { port, pathAndQuery: `${url.pathname}${url.search}` };
}

// VS CodeのSimple Browser相当のIDE内蔵Webプレビュー。iframeで生徒自身の
// サンドボックス内で動いているWebアプリ(Flask開発サーバー等)、または
// サーバーを起動していない単体の.html/.htmファイルを表示する。
// 認証(Authorizationヘッダー)を付けられないiframeナビゲーションのため、
// バックエンドの専用チケット(IssuePreviewTicket、preview_ticket_service.go)
// 経由で認証する - シェル/LSPの使い切りチケットと違い、1ページの表示で
// 何本もリクエストが飛ぶため有効期限内は使い回せる。
//
// 既知の制約: パスプレフィックス方式(リバースプロキシ/静的ファイル配信の
// どちらも)のため、アプリが`url_for()`等で生成する絶対パス
// (例: `/static/style.css`)を含むページの一部リンク/アセットが正しく
// 解決されないことがある(相対パス中心のシンプルなページなら問題にならない)。
// 「新しいタブで開く」ボタンも同じプロキシ経由のため、この制約は変わらない。
export function WebPreviewPane({ classId, onClose, request }: WebPreviewPaneProps) {
    const [urlInput, setUrlInput] = useState(DEFAULT_URL);
    const [source, setSource] = useState<PreviewSource>({ kind: 'url', input: DEFAULT_URL });
    const [iframeSrc, setIframeSrc] = useState<string | null>(null);
    const [reloadNonce, setReloadNonce] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    // リロードのたびにチケットも取り直す(cheapなので毎回やる) - 長時間
    // プレビューを開いたままにして有効期限(PreviewTicketTTL)を過ぎても、
    // ユーザーが1回リロードすれば自然に復帰する。
    const fetchPreviewTicket = async (): Promise<string> => {
        const res = await securedFetch('/api/v2/program/container/preview-ticket', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ course_id: Number(classId) }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ticket) throw new Error(data.error || 'プレビューの準備に失敗しました');
        return data.ticket as string;
    };

    const loadUrl = async (input: string) => {
        const parsed = parseTargetUrl(input);
        if (!parsed) {
            setError('URLの形式が正しくありません(例: http://localhost:5000)');
            return;
        }
        setUrlInput(input);
        setError(null);
        setIsLoading(true);
        try {
            const ticket = await fetchPreviewTicket();
            const proxyPath = `/api/v2/program/container/preview/${ticket}/${parsed.port}${parsed.pathAndQuery}`;
            setIframeSrc(`${API_URL}${proxyPath}`);
            setReloadNonce((n) => n + 1);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'プレビューの準備に失敗しました');
        } finally {
            setIsLoading(false);
        }
    };

    // サーバープロセスを何も起動していない、単体の.html/.htmファイルを直接
    // 表示する(「実行」ボタンのHTML拡張)。preview-fileはワークスペース内の
    // ファイルをそのまま静的配信するエンドポイントで、ポート指定は不要。
    const loadFile = async (absolutePath: string) => {
        setError(null);
        setIsLoading(true);
        try {
            const ticket = await fetchPreviewTicket();
            const relativePath = relativeToWorkspace(absolutePath);
            const proxyPath = `/api/v2/program/container/preview-file/${ticket}/${relativePath}`;
            setIframeSrc(`${API_URL}${proxyPath}`);
            setUrlInput(`file:///${relativePath}`);
            setReloadNonce((n) => n + 1);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'プレビューの準備に失敗しました');
        } finally {
            setIsLoading(false);
        }
    };

    // 初回マウント時、requestが最初から来ていなければ既定URL
    // (http://localhost:5000)で開始する(「Webプレビュー」トグルボタンを
    // 素の状態で開いた場合)。requestが最初から来ている場合は、下のeffectに
    // 任せる - ここで二重に読み込みに行かないようにする。
    const didInitRef = useRef(false);
    useEffect(() => {
        if (didInitRef.current) return;
        didInitRef.current = true;
        if (!request) {
            loadUrl(DEFAULT_URL);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // requestが(初回マウント後も含めて)更新されるたびに、その種別(kind)
    // どおりに静的ファイル/URLのどちらかとしてプレビューする。file/urlが
    // 互いに排他な1つのユニオン型なので、同時に両方のロードが走ることは
    // 構造上あり得ない。同じ対象への再実行でもnonceが変わるので、依存配列
    // に含めたrequest自体の参照が毎回変わり必ず再発火する。
    useEffect(() => {
        if (!request) return;
        if (request.kind === 'file') {
            setSource({ kind: 'file', absolutePath: request.path });
            loadFile(request.path);
        } else {
            setSource({ kind: 'url', input: request.url });
            loadUrl(request.url);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [request]);

    const handleNavigateSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setSource({ kind: 'url', input: urlInput });
        loadUrl(urlInput);
    };

    const handleReload = () => {
        if (source.kind === 'file') {
            loadFile(source.absolutePath);
        } else {
            loadUrl(source.input);
        }
    };

    const handleOpenInNewTab = () => {
        if (iframeSrc) window.open(iframeSrc, '_blank', 'noopener,noreferrer');
    };

    return (
        <div className="flex flex-col h-full min-h-0 bg-[#1e1e1e]">
            {/* ツールバー: URL入力欄 + リロード + 新しいタブで開く + 閉じる */}
            <div className="flex items-center gap-2 px-2 py-1.5 bg-[#252526] border-b border-[#3c3c3c] shrink-0">
                <Icon name="globe" className="text-[#8a8a8a] shrink-0" />
                <form onSubmit={handleNavigateSubmit} className="flex-1 min-w-0">
                    <input
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        placeholder={DEFAULT_URL}
                        className="w-full rounded-md bg-[#3c3c3c] text-[#ffffff] text-xs px-2 py-1 placeholder:text-[#8a8a8a] border border-[#3c3c3c] focus:outline-none focus:border-[#007acc]"
                    />
                </form>
                <button
                    type="button"
                    onClick={handleReload}
                    title="再読み込み"
                    disabled={isLoading}
                    className="shrink-0 p-1 rounded text-[#cccccc] hover:bg-[#3c3c3c] disabled:opacity-40 transition-colors"
                >
                    <Icon name="refresh" />
                </button>
                <button
                    type="button"
                    onClick={handleOpenInNewTab}
                    title="新しいタブで開く"
                    disabled={!iframeSrc}
                    className="shrink-0 p-1 rounded text-[#cccccc] hover:bg-[#3c3c3c] disabled:opacity-40 transition-colors"
                >
                    <Icon name="link-external" />
                </button>
                {onClose && (
                    <button
                        type="button"
                        onClick={onClose}
                        title="Webプレビューを閉じる"
                        className="shrink-0 p-1 rounded text-[#cccccc] hover:bg-[#3c3c3c] transition-colors"
                    >
                        <Icon name="close" />
                    </button>
                )}
            </div>

            {error && (
                <div className="flex items-center gap-1.5 px-2 py-1 bg-[#f44747]/15 text-[#f44747] text-[11px] font-bold shrink-0">
                    <Icon name="warning" /> {error}
                </div>
            )}

            <div className="flex-1 min-h-0 relative bg-white">
                {isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-[#1e1e1e] text-[#8a8a8a] text-sm">
                        読み込み中...
                    </div>
                )}
                {iframeSrc && !isLoading && (
                    <iframe
                        key={reloadNonce}
                        src={iframeSrc}
                        className="w-full h-full border-0"
                        title="Webプレビュー"
                        // 生徒の(信頼できない)コードが動くページを埋め込むため、
                        // 親システム(ai-back.a-kiis.com等)のCookie/LocalStorageへ
                        // 干渉できないようサンドボックス化する。allow-same-originを
                        // 付けているのは、プレビュー自体がAPI(プレフィックス
                        // 付きの相対URL)への同一オリジン扱いのリクエストを内部で
                        // 行う都合上必要なため - このiframeのオリジンは常に
                        // 「このAPIサーバー自身」であり、生徒のクラス外の他の
                        // オリジン(親システムの実際のオリジン)とは別なので、
                        // allow-same-originを付けても親システムのCookie等には
                        // 到達できない。
                        sandbox="allow-scripts allow-forms allow-same-origin"
                    />
                )}
                {!iframeSrc && !isLoading && !error && (
                    <div className="h-full flex items-center justify-center text-sm text-[#8a8a8a]">
                        URLを入力してプレビューを開始してください
                    </div>
                )}
            </div>
        </div>
    );
}
