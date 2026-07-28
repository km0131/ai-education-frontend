// クラス単位で「AIの新規作成/学習開始/性能テスト」を教師が一時停止できる機能のAPIラッパー。
// フロント側のチェックはUX目的(モーダルを開く前に早期に伝える)であり、直接API呼び出しで
// 回避されないようバックエンド側(各サービス関数の先頭)でも必ず同じチェックを行っている。
// そのため、この確認自体が通信エラーで失敗した場合はフェイルオープン(false扱い)にして、
// 実際のブロック判定はバックエンドの最終防衛ラインに委ねる。

import { API_URL } from '@/src/lib/api';

function authHeaders(token: string | undefined): HeadersInit {
    return {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
}

// 指定クラスでAI作成/学習/テストがブロックされているかを確認する(全ロールが呼べる)。
export async function checkAiCreationBlocked(courseId: string, token: string | undefined): Promise<boolean> {
    try {
        const res = await fetch(`${API_URL}/api/v1/ai/block_status`, {
            method: 'POST',
            headers: authHeaders(token),
            body: JSON.stringify({ course_id: Number(courseId) }),
        });
        if (!res.ok) return false;
        const data = await res.json().catch(() => ({}));
        return Boolean(data.ai_creation_blocked);
    } catch (err) {
        console.warn('[aiCreationBlock] 状態確認に失敗しました(フェイルオープン):', err);
        return false;
    }
}

// ブロック状態を切り替える(教師のみ・自分のクラスのみ)。
export async function setAiCreationBlocked(courseId: string, blocked: boolean, token: string | undefined): Promise<boolean> {
    const res = await fetch(`${API_URL}/api/v1/ai/block_toggle`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ course_id: Number(courseId), blocked }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || '設定の変更に失敗しました');
    }
    return Boolean(data.ai_creation_blocked);
}
