import * as tf from '@tensorflow/tfjs';
import { loadLiteRt, loadAndCompile, type CompiledModel } from '@litertjs/core';
import { runWithTfjsTensors } from '@litertjs/tfjs-interop';

// 3モデル(mobilenet_v3 / efficientnet_lite4 / mobilevit_v2)とも.tfliteへ移行済み。
// tfjs(model.json+bin)はもう配信されないため、常にLiteRT.js経由でロード・推論する。
export type AnyModel = CompiledModel;

// LiteRT.jsのWASMランタイムはプロセス内で一度だけ初期化する。
// 自前ホストする場合は node_modules/@litertjs/core/wasm/ を public/ 配下にコピーしてパスを差し替える。
let liteRtReadyPromise: Promise<unknown> | null = null;
function ensureLiteRtReady(): Promise<unknown> {
    if (!liteRtReadyPromise) {
        liteRtReadyPromise = loadLiteRt('https://cdn.jsdelivr.net/npm/@litertjs/core/wasm/');
    }
    return liteRtReadyPromise;
}

export async function loadModel(url: string): Promise<AnyModel> {
    await ensureLiteRtReady();
    // @tensorflow/tfjsのwebgpuバックエンド(@tensorflow/tfjs-backend-webgpu)を
    // 導入していないため、tfjs側は常にwebgl/cpuバックエンドで動く。
    // LiteRT側をwebgpuでコンパイルすると、推論結果をTFJSテンソルへ変換する際に
    // 「LiteRT WebGPUテンソルはTFJS WebGPUテンソルにしか変換できない」エラーになるため、
    // wasm(XNNPACK/CPU)アクセラレータのみを使用する。
    return await loadAndCompile(url, { accelerator: 'wasm' });
}

interface InputSize {
    height: number;
    width: number;
    layout: 'nhwc' | 'nchw';
}

function getInputSize(model: AnyModel): InputSize {
    const shape = model.getInputDetails()[0].shape; // 例: [1,3,256,256](NCHW) or [1,224,224,3](NHWC)
    const isNchw = shape.length === 4 && shape[1] === 3;
    return {
        height: isNchw ? shape[2] : shape[1],
        width: isNchw ? shape[3] : shape[2],
        layout: isNchw ? 'nchw' : 'nhwc',
    };
}

// 3モデルとも PyTorch/timm 統一後は「x/255をtimmのmean/stdで正規化」という共通の形になる。
// 値はPython側 torch_models.get_preprocess_config() の実測結果と一致させること
// (ai_logic.py の _preprocess_for_tflite_eval と同じ数値)。
const MODEL_NORMALIZE: Record<string, { mean: [number, number, number]; std: [number, number, number] }> = {
    mobilenet_v3: { mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] }, // timm mobilenetv3_large_100
    efficientnet_lite4: { mean: [0.5, 0.5, 0.5], std: [0.5, 0.5, 0.5] },       // timm tf_efficientnet_lite4
    mobilevit_v2: { mean: [0, 0, 0], std: [1, 1, 1] },                        // timm mobilevitv2_100
};

// モデルごとの前処理（Python側の学習コードと必ず一致させること）
function preprocessForModel(modelName: string, resized: tf.Tensor3D): tf.Tensor {
    const norm = MODEL_NORMALIZE[modelName];
    if (!norm) {
        console.warn(`未知のモデル名: ${modelName}。デフォルトの0-1正規化を適用します`);
        return resized.div(255.0);
    }
    const mean = tf.tensor1d(norm.mean);
    const std = tf.tensor1d(norm.std);
    return resized.div(255.0).sub(mean).div(std);
}

// timmの分類ヘッドはどのモデルも生ロジットを返す(softmax層なし)ため、常にsoftmaxを適用する
// (Python側のevaluate_test_model/_preprocess_for_tflite_evalのapply_softmaxと同じ判定基準)。
function needsSoftmax(_modelName: string): boolean {
    return true;
}

export interface InferenceResult {
    categoryIndex: number;
    confidence: number;
    probabilities: number[];
}

function toInferenceResult(data: ArrayLike<number>): InferenceResult {
    const probabilities = Array.from(data);
    let categoryIndex = 0;
    let confidence = probabilities[0] ?? 0;
    probabilities.forEach((p, i) => {
        if (p > confidence) {
            confidence = p;
            categoryIndex = i;
        }
    });
    return { categoryIndex, confidence, probabilities };
}

export async function runInference(
    model: AnyModel,
    modelName: string,
    imageEl: HTMLImageElement
): Promise<InferenceResult> {
    const { height, width, layout } = getInputSize(model);

    const inputTensor = tf.tidy(() => {
        const img = tf.browser.fromPixels(imageEl).toFloat();
        const resized = tf.image.resizeBilinear(img, [height, width]);
        const normalized = preprocessForModel(modelName, resized) as tf.Tensor3D;
        const batched = normalized.expandDims(0); // [1,H,W,3]
        return layout === 'nchw' ? batched.transpose([0, 3, 1, 2]) : batched;
    });

    const rawOutputs = await runWithTfjsTensors(model, inputTensor);
    inputTensor.dispose();
    const rawOutput = Array.isArray(rawOutputs) ? rawOutputs[0] : rawOutputs;

    const probsTensor = needsSoftmax(modelName) ? tf.softmax(rawOutput) : rawOutput;
    const data = await probsTensor.data();
    if (probsTensor !== rawOutput) {
        rawOutput.dispose();
    }
    probsTensor.dispose();

    return toInferenceResult(data);
}

export function disposeModel(model: AnyModel) {
    model.delete();
}
