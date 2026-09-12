import Cookies from 'js-cookie';

const apiUrl = process.env.NEXT_PUBLIC_API_URL;

if (!apiUrl) {
	throw new Error('NEXT_PUBLIC_API_URL is not set');
}

export const API_URL = apiUrl;

// 講師サポート画面(TeacherWorkspaceView等)が特定の生徒のファイル/Git/公開
// 状態を操作している間だけセットされる、モジュールレベルの「代理操作対象」
// ID。setActingAsUserでセット/解除し、securedFetchがこれを見て該当リクエスト
// に ?as_user=<id> を自動付与する(バックエンドのresolveTeacherActingAs、
// internal/handler/file.go参照)。FileExplorerPane/Sidebar(Git)/
// HistoryPanel/PublishPanel/lspManager等、既存コンポーネントを一切変更せず
// 講師モードへ対応させるための仕組み - 生徒本人としての通常利用時は常に
// nullなので、挙動は変わらない。
let actingAsUserId: string | null = null;

export const setActingAsUser = (userId: string | null) => {
	actingAsUserId = userId;
};

export const getActingAsUser = () => actingAsUserId;

export const securedFetch = async (path: string, options: RequestInit = {}) => {
	const token = Cookies.get('auth_token');

	// パスの先頭にスラッシュがない場合のケア（例: /api/v1/user に統一）
	const normalizedPath = path.startsWith('/') ? path : `/${path}`;
	let url = `${API_URL}${normalizedPath}`;

	if (actingAsUserId) {
		url += (url.includes('?') ? '&' : '?') + `as_user=${encodeURIComponent(actingAsUserId)}`;
	}

	// 共通ヘッダーの構築
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		...(token ? { 'Authorization': `Bearer ${token}` } : {}),
		...(options.headers as Record<string, string>), // 個別に指定されたヘッダーがあれば上書き
	};

	return fetch(url, {
		...options,
		headers,
	});
};