// public/workers/resizeWorker.js を束ねるプール。CPUコア数に応じたWorker数を起動し、
// FIFOキューで空いたWorkerに順次ジョブを割り当てることで、リサイズを並列化する。
// アップロード自体は呼び出し側で1枚ずつ直列に行う(ここではリサイズの並列先読みのみを担当する)。
//
// Worker本体をpublic配下の素のJSファイルとして持つ理由: Next.js(Turbopack)の
// `new Worker(new URL('...ts', import.meta.url))` は本プロジェクトのビルドではJSへ
// トランスパイルされず、生の.tsソースがそのまま静的アセットとして配信されてしまう
// (ブラウザはTypeScript構文を解釈できずWorker起動が失敗する)ため、バンドラを経由しない
// 素のJSとして配置し、プレーンな文字列URLで読み込んでいる。

const WORKER_SCRIPT_URL = '/workers/resizeWorker.js';

export interface ResizeOutcome {
    // 長辺が既に上限以下でリサイズが不要だった場合はnull
    blob: Blob | null;
}

interface ResizeRequestMessage {
    type: 'resize';
    id: number;
    file: File;
    maxLongSide: number;
    quality: number;
}

interface ResizeSuccessMessage {
    type: 'resize-success';
    id: number;
    blob: Blob | null;
}

interface ResizeErrorMessage {
    type: 'resize-error';
    id: number;
    error: string;
}

type ResizeResponseMessage = ResizeSuccessMessage | ResizeErrorMessage;

interface QueuedJob {
    id: number;
    file: File;
    maxLongSide: number;
    quality: number;
    resolve: (result: ResizeOutcome) => void;
    reject: (err: Error) => void;
}

interface WorkerSlot {
    worker: Worker;
    busy: boolean;
}

const DEFAULT_MAX_LONG_SIDE = 512;
const DEFAULT_QUALITY = 0.9;
// 起動しすぎて他の処理(UI操作・アップロード)を圧迫しないよう上限を設ける
const MAX_POOL_SIZE = 6;

function getDefaultPoolSize(): number {
    if (typeof navigator === 'undefined' || !navigator.hardwareConcurrency) return 2;
    // 1コアはメインスレッド(UI操作・アップロード送信)用に残す
    return Math.max(1, Math.min(navigator.hardwareConcurrency - 1, MAX_POOL_SIZE));
}

class ResizeWorkerPool {
    private slots: WorkerSlot[] = [];
    private queue: QueuedJob[] = [];
    private pendingJobs = new Map<number, QueuedJob>();
    private jobIdToSlot = new Map<number, WorkerSlot>();
    private nextJobId = 0;

    constructor(private readonly poolSize: number) {}

    private ensureWorkers() {
        if (this.slots.length > 0) return;
        for (let i = 0; i < this.poolSize; i++) {
            const worker = new Worker(WORKER_SCRIPT_URL);
            const slot: WorkerSlot = { worker, busy: false };
            worker.onmessage = (event: MessageEvent<ResizeResponseMessage>) => this.handleMessage(slot, event.data);
            worker.onerror = (event) => {
                // どのジョブに対するエラーか特定できないため、処理中のジョブを失敗させてWorkerを解放する
                const jobId = [...this.jobIdToSlot.entries()].find(([, s]) => s === slot)?.[0];
                if (jobId !== undefined) {
                    const job = this.pendingJobs.get(jobId);
                    job?.reject(new Error(event.message || 'Workerでエラーが発生しました'));
                    this.pendingJobs.delete(jobId);
                    this.jobIdToSlot.delete(jobId);
                }
                slot.busy = false;
                this.pump();
            };
            this.slots.push(slot);
        }
    }

    private handleMessage(slot: WorkerSlot, data: ResizeResponseMessage) {
        const job = this.pendingJobs.get(data.id);
        this.pendingJobs.delete(data.id);
        this.jobIdToSlot.delete(data.id);
        slot.busy = false;

        if (job) {
            if (data.type === 'resize-success') {
                job.resolve({ blob: data.blob });
            } else {
                job.reject(new Error(data.error));
            }
        }
        this.pump();
    }

    private pump() {
        for (const slot of this.slots) {
            if (slot.busy) continue;
            const job = this.queue.shift();
            if (!job) break;

            slot.busy = true;
            this.pendingJobs.set(job.id, job);
            this.jobIdToSlot.set(job.id, slot);

            const message: ResizeRequestMessage = {
                type: 'resize',
                id: job.id,
                file: job.file,
                maxLongSide: job.maxLongSide,
                quality: job.quality,
            };
            slot.worker.postMessage(message);
        }
    }

    resize(file: File, options?: { maxLongSide?: number; quality?: number }): Promise<ResizeOutcome> {
        this.ensureWorkers();
        const id = this.nextJobId++;

        return new Promise<ResizeOutcome>((resolve, reject) => {
            this.queue.push({
                id,
                file,
                maxLongSide: options?.maxLongSide ?? DEFAULT_MAX_LONG_SIDE,
                quality: options?.quality ?? DEFAULT_QUALITY,
                resolve,
                reject,
            });
            this.pump();
        });
    }

    terminate() {
        this.slots.forEach(({ worker }) => worker.terminate());
        this.slots = [];
        this.queue = [];
        this.pendingJobs.clear();
        this.jobIdToSlot.clear();
    }
}

let sharedPool: ResizeWorkerPool | null = null;

// Worker / OffscreenCanvas が使える環境かどうか(SSR・古いブラウザでのフォールバック判定用)
export function isWorkerResizeSupported(): boolean {
    return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
}

export function getResizeWorkerPool(poolSize: number = getDefaultPoolSize()): ResizeWorkerPool {
    if (!sharedPool) {
        sharedPool = new ResizeWorkerPool(poolSize);
    }
    return sharedPool;
}
