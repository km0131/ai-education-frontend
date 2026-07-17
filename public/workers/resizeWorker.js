// 画像リサイズをメインスレッドから追い出すためのWorker。
// OffscreenCanvasを使って、長辺512px超の場合のみアスペクト比を維持してリサイズし、JPEGへ変換する。
// メインスレッドをブロックせず、複数Workerに分散させることで大量枚数(数百枚)の事前処理を並列化する。
//
// Next.js(Turbopack)の `new Worker(new URL('...ts', import.meta.url))` はビルド時にJSへ
// トランスパイルされず生の.tsファイルがそのまま配信されてしまうため、あえてバンドラを経由しない
// publicディレクトリ配下の素のJSファイルとして実装している(src/lib/resizeWorkerPool.ts から
// `new Worker('/workers/resizeWorker.js')` で参照)。

// リサイズ本体。参考実装(メインスレッド版)のロジックをOffscreenCanvasへそのまま移植したもの。
async function resizeImage(file, maxLongSide, quality) {
    const imageBitmap = await createImageBitmap(file);
    const { width, height } = imageBitmap;
    const longSide = Math.max(width, height);

    if (longSide <= maxLongSide) {
        imageBitmap.close();
        return null;
    }

    const scale = maxLongSide / longSide;
    const targetWidth = Math.round(width * scale);
    const targetHeight = Math.round(height * scale);

    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        imageBitmap.close();
        throw new Error('OffscreenCanvas 2D context を取得できませんでした');
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(imageBitmap, 0, 0, targetWidth, targetHeight);
    imageBitmap.close();

    return canvas.convertToBlob({ type: 'image/jpeg', quality });
}

self.onmessage = (event) => {
    const { type, id, file, maxLongSide, quality } = event.data;
    if (type !== 'resize') return;

    resizeImage(file, maxLongSide, quality)
        .then((blob) => {
            self.postMessage({ type: 'resize-success', id, blob });
        })
        .catch((err) => {
            self.postMessage({
                type: 'resize-error',
                id,
                error: err instanceof Error ? err.message : '画像のリサイズに失敗しました',
            });
        });
};
