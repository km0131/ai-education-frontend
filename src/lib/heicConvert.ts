// HEIC/HEIF画像をブラウザ上でJPEGに変換する処理。
// iPhoneで撮影したHEIC/HEIFがそのままだとバックエンド(disintegration/imaging)でデコードできず、
// 変換されずに学習データから欠落する事故が起きたための対策。
// resizeImageFile(imageResize.ts)と同じ「フロントで極力対応し、対応できない場合のみバックエンドの
// フォールバック(heif-convert/exiftool)に任せる」という設計方針に合わせている。

const EXCLUDED_EXACT_NAMES = ['.ds_store', 'thumbs.db'];
const EXCLUDED_EXTENSIONS = ['.aae', '.mov'];
const RAW_EXTENSIONS = ['.cr2', '.cr3'];

// iPhoneのライブフォトの動画(.MOV)・編集情報のサイドカーファイル(.AAE)・OS生成ファイルなど、
// 学習データとして送るべきでない非画像ファイルを判定する。
export function isExcludedFile(file: File): boolean {
    const name = file.name.toLowerCase();
    if (EXCLUDED_EXACT_NAMES.includes(name)) return true;
    return EXCLUDED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

// 拡張子とMIMEタイプの両方でHEIC/HEIFを判定する(iPhoneはtypeが空文字になる場合があるため)。
export function isHeicFile(file: File): boolean {
    const name = file.name.toLowerCase();
    return (
        name.endsWith('.heic') ||
        name.endsWith('.heif') ||
        file.type === 'image/heic' ||
        file.type === 'image/heif'
    );
}

// 一眼カメラのRAWファイル。ブラウザでは画像としてデコードできないため、プレビュー表示の出し分けに使う。
// 変換自体はバックエンドのexiftoolフォールバックに任せる。
export function isRawFile(file: File): boolean {
    const name = file.name.toLowerCase();
    return RAW_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export interface HeicConversionFailure {
    name: string;
    reason: string;
}

const HEIC_JPEG_QUALITY = 0.85;

// Safari(iOS 17+ / macOS Sonoma+)はcreateImageBitmap()経由でOSネイティブのHEICデコーダーに
// 処理を委譲できる。ライセンス済みHEVCデコーダーを使うため、heic2any(WASM/libheif)が苦手な
// 10bit HDR形式のHEICも正しく読める。UAスニッフィングではなく、実際にcreateImageBitmapで
// デコードが成功するかどうかで判定する(機能検出)。成功しなければ(Chrome/Firefox/Edge、
// 対応前のSafari等)nullを返し、呼び出し側でheic2anyにフォールバックさせる。
async function convertViaNativeDecode(file: File, quality: number): Promise<Blob | null> {
    if (typeof createImageBitmap !== 'function') return null;

    let bitmap: ImageBitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch {
        // ブラウザにHEICのネイティブデコーダーが無い場合はここで失敗する(想定内)
        return null;
    }

    try {
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(bitmap, 0, 0);
        return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    } finally {
        bitmap.close();
    }
}

// heic2anyはSafariのネイティブデコードが使えない場合のみ必要になる。wasm(libheif)を含み
// サイズが大きいため、実際に必要になるまで動的importを遅延させ、一度読み込んだら使い回す。
let heic2anyModulePromise: Promise<typeof import('heic2any')> | null = null;
function loadHeic2any() {
    if (!heic2anyModulePromise) {
        heic2anyModulePromise = import('heic2any');
    }
    return heic2anyModulePromise;
}

// heic2anyはError インスタンスではなく { code, message } というプレーンオブジェクトでrejectするため、
// `err instanceof Error` では判定できない。messageプロパティの有無で失敗理由を取り出す。
function extractFailureReason(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'object' && err !== null && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
        return (err as { message: string }).message;
    }
    return 'HEIC/HEIFの変換に失敗しました';
}

export interface ProcessedFiles {
    // 除外ファイルを取り除いたファイル一覧。HEIC/HEIFは変換済み(ブラウザでの変換に失敗した場合は
    // 元のHEIC/HEIFファイルのまま)。除外ファイル以外は必ずここに含まれる = 送信対象になる。
    files: File[];
    // ブラウザでの変換に失敗したファイル(黙ってスキップはしないが、送信自体はブロックしない。
    // 元ファイルのまま送信し、バックエンドのフォールバック変換(heif-convert)に委ねる)
    failures: HeicConversionFailure[];
}

// 1枚のHEIC/HEIFファイルをJPEG Blobに変換する。
// まずSafariのネイティブデコード(createImageBitmap)を試し、使えない場合のみheic2anyに委ねる。
// どちらも失敗した場合は例外を投げる(呼び出し側でfailuresに記録し、元ファイルを送信対象に残す)。
async function convertHeicFileToJpegBlob(file: File): Promise<Blob> {
    const nativeBlob = await convertViaNativeDecode(file, HEIC_JPEG_QUALITY);
    if (nativeBlob) return nativeBlob;

    const heic2any = (await loadHeic2any()).default;
    const converted = await heic2any({
        blob: file,
        toType: 'image/jpeg',
        quality: HEIC_JPEG_QUALITY,
    });
    // heic2anyはライブフォトなど複数フレームを持つ場合に配列を返すことがある
    return Array.isArray(converted) ? converted[0] : converted;
}

// 選択されたファイル群を、送信用に正規化する。
// - .AAE/.MOV/.DS_Store/Thumbs.db 等は黙って除外する(これらは送信対象にしない)
// - HEIC/HEIFはまずSafariネイティブデコード、ダメならheic2anyでJPEGに変換する
// - 変換に失敗した場合でも、元のHEIC/HEIFファイルをそのままfilesに含めて送信対象にする。
//   ここで弾いてしまうとバックエンドのフォールバック変換(heif-convert)が一切実行されず、
//   「フロントで失敗した画像は結局学習データに入らない」という元の問題を繰り返すため、
//   失敗はfailuresに記録しつつ送信自体は続行する。
// - それ以外(RAWファイルを含む)はそのまま通す
export async function processSelectedFiles(rawFiles: File[]): Promise<ProcessedFiles> {
    const files: File[] = [];
    const failures: HeicConversionFailure[] = [];

    const targets = rawFiles.filter((file) => !isExcludedFile(file));

    for (const file of targets) {
        if (!isHeicFile(file)) {
            files.push(file);
            continue;
        }

        try {
            const blob = await convertHeicFileToJpegBlob(file);
            const newName = file.name.replace(/\.(heic|heif)$/i, '.jpg');
            files.push(new File([blob], newName, { type: 'image/jpeg' }));
        } catch (err) {
            // 失敗理由はUI上は小さな警告欄にしか出ないため、原因調査用にconsoleへも残す
            console.error(`[heicConvert] HEIC/HEIFの変換に失敗しました: ${file.name}`, err);
            failures.push({
                name: file.name,
                reason: extractFailureReason(err),
            });
            // 変換できなくても元ファイルは送信対象に残す(バックエンドのフォールバックに委ねる)
            files.push(file);
        }
    }

    return { files, failures };
}
