// アップロード画像をブラウザ側で事前リサイズする処理。
// バックエンド(imaging.Resize)の基準に合わせ、長辺512pxを超える場合のみアスペクト比を維持してリサイズし、JPEGへ変換する。
// 本体の処理はWeb Worker(OffscreenCanvas)側で行い、メインスレッドはWorkerへファイルを渡して
// リサイズ結果を受け取るだけにする。Worker/OffscreenCanvasが使えない環境ではメインスレッドの
// Canvas APIにフォールバックする。

import { getResizeWorkerPool, isWorkerResizeSupported, type ResizeOutcome } from '@/src/lib/resizeWorkerPool';

export const RESIZE_MAX_LONG_SIDE = 512;
export const RESIZE_JPEG_QUALITY = 0.9;

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
        img.src = src;
    });
}

// Worker(OffscreenCanvas)が使えない環境向けのフォールバック。ロジックはWorker版と同一。
async function resizeImageMainThread(
    file: File,
    maxLongSide: number,
    quality: number
): Promise<ResizeOutcome> {
    const objectUrl = URL.createObjectURL(file);
    try {
        const image = await loadImage(objectUrl);
        const { naturalWidth: width, naturalHeight: height } = image;
        const longSide = Math.max(width, height);

        if (longSide <= maxLongSide) {
            return { blob: null };
        }

        const scale = maxLongSide / longSide;
        const targetWidth = Math.round(width * scale);
        const targetHeight = Math.round(height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context を取得できませんでした');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (!blob) throw new Error('画像のリサイズに失敗しました');
        return { blob };
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

// 長辺が maxLongSide を超える場合のみリサイズする。可能な限りWorkerプールに投げ、
// 失敗時のみメインスレッドにフォールバックする。
export async function resizeImageFile(
    file: File,
    maxLongSide: number = RESIZE_MAX_LONG_SIDE,
    quality: number = RESIZE_JPEG_QUALITY
): Promise<ResizeOutcome> {
    if (isWorkerResizeSupported()) {
        try {
            return await getResizeWorkerPool().resize(file, { maxLongSide, quality });
        } catch (err) {
            console.error('Workerでのリサイズに失敗したため、メインスレッドにフォールバックします:', err);
        }
    }

    try {
        return await resizeImageMainThread(file, maxLongSide, quality);
    } catch (err) {
        console.error('画像のリサイズに失敗したため、元画像のみ送信します:', err);
        return { blob: null };
    }
}

function blobToJpegFile(blob: Blob, originalFileName: string): File {
    const baseName = originalFileName.replace(/\.[^./\\]+$/, '') || 'image';
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
}

export interface UploadImageFiles {
    original: File;
    // リサイズが不要だった場合、またはリサイズに失敗した場合は null。
    // 呼び出し側は resized_file を付けずに送信し、バックエンド側のフォールバック処理に任せる。
    resized: File | null;
}

// アップロード用に、オリジナルとリサイズ版(不要/失敗時はnull)のFileペアを作る。
export async function buildUploadImageFiles(file: File): Promise<UploadImageFiles> {
    const { blob } = await resizeImageFile(file);
    return { original: file, resized: blob ? blobToJpegFile(blob, file.name) : null };
}

// 複数ファイルのリサイズを(Workerプールの上限並列数で)まとめて先行投入し、
// 元の並び順のままPromiseの配列を返す。
// 呼び出し側はこの配列を順番にawaitしながら1枚ずつアップロードすることで、
// 「今の画像のアップロード」と「次以降の画像のリサイズ」を重ね合わせられる(先読み)。
export function prefetchUploadImageFiles(files: File[]): Promise<UploadImageFiles>[] {
    return files.map((file) => buildUploadImageFiles(file));
}
