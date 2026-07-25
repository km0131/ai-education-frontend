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

export interface ProcessedFiles {
    // 除外ファイルを取り除き、HEIC/HEIFは変換済み(非対応形式はそのまま)のファイル一覧
    files: File[];
    // 変換に失敗したファイル(黙ってスキップせず、呼び出し側で一覧表示する)
    failures: HeicConversionFailure[];
}

// 選択されたファイル群を、送信用に正規化する。
// - .AAE/.MOV/.DS_Store/Thumbs.db 等は黙って除外する
// - HEIC/HEIFはheic2anyでJPEGに変換する(失敗時はfailuresに理由付きで積み、filesには含めない)
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
            failures.push({
                name: file.name,
                reason: err instanceof Error ? err.message : 'HEIC/HEIFの変換に失敗しました',
            });
        }
    }

    return { files, failures };
}
