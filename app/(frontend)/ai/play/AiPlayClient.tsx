'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Cookies from 'js-cookie';
import { API_URL } from '@/src/lib/api';
import { loadModel, runInference, disposeModel } from './tfModel';

// --- 型定義 ---
interface LabelDef {
    category_index: number;
    title: string;
    explanation?: string;
}
type ModelUrls = Record<string, string>;

type ModelStatus = 'pending' | 'running' | 'done' | 'error';

interface ModelResultState {
    modelName: string;
    status: ModelStatus;
    categoryIndex?: number;
    confidence?: number;
    errorMessage?: string;
}

interface FinalDecision {
    categoryIndex: number;
    reason: 'majority' | 'confidence';
}

// バックエンドが返す順序に依存せず、常に同じ順番で1体ずつ実行する
const MODEL_ORDER = ['mobilenet_v3', 'efficientnet_lite4', 'mobilevit_v2'];

// 3つのモデルの予測を多数決でまとめる。全員バラバラの場合は最も確信度が高いモデルを採用する
function decideFinal(results: ModelResultState[]): FinalDecision | null {
    const finished = results.filter((r) => r.status === 'done' && r.categoryIndex !== undefined);
    if (finished.length === 0) return null;

    const counts = new Map<number, number>();
    finished.forEach((r) => {
        const idx = r.categoryIndex as number;
        counts.set(idx, (counts.get(idx) || 0) + 1);
    });

    let majorityIndex: number | null = null;
    let maxCount = 0;
    counts.forEach((count, idx) => {
        if (count > maxCount) {
            maxCount = count;
            majorityIndex = idx;
        }
    });

    if (majorityIndex !== null && maxCount >= 2) {
        return { categoryIndex: majorityIndex, reason: 'majority' };
    }

    const best = finished.reduce((a, b) => ((b.confidence ?? 0) > (a.confidence ?? 0) ? b : a));
    return { categoryIndex: best.categoryIndex as number, reason: 'confidence' };
}

