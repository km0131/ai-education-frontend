import Cookies from 'js-cookie';

const apiUrl = process.env.NEXT_PUBLIC_API_URL;

if (!apiUrl) {
	throw new Error('NEXT_PUBLIC_API_URL is not set');
}

export const API_URL = apiUrl;

export const securedFetch = async (path: string, options: RequestInit = {}) => {
	const token = Cookies.get('auth_token');

	// パスの先頭にスラッシュがない場合のケア（例: /api/v1/user に統一）
	const normalizedPath = path.startsWith('/') ? path : `/${path}`;
	const url = `${API_URL}${normalizedPath}`;

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