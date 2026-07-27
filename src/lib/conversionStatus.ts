// フロント(createImageBitmapのネイティブデコード/heic2anyのどちらも)で変換できなかったHEIC/RAW画像は、
// バックエンドがheif-convert/exiftoolでバックグラウンド変換する(conversion_status="processing")。
// この完了(ready)/失敗(failed)を、アップロードのメインフローをブロックせずにバックグラウンドで
// ポーリング確認するためのユーティリティ。

// バックエンドのAiPhotograph/TestImageモデルはjsonタグを持たないため、Goのフィールド名(大文字始まり)の
// ままシリアライズされる。upload_image/image_updated/uploading_test_imageのレスポンスから
// 必要な部分だけを見る。
export interface UploadedPhotoInfo {
    ID?: number;
    ConversionStatus?: string;
}

interface ConversionStatusEntry {
    photo_id: number;
    status: 'ready' | 'processing' | 'failed';
    error?: string;
}

interface PollTarget {
    photoId: number;
    fileName: string;
}

const POLL_INTERVAL_MS = 5_000;
// 5秒 x 24回 = 最大2分。バックエンド側のフォールバック変換1回あたりの上限は45秒 + 混雑時の
// 待ち時間なので、それより十分長めに確認し続ける。
const MAX_POLL_ATTEMPTS = 24;

// conversion_status="processing"で返ってきた画像だけをバックグラウンドでポーリングする。
// アップロードのメインフロー(送信ループ)はこの完了を待たない。failed/タイムアウトになった
// ものだけをonFailureで通知する(readyになったものは何もしない = 何も表示しない)。
export function watchConversionStatus(
    statusUrl: string,
    token: string | undefined,
    targets: PollTarget[],
    onFailure: (fileName: string, reason: string) => void
): void {
    if (targets.length === 0) return;

    const pending = new Map(targets.map((t) => [t.photoId, t.fileName]));
    let attempts = 0;

    const tick = async () => {
        if (pending.size === 0) return;
        attempts += 1;

        try {
            const res = await fetch(statusUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({ photo_ids: Array.from(pending.keys()) }),
            });
            if (res.ok) {
                const data: { statuses?: ConversionStatusEntry[] } = await res.json();
                for (const entry of data.statuses ?? []) {
                    if (entry.status === 'ready') {
                        pending.delete(entry.photo_id);
                    } else if (entry.status === 'failed') {
                        const name = pending.get(entry.photo_id) ?? `photo #${entry.photo_id}`;
                        onFailure(name, entry.error || 'サーバー側での変換に失敗しました');
                        pending.delete(entry.photo_id);
                    }
                    // processingのものはそのままpendingに残し、次回ポーリングで再確認する
                }
            }
        } catch {
            // 瞬断等はここでは無視し、次のポーリングで再試行する
        }

        if (pending.size === 0) return;

        if (attempts < MAX_POLL_ATTEMPTS) {
            setTimeout(tick, POLL_INTERVAL_MS);
            return;
        }

        // タイムアウト: バックエンド側では処理が続いている可能性があるため「失敗」とは言い切らず、
        // 保留中である旨だけ伝える
        for (const name of pending.values()) {
            onFailure(name, 'サーバー側での変換が完了していません。時間をおいて登録状況をご確認ください');
        }
    };

    setTimeout(tick, POLL_INTERVAL_MS);
}
