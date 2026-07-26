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

// 選択されたファイル群を、送信用に正規化する。
// - .AAE/.MOV/.DS_Store/Thumbs.db 等は黙って除外する(これらは送信対象にしない)
// - HEIC/HEIFはheic2anyでJPEGに変換する
// - 変換に失敗した場合でも、元のHEIC/HEIFファイルをそのままfilesに含めて送信対象にする。
//   ここで弾いてしまうとバックエンドのフォールバック変換(heif-convert)が一切実行されず、
//   「フロントで失敗した画像は結局学習データに入らない」という元の問題を繰り返すため、
//   失敗はfailuresに記録しつつ送信自体は続行する。
// - それ以外(RAWファイルを含む)はそのまま通す
export async function processSelectedFiles(rawFiles: File[]): Promise<ProcessedFiles> {
    const files: File[] = [];
    const failures: HeicConversionFailure[] = [];

    const targets = rawFiles.filter((file) => !isExcludedFile(file));
    if (targets.length === 0) {
        return { files, failures };
    }

    // heic2anyはlibheif(wasm)をブラウザ環境でのみ読み込むため、SSR/ビルド時の副作用を避けて動的importする。
    const heic2anyModule = targets.some((file) => isHeicFile(file))
        ? (await import('heic2any')).default
        : null;

    for (const file of targets) {
        if (!isHeicFile(file)) {
            files.push(file);
            continue;
        }

        try {
            const converted = await heic2anyModule!({
                blob: file,
                toType: 'image/jpeg',
                quality: 0.85,
            });
            // heic2anyはライブフォトなど複数フレームを持つ場合に配列を返すことがある
            const blob = Array.isArray(converted) ? converted[0] : converted;
            const newName = file.name.replace(/\.(heic|heif)$/i, '.jpg');
            files.push(new File([blob], newName, { type: 'image/jpeg' }));
        } catch (err) {
            // heic2anyの失敗理由はUI上は小さな警告欄にしか出ないため、原因調査用にconsoleへも残す
            console.error(`[heicConvert] heic2anyでの変換に失敗しました: ${file.name}`, err);
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