export default function AiPlayPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const projectUuid = searchParams.get('id') || '';

    const [loadingModelInfo, setLoadingModelInfo] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [modelUrls, setModelUrls] = useState<ModelUrls>({});
    const [labels, setLabels] = useState<LabelDef[]>([]);

    const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
    const [imageLoaded, setImageLoaded] = useState(false);
    const imgElRef = useRef<HTMLImageElement>(null);

    const [phase, setPhase] = useState<'capture' | 'running' | 'result'>('capture');
    const [results, setResults] = useState<ModelResultState[]>([]);
    const [finalDecision, setFinalDecision] = useState<FinalDecision | null>(null);

    // マウント時に認証チェック
    useEffect(() => {
        const savedToken = Cookies.get('auth_token');
        if (!savedToken) {
            router.push('/');
        }
    }, [router]);

    // モデルURL・ラベル一覧の取得
    useEffect(() => {
        if (!projectUuid) return;

        const fetchModelInfo = async () => {
            setLoadingModelInfo(true);
            setLoadError(null);
            try {
                const savedToken = Cookies.get('auth_token');
                const res = await fetch(`${API_URL}/api/v1/ai/ai_model`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${savedToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ project_id: projectUuid }),
                });

                if (!res.ok) {
                    throw new Error('AIモデル情報の取得に失敗しました');
                }

                const data = await res.json();
                // バックエンドは { aimodel: { models, labels } } の形でラップして返す
                const aimodel = data.aimodel ?? data;
                const rawModels = (aimodel.models || {}) as ModelUrls;
                // バックエンドの API_URL 未設定時、モデルURLがホストなしの相対パスで返ってくることがあるため補完する
                const resolvedModels = Object.fromEntries(
                    Object.entries(rawModels).map(([name, url]) => [
                        name,
                        url.startsWith('http') ? url : `${API_URL.replace(/\/$/, '')}/${url.replace(/^\//, '')}`,
                    ])
                );
                setModelUrls(resolvedModels);
                setLabels(aimodel.labels || []);
            } catch (err) {
                console.error('[Error] AIモデル取得失敗:', err);
                setLoadError(err instanceof Error ? err.message : 'AIモデル情報の取得に失敗しました');
            } finally {
                setLoadingModelInfo(false);
            }
        };

        fetchModelInfo();
    }, [projectUuid]);

    // オブジェクトURLの解放
    useEffect(() => {
        return () => {
            if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
        };
    }, [imagePreviewUrl]);

    // モデルの出力クラス番号(0始まり)は、labels配列の「並び順」に対応する
    // （学習時に sorted(unique_labels) の順で 0,1,2... を割り当てているため。
    //  category_index の値自体は1始まりなど不連続な場合があるので、値の一致では引けない）。
    // バックエンドは category_index 昇順でlabelsをソート済みなので、配列の位置がそのままモデルの出力クラス番号と一致する。
    const labelForIndex = (idx: number) => labels[idx]?.title ?? `ラベル${idx}`;
    const explanationForIndex = (idx: number) => labels[idx]?.explanation ?? '';

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
        setImagePreviewUrl(URL.createObjectURL(file));
        setImageLoaded(false);
        setPhase('capture');
        setResults([]);
        setFinalDecision(null);
        e.target.value = '';
    };

    const handleRunAll = async () => {
        if (!imgElRef.current || !imageLoaded) return;

        const orderedNames = [
            ...MODEL_ORDER.filter((n) => modelUrls[n]),
            ...Object.keys(modelUrls).filter((n) => !MODEL_ORDER.includes(n)),
        ];
        if (orderedNames.length === 0) return;

        setPhase('running');
        setFinalDecision(null);
        setResults(orderedNames.map((name) => ({ modelName: name, status: 'pending' })));

        const collected: ModelResultState[] = [];

        for (const name of orderedNames) {
            console.log(`--- ${name} 開始 ---`, modelUrls[name]);
            setResults((prev) => prev.map((r) => (r.modelName === name ? { ...r, status: 'running' } : r)));

            try {
                const model = await loadModel(modelUrls[name]);
                console.log(`${name} モデル読み込み成功`, model);
                const inference = await runInference(model, name, imgElRef.current);
                console.log(`${name} 推論成功`, inference);
                disposeModel(model);

                const updated: ModelResultState = {
                    modelName: name,
                    status: 'done',
                    categoryIndex: inference.categoryIndex,
                    confidence: inference.confidence,
                };
                collected.push(updated);
                setResults((prev) => prev.map((r) => (r.modelName === name ? updated : r)));
            } catch (err) {
                console.error(`[Error] ${name} の実行に失敗:`, err);
                const updated: ModelResultState = {
                    modelName: name,
                    status: 'error',
                    errorMessage: err instanceof Error ? err.message : '実行に失敗しました',
                };
                collected.push(updated);
                setResults((prev) => prev.map((r) => (r.modelName === name ? updated : r)));
            }
        }

        setFinalDecision(decideFinal(collected));
        setPhase('result');
    };

    const handleReset = () => {
        if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
        setImagePreviewUrl(null);
        setImageLoaded(false);
        setResults([]);
        setFinalDecision(null);
        setPhase('capture');
    };

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
                <div className="max-w-3xl mx-auto px-6 h-16 flex items-center gap-4">
                    <button
                        onClick={() => router.back()}
                        className="p-2 hover:bg-gray-100 rounded-full text-gray-600 transition-colors"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <h1 className="text-xl font-black text-gray-800">🎮 AIを試してみよう</h1>
                </div>
            </header>

            <main className="flex-1 max-w-3xl mx-auto w-full p-6 space-y-6">
                {loadingModelInfo ? (
                    <div className="text-center py-20 text-gray-400 font-bold animate-pulse">AIモデルを読み込んでいます...</div>
                ) : loadError ? (
                    <div className="text-center py-20 text-red-500 font-bold">{loadError}</div>
                ) : (
                    <>
                        {/* 画像撮影・アップロードエリア */}
                        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-4">
                            <h2 className="text-lg font-black text-gray-700">① 写真をとる・えらぶ</h2>

                            {imagePreviewUrl ? (
                                <div className="flex flex-col items-center gap-4">
                                    <img
                                        ref={imgElRef}
                                        src={imagePreviewUrl}
                                        alt="判定する画像"
                                        onLoad={() => setImageLoaded(true)}
                                        onError={() => setImageLoaded(false)}
                                        className="max-h-80 rounded-2xl border-2 border-gray-100 shadow-sm object-contain"
                                    />
                                    <div className="flex gap-3">
                                        <label className="cursor-pointer px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-bold rounded-xl transition-colors">
                                            📷 写真をとりなおす
                                            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={handleFileChange} />
                                        </label>
                                        <label className="cursor-pointer px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-bold rounded-xl transition-colors">
                                            🖼️ べつの写真をえらぶ
                                            <input type="file" accept="image/*" className="sr-only" onChange={handleFileChange} />
                                        </label>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-col sm:flex-row gap-4">
                                    <label className="flex-1 flex flex-col items-center justify-center gap-3 border-2 border-dashed border-indigo-200 rounded-2xl py-14 cursor-pointer hover:bg-indigo-50/50 transition-colors">
                                        <span className="text-4xl">📷</span>
                                        <span className="text-sm font-bold text-indigo-500">写真をとる</span>
                                        <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={handleFileChange} />
                                    </label>
                                    <label className="flex-1 flex flex-col items-center justify-center gap-3 border-2 border-dashed border-indigo-200 rounded-2xl py-14 cursor-pointer hover:bg-indigo-50/50 transition-colors">
                                        <span className="text-4xl">🖼️</span>
                                        <span className="text-sm font-bold text-indigo-500">写真をえらぶ（アップロード）</span>
                                        <input type="file" accept="image/*" className="sr-only" onChange={handleFileChange} />
                                    </label>
                                </div>
                            )}
                        </div>

                        {/* 判定ボタン */}
                        {imagePreviewUrl && phase === 'capture' && (
                            <button
                                onClick={handleRunAll}
                                disabled={!imageLoaded}
                                className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white font-black text-lg rounded-2xl shadow-lg shadow-indigo-100 active:scale-95 transition-all"
                            >
                                🤖 この写真でAIに聞いてみる！
                            </button>
                        )}

                        {/* モデルごとの実行結果 */}
                        {(phase === 'running' || phase === 'result') && (
                            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-4">
                                <h2 className="text-lg font-black text-gray-700">② それぞれのAIの意見</h2>
                                <div className="space-y-3">
                                    {results.map((r) => (
                                        <div
                                            key={r.modelName}
                                            className="flex items-center justify-between gap-3 p-4 bg-gray-50 border border-gray-100 rounded-2xl"
                                        >
                                            <span className="text-sm font-black text-gray-700">{r.modelName}</span>
                                            {r.status === 'pending' && (
                                                <span className="text-xs font-bold text-gray-400">まちき...</span>
                                            )}
                                            {r.status === 'running' && (
                                                <span className="text-xs font-bold text-indigo-500 animate-pulse">かんがえちゅう...</span>
                                            )}
                                            {r.status === 'done' && (
                                                <span className="flex items-center gap-2">
                                                    <span className="text-sm font-black text-emerald-700">
                                                        {labelForIndex(r.categoryIndex as number)}
                                                    </span>
                                                    <span className="px-2 py-0.5 text-xs font-bold text-emerald-600 bg-emerald-100 rounded-full">
                                                        {Math.round((r.confidence ?? 0) * 100)}%
                                                    </span>
                                                </span>
                                            )}
                                            {r.status === 'error' && (
                                                <span className="text-xs font-bold text-red-500" title={r.errorMessage}>
                                                    しっぱい{r.errorMessage ? `（${r.errorMessage}）` : ''}
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* 最終結果（多数決） */}
                        {phase === 'result' && finalDecision && (
                            <div className="bg-white rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
                                <div className="flex items-center gap-2 mb-4">
                                    <span className="flex items-center justify-center w-[22px] h-[22px] rounded-full bg-white border border-[#eceef1] text-[#1f2430] text-xs font-bold flex-shrink-0">
                                        ③
                                    </span>
                                    <span className="text-[15px] font-bold text-[#1f2430]">
                                        {finalDecision.reason === 'majority' ? 'AIの結果' : '一番自信があったAIの意見'}
                                    </span>
                                </div>
                                <div className="text-[34px] font-extrabold text-[#1f2430] mb-3.5">
                                    {labelForIndex(finalDecision.categoryIndex)}
                                </div>
                                {explanationForIndex(finalDecision.categoryIndex) && (
                                    <div className="bg-[#f6f7f9] border border-[#eceef1] rounded-xl px-4 py-3.5">
                                        <div className="text-[11px] font-bold text-[#8a90a0] tracking-[0.04em] mb-1">
                                            せつめい
                                        </div>
                                        <div className="text-[19px] text-[#333844] leading-[1.6]">
                                            {explanationForIndex(finalDecision.categoryIndex)}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {phase === 'result' && !finalDecision && (
                            <div className="text-center py-6 text-red-500 font-bold">
                                すべてのAIの実行に失敗しました。もう一度試してみてください。
                            </div>
                        )}

                        {phase === 'result' && (
                            <button
                                onClick={handleReset}
                                className="w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold rounded-2xl transition-colors"
                            >
                                🔄 もう一度試す
                            </button>
                        )}
                    </>
                )}
            </main>
        </div>
    );
}
