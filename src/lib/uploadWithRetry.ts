// 画像アップロード共通のタイムアウト・リトライ処理。
// 画像送信は回線状況によって時間がかかるため、1回あたりの猶予時間を長め(10分)に確保しつつ、
// タイムアウトや一時的な通信エラーではリトライしてから失敗と判定する。

// 1回のアップロードあたりの猶予時間(タイムアウト)
export const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000; // 10分
// タイムアウト/一時的な通信エラー時のリトライ回数(初回 + 2回リトライ = 最大3回試行してから失敗とする)
export const UPLOAD_MAX_RETRIES = 2;
export const UPLOAD_RETRY_DELAY_MS = 2_000;

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// タイムアウト付きでアップロードし、失敗時は間隔を空けてリトライする。
export async function uploadImageWithRetry(url: string, formData: FormData, token: string | undefined): Promise<void> {
    let lastError: Error = new Error('通信に失敗しました');

    for (let attempt = 0; attempt <= UPLOAD_MAX_RETRIES; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: formData,
                signal: controller.signal,
            });
            clearTimeout(timeoutId);

            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.error || `画像の送信に失敗しました(${res.status})`);
            }
            return;
        } catch (err) {
            clearTimeout(timeoutId);
            lastError =
                err instanceof DOMException && err.name === 'AbortError'
                    ? new Error('通信がタイムアウトしました')
                    : err instanceof Error
                        ? err
                        : new Error('通信に失敗しました');

            const isLastAttempt = attempt === UPLOAD_MAX_RETRIES;
            if (!isLastAttempt) {
                await sleep(UPLOAD_RETRY_DELAY_MS);
            }
        }
    }

    throw lastError;
}
