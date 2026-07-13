'use client';

import React, { useEffect, useState } from 'react';
import Cookies from 'js-cookie';
import { FixedSizeList, ListChildComponentProps } from 'react-window';
import { API_URL } from '@/src/lib/api';
import { unwrapJson } from '@/src/lib/unwrap-json';
import VirtualizedPhotoGrid from '@/src/components/VirtualizedPhotoGrid';

// --- 型定義 ---
interface EpochPoint {
    epoch: number;
    accuracy: number;
    loss: number;
    val_accuracy: number;
    val_loss: number;
}
type TrainingCurveData = Record<string, EpochPoint[]>;
type TestResultsData = Record<string, number>;

interface TestImageResultEntry {
    test_image_id: number;
    image_url: string;
    predicted_label_id: number;
    confidence: number;
    correct_label_name: string;
    is_correct: boolean;
}
type TestResultsImageData = Record<string, TestImageResultEntry[]>;

interface EvalPhotograph {
    photograph_path: string;
    saturation: number;
    brightness: number;
    sharpness: number;
    diversity_vector: number[];
    is_analyzed: boolean;
}
interface EvalCategory {
    category_id: string;
    category_index: number;
    title: string;
    explanation: string;
    average_saturation: number;
    average_brightness: number;
    average_sharpness: number;
    photograph_count: number;
    photographs: EvalPhotograph[];
}
interface EvalOverallAverage {
    saturation: number;
    brightness: number;
    sharpness: number;
    photograph_count: number;
}
interface ImageEvaluationData {
    project_id: string;
    job_id: string;
    job_status: string;
    overall_average: EvalOverallAverage;
    categories: EvalCategory[];
}

interface AiResultModalProps {
    isOpen: boolean;
    onClose: () => void;
    projectUuid: string;
    projectTitle: string;
}

type TabKey = 'curve' | 'accuracy' | 'images' | 'evaluation';
type ImageFilter = 'all' | 'correct' | 'incorrect';

const MODEL_COLORS = ['#4f46e5', '#059669', '#d97706', '#dc2626', '#0891b2', '#7c3aed'];

// /api/v1/ai/get_description のレスポンス（配列 or { label: [...] } 等）から
// カテゴリID -> ラベル名 の対応表を作る
function buildLabelNameMap(raw: unknown): Record<number, string> {
    let categories: { category_index: number; title: string }[] = [];

    if (Array.isArray(raw)) {
        categories = raw;
    } else if (raw && typeof raw === 'object') {
        const obj = raw as Record<string, unknown>;
        if (Array.isArray(obj.label)) {
            categories = obj.label as { category_index: number; title: string }[];
        } else {
            const key = Object.keys(obj).find((k) => Array.isArray(obj[k]));
            if (key) categories = obj[key] as { category_index: number; title: string }[];
        }
    }

    const map: Record<number, string> = {};
    categories.forEach((c) => {
        if (c && typeof c.category_index === 'number') map[c.category_index] = c.title;
    });
    return map;
}

export function AiResultModal({ isOpen, onClose, projectUuid, projectTitle }: AiResultModalProps) {
    const [tab, setTab] = useState<TabKey>('curve');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [trainingCurve, setTrainingCurve] = useState<TrainingCurveData>({});
    const [testResults, setTestResults] = useState<TestResultsData>({});
    const [testImages, setTestImages] = useState<TestResultsImageData>({});
    const [labelNameById, setLabelNameById] = useState<Record<number, string>>({});
    const [imageEvaluation, setImageEvaluation] = useState<ImageEvaluationData | null>(null);

    const [selectedCurveModel, setSelectedCurveModel] = useState('');
    const [selectedImageModel, setSelectedImageModel] = useState('');
    const [imageFilter, setImageFilter] = useState<ImageFilter>('all');

    // モーダルが開いたら3種類の性能データを一括取得
    useEffect(() => {
        if (!isOpen || !projectUuid) return;

        const fetchAll = async () => {
            setLoading(true);
            setError(null);
            try {
                const savedToken = Cookies.get('auth_token');
                const headers = {
                    'Authorization': `Bearer ${savedToken}`,
                    'Content-Type': 'application/json',
                };
                const body = JSON.stringify({ project_id: projectUuid });
                const evalBody = JSON.stringify({ project_uuid: projectUuid });

                const [curveRes, resultsRes, imagesRes, descRes, evalRes] = await Promise.all([
                    fetch(`${API_URL}/api/v1/result/training_curve`, { method: 'POST', headers, body }),
                    fetch(`${API_URL}/api/v1/result/test_results`, { method: 'POST', headers, body }),
                    fetch(`${API_URL}/api/v1/result/test_results_imge`, { method: 'POST', headers, body }),
                    fetch(`${API_URL}/api/v1/ai/get_description`, { method: 'POST', headers, body }),
                    fetch(`${API_URL}/api/v1/result/image_evaluation_get`, { method: 'POST', headers, body: evalBody }),
                ]);

                if (!curveRes.ok || !resultsRes.ok || !imagesRes.ok) {
                    throw new Error('性能データの取得に失敗しました');
                }

                const curveRaw = await curveRes.json().catch(() => ({}));
                const resultsRaw = await resultsRes.json().catch(() => ({}));
                const imagesRaw = await imagesRes.json().catch(() => ({}));
                const descRaw = descRes.ok ? await descRes.json().catch(() => null) : null;
                const evalRaw = evalRes.ok ? await evalRes.json().catch(() => null) : null;

                const curveData = unwrapJson<TrainingCurveData>(curveRaw);
                const resultsData = unwrapJson<TestResultsData>(resultsRaw);
                const imagesData = unwrapJson<TestResultsImageData>(imagesRaw);

                setTrainingCurve(curveData || {});
                setTestResults(resultsData || {});
                setTestImages(imagesData || {});
                setLabelNameById(buildLabelNameMap(descRaw));
                setImageEvaluation(evalRaw && typeof evalRaw === 'object' && Array.isArray((evalRaw as ImageEvaluationData).categories)
                    ? (evalRaw as ImageEvaluationData)
                    : null);
                setSelectedCurveModel(Object.keys(curveData || {})[0] || '');
                setSelectedImageModel(Object.keys(imagesData || {})[0] || '');
            } catch (err) {
                console.error('[Error] AI性能データ取得失敗:', err);
                setError(err instanceof Error ? err.message : '性能データの取得に失敗しました');
            } finally {
                setLoading(false);
            }
        };

        fetchAll();
    }, [isOpen, projectUuid]);

    // 閉じたら状態をリセット
    useEffect(() => {
        if (isOpen) return;
        setTab('curve');
        setTrainingCurve({});
        setTestResults({});
        setTestImages({});
        setLabelNameById({});
        setImageEvaluation(null);
        setSelectedCurveModel('');
        setSelectedImageModel('');
        setImageFilter('all');
        setError(null);
    }, [isOpen]);

    if (!isOpen) return null;

    const modelNames = Object.keys(trainingCurve);
    const curvePoints = Array.isArray(trainingCurve[selectedCurveModel]) ? trainingCurve[selectedCurveModel] : [];
    const epochs = curvePoints.map((p) => p.epoch);

    const accuracyEntries = Object.entries(testResults)
        .filter((e): e is [string, number] => typeof e[1] === 'number')
        .sort((a, b) => b[1] - a[1]);

    const imageModelNames = Object.keys(testImages);
    const imageEntries = Array.isArray(testImages[selectedImageModel]) ? testImages[selectedImageModel] : [];
    const filteredImageEntries = imageEntries.filter((e) => {
        if (imageFilter === 'correct') return e.is_correct;
        if (imageFilter === 'incorrect') return !e.is_correct;
        return true;
    });
    const correctCount = imageEntries.filter((e) => e.is_correct).length;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden border border-gray-100">

                {/* ヘッダー */}
                <div className="bg-purple-600 px-6 py-5 flex justify-between items-center text-white flex-shrink-0">
                    <div>
                        <span className="text-xs font-bold text-purple-200 uppercase tracking-wider">AIの性能</span>
                        <h3 className="text-xl font-black truncate max-w-[420px]">{projectTitle}</h3>
                    </div>
                    <button onClick={onClose} className="hover:bg-white/20 p-2 rounded-full transition-all text-xl">✕</button>
                </div>

                {/* タブ */}
                <div className="flex border-b border-gray-100 bg-gray-50/70 flex-shrink-0">
                    {([
                        { key: 'curve', label: '📈 学習の推移' },
                        { key: 'accuracy', label: '🎯 テスト正解率' },
                        { key: 'images', label: '🖼️ 画像ごとの結果' },
                        { key: 'evaluation', label: '📷 画像の評価' },
                    ] as { key: TabKey; label: string }[]).map((t) => (
                        <button
                            key={t.key}
                            onClick={() => setTab(t.key)}
                            className={`px-5 py-3 text-sm font-bold border-b-2 transition-all ${
                                tab === t.key
                                    ? 'border-purple-500 text-purple-700 bg-white'
                                    : 'border-transparent text-gray-400 hover:text-gray-600'
                            }`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                {/* コンテンツ */}
                <div className="flex-1 overflow-y-auto p-6">
                    {loading ? (
                        <div className="text-center py-20 text-sm font-bold text-gray-400 animate-pulse">データを読み込み中...</div>
                    ) : error ? (
                        <div className="text-center py-20 text-sm font-bold text-red-400">{error}</div>
                    ) : (
                        <>
                            {tab === 'curve' && (
                                modelNames.length === 0 ? (
                                    <EmptyState text="学習の推移データがありません" />
                                ) : (
                                    <div className="space-y-5">
                                        <ModelTabs names={modelNames} selected={selectedCurveModel} onSelect={setSelectedCurveModel} />
                                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                                            <ChartCard title={
                                                <>
                                                    正解率(せいかいりつ)：
                                                    <br />
                                                    AIが写真を見て正しく当てられた量だよ！高いほどすごい！
                                                </>
                                            }>
                                                <div className="overflow-x-auto">
                                                    <LineChart
                                                        epochs={epochs}
                                                        yMin={0}
                                                        yMax={1}
                                                        yFormat={(v) => `${Math.round(v * 100)}%`}
                                                        series={[
                                                            { label: '学習', color: '#4f46e5', values: curvePoints.map((p) => p.accuracy) },
                                                            { label: '検証', color: '#a5b4fc', dashed: true, values: curvePoints.map((p) => p.val_accuracy) },
                                                        ]}
                                                    />
                                                </div>
                                                <Legend items={[{ label: '学習', color: '#4f46e5' }, { label: '検証', color: '#a5b4fc', dashed: true }]} />
                                            </ChartCard>
                                            <ChartCard title={
                                                <>
                                                    まちがいの量（ロス）：
                                                    <br />
                                                    AIが写真を見て間違った量だよ！低い程凄い！
                                                </>
                                            }>
                                                <div className="overflow-x-auto">
                                                    <LineChart
                                                        epochs={epochs}
                                                        yMin={0}
                                                        yMax={Math.max(0.1, ...curvePoints.flatMap((p) => [p.loss, p.val_loss])) * 1.1}
                                                        yFormat={(v) => v.toFixed(2)}
                                                        series={[
                                                            { label: '学習', color: '#dc2626', values: curvePoints.map((p) => p.loss) },
                                                            { label: '検証', color: '#fca5a5', dashed: true, values: curvePoints.map((p) => p.val_loss) },
                                                        ]}
                                                    />
                                                </div>
                                                <Legend items={[{ label: '学習', color: '#dc2626' }, { label: '検証', color: '#fca5a5', dashed: true }]} />
                                            </ChartCard>
                                        </div>
                                    </div>
                                )
                            )}

                            {tab === 'accuracy' && (
                                accuracyEntries.length === 0 ? (
                                    <EmptyState text="テスト結果データがありません" />
                                ) : (
                                    <div className="space-y-3">
                                        {accuracyEntries.map(([name, acc], i) => (
                                            <div key={name} className="flex items-center gap-3">
                                                <div className="w-40 text-sm font-bold text-gray-700 truncate" title={name}>
                                                    {i === 0 && '🏆 '}{name}
                                                </div>
                                                <div className="flex-1 h-6 bg-gray-100 rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full rounded-full"
                                                        style={{
                                                            width: `${Math.max(4, Math.min(100, acc * 100))}%`,
                                                            backgroundColor: MODEL_COLORS[i % MODEL_COLORS.length],
                                                        }}
                                                    />
                                                </div>
                                                <div className="w-16 text-right text-sm font-black text-gray-700">
                                                    {(acc * 100).toFixed(1)}%
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )
                            )}

                            {tab === 'images' && (
                                imageModelNames.length === 0 ? (
                                    <EmptyState text="画像ごとのテスト結果データがありません" />
                                ) : (
                                    <div className="space-y-4">
                                        <ModelTabs names={imageModelNames} selected={selectedImageModel} onSelect={setSelectedImageModel} />

                                        <div className="flex items-center justify-between flex-wrap gap-2">
                                            <div className="text-xs font-bold text-gray-500">
                                                正解 {correctCount} / {imageEntries.length} 枚
                                                （{imageEntries.length > 0 ? ((correctCount / imageEntries.length) * 100).toFixed(1) : '0'}%）
                                            </div>
                                            <div className="flex gap-1.5">
                                                {([
                                                    { key: 'all', label: 'すべて' },
                                                    { key: 'correct', label: '正解のみ' },
                                                    { key: 'incorrect', label: '不正解のみ' },
                                                ] as { key: ImageFilter; label: string }[]).map((f) => (
                                                    <button
                                                        key={f.key}
                                                        onClick={() => setImageFilter(f.key)}
                                                        className={`px-3 py-1 rounded-full text-[11px] font-bold transition-all ${
                                                            imageFilter === f.key
                                                                ? 'bg-purple-600 text-white'
                                                                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                                        }`}
                                                    >
                                                        {f.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        <VirtualizedResultTable entries={filteredImageEntries} labelNameById={labelNameById} />
                                    </div>
                                )
                            )}

                            {tab === 'evaluation' && (
                                !imageEvaluation || imageEvaluation.categories.length === 0 ? (
                                    <EmptyState text="画像の評価データがありません" />
                                ) : (
                                    <div className="space-y-6">
                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                            <StatBox label="彩度" value={imageEvaluation.overall_average.saturation} />
                                            <StatBox label="明るさ" value={imageEvaluation.overall_average.brightness} />
                                            <StatBox label="鮮明度" value={imageEvaluation.overall_average.sharpness} />
                                            <StatBox label="画像枚数" value={imageEvaluation.overall_average.photograph_count} isCount />
                                        </div>

                                        <ChartCard title="ドメイン多様性（ラベルごとに色分け）">
                                            <div className="overflow-x-auto">
                                                <ScatterChart
                                                    groups={imageEvaluation.categories.map((c, i) => ({
                                                        label: c.title,
                                                        color: MODEL_COLORS[i % MODEL_COLORS.length],
                                                        points: c.photographs.map((p) => ({
                                                            x: p.diversity_vector?.[0] ?? 0,
                                                            y: p.diversity_vector?.[1] ?? 0,
                                                        })),
                                                    }))}
                                                />
                                            </div>
                                            <Legend
                                                items={imageEvaluation.categories.map((c, i) => ({
                                                    label: c.title,
                                                    color: MODEL_COLORS[i % MODEL_COLORS.length],
                                                }))}
                                            />
                                        </ChartCard>

                                        <ChartCard title="画像の鮮明度（ラベルごと）">
                                            <div className="space-y-5">
                                                {imageEvaluation.categories.map((c, i) => (
                                                    <div key={c.category_id}>
                                                        <div className="flex items-center gap-2 mb-2">
                                                            <span
                                                                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                                                style={{ backgroundColor: MODEL_COLORS[i % MODEL_COLORS.length] }}
                                                            />
                                                            <span className="text-xs font-black text-gray-600">{c.title}</span>
                                                            <span className="text-[11px] text-gray-400">
                                                                平均鮮明度 {c.average_sharpness.toFixed(2)}
                                                            </span>
                                                        </div>
                                                        <VirtualizedPhotoGrid
                                                            items={c.photographs.map((p) => ({
                                                                id: p.photograph_path,
                                                                url: p.photograph_path.startsWith('http')
                                                                    ? p.photograph_path
                                                                    : `${API_URL.replace(/\/$/, '')}/${p.photograph_path.replace(/^\//, '')}`,
                                                                alt: c.title,
                                                                caption: p.sharpness.toFixed(2),
                                                            }))}
                                                            columns={{ base: 4, sm: 6 }}
                                                            gap={12}
                                                            captionHeight={20}
                                                            fallbackImageUrl="https://placehold.co/80?text=No+Image"
                                                            emptyMessage="画像がありません"
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        </ChartCard>
                                    </div>
                                )
                            )}
                        </>
                    )}
                </div>

                {/* フッター */}
                <div className="px-6 py-4 border-t border-gray-100 flex justify-end bg-gray-50/30 flex-shrink-0">
                    <button onClick={onClose} className="px-5 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm font-bold rounded-xl transition-colors">
                        閉じる
                    </button>
                </div>
            </div>
        </div>
    );
}

// --- 補助コンポーネント群（このモーダル専用の小さな部品） ---

function ModelTabs({ names, selected, onSelect }: { names: string[]; selected: string; onSelect: (name: string) => void }) {
    return (
        <div className="flex flex-wrap gap-2">
            {names.map((name) => (
                <button
                    key={name}
                    onClick={() => onSelect(name)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                        selected === name ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                >
                    {name}
                </button>
            ))}
        </div>
    );
}

function ChartCard({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
    return (
        <div className="border border-gray-100 rounded-2xl p-4 bg-white shadow-sm">
            <h4 className="text-xs font-black text-gray-500 mb-2">{title}</h4>
            {children}
        </div>
    );
}

function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
    return (
        <div className="flex gap-4 mt-2">
            {items.map((item) => (
                <div key={item.label} className="flex items-center gap-1.5 text-[11px] font-bold text-gray-500">
                    <span
                        className="w-4 h-0.5 rounded-full"
                        style={
                            item.dashed
                                ? { backgroundImage: `repeating-linear-gradient(90deg, ${item.color} 0 3px, transparent 3px 6px)` }
                                : { backgroundColor: item.color }
                        }
                    />
                    {item.label}
                </div>
            ))}
        </div>
    );
}

function StatBox({ label, value, isCount }: { label: string; value: number; isCount?: boolean }) {
    return (
        <div className="border border-gray-100 rounded-2xl p-3 bg-white shadow-sm text-center">
            <div className="text-[11px] font-bold text-gray-400">{label}</div>
            <div className="text-lg font-black text-gray-700">{isCount ? value : value.toFixed(2)}</div>
        </div>
    );
}

// --- テスト結果一覧(画像タブ)の仮想スクロールテーブル ---
// react-window は行を position:absolute な div として描画するため、
// ネイティブの <table>/<tbody> ではなくヘッダー行(固定)+ボディ(仮想化されたflex行)の構成にしている。

const RESULT_ROW_HEIGHT = 56;
const RESULT_MAX_VISIBLE_ROWS = 8;

interface ResultRowData {
    entries: TestImageResultEntry[];
    labelNameById: Record<number, string>;
}

function ResultTableHeader() {
    return (
        <div className="flex items-center gap-4 px-4 py-2 bg-gray-50 text-gray-400 text-xs font-bold border-b border-gray-100">
            <div className="w-10 flex-shrink-0">画像</div>
            <div className="flex-1 min-w-0">予測ラベル</div>
            <div className="flex-1 min-w-0">正解ラベル</div>
            <div className="w-16 flex-shrink-0">確信度</div>
            <div className="w-16 flex-shrink-0">結果</div>
        </div>
    );
}

const ResultRow = React.memo(function ResultRow({ index, style, data }: ListChildComponentProps<ResultRowData>) {
    const { entries, labelNameById } = data;
    const entry = entries[index];
    if (!entry) return null;

    const imageUrl = entry.image_url
        ? (entry.image_url.startsWith('http')
            ? entry.image_url
            : `${API_URL.replace(/\/$/, '')}/${entry.image_url.replace(/^\//, '')}`)
        : '';
    const predictedLabelName = labelNameById[entry.predicted_label_id] || `ID:${entry.predicted_label_id}`;

    return (
        <div style={style} className="flex items-center gap-4 px-4 border-t border-gray-50 text-sm">
            <div className="w-10 flex-shrink-0">
                {imageUrl ? (
                    <img
                        src={imageUrl}
                        alt={predictedLabelName}
                        loading="lazy"
                        className="w-10 h-10 object-cover rounded-lg border border-gray-100"
                        onError={(e) => {
                            (e.target as HTMLImageElement).src = 'https://placehold.co/80?text=No+Image';
                        }}
                    />
                ) : (
                    <span className="text-gray-300 text-xs">-</span>
                )}
            </div>
            <div className="flex-1 min-w-0 text-gray-600 font-bold truncate">{predictedLabelName}</div>
            <div className="flex-1 min-w-0 text-gray-600 truncate">{entry.correct_label_name}</div>
            <div className="w-16 flex-shrink-0 text-gray-600">{(entry.confidence * 100).toFixed(1)}%</div>
            <div className="w-16 flex-shrink-0">
                {entry.is_correct ? (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 text-[11px] font-black">✓ 正解</span>
                ) : (
                    <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-500 text-[11px] font-black">✗ 不正解</span>
                )}
            </div>
        </div>
    );
});

function VirtualizedResultTable({
    entries,
    labelNameById,
}: {
    entries: TestImageResultEntry[];
    labelNameById: Record<number, string>;
}) {
    if (entries.length === 0) {
        return (
            <div className="border border-gray-100 rounded-2xl overflow-hidden">
                <ResultTableHeader />
                <div className="py-8 text-center text-xs text-gray-400 italic">該当する画像がありません</div>
            </div>
        );
    }

    const itemData: ResultRowData = { entries, labelNameById };
    const height = Math.min(entries.length, RESULT_MAX_VISIBLE_ROWS) * RESULT_ROW_HEIGHT;

    return (
        <div className="border border-gray-100 rounded-2xl overflow-hidden">
            <ResultTableHeader />
            <FixedSizeList
                height={height}
                itemCount={entries.length}
                itemSize={RESULT_ROW_HEIGHT}
                width="100%"
                itemData={itemData}
            >
                {ResultRow}
            </FixedSizeList>
        </div>
    );
}

function EmptyState({ text }: { text: string }) {
    return (
        <div className="text-center py-20 text-sm font-bold text-gray-400 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
            {text}
        </div>
    );
}

// 依存ライブラリなしの軽量な折れ線グラフ（学習曲線用）
function LineChart({ epochs, series, yMin, yMax, yFormat, height = 180 }: {
    epochs: number[];
    series: { label: string; color: string; dashed?: boolean; values: number[] }[];
    yMin: number;
    yMax: number;
    yFormat?: (v: number) => string;
    height?: number;
}) {
    const width = Math.max(280, epochs.length * 50);
    const padLeft = 38;
    const padRight = 10;
    const padTop = 10;
    const padBottom = 22;
    const innerW = width - padLeft - padRight;
    const innerH = height - padTop - padBottom;

    const xFor = (i: number) => padLeft + (epochs.length <= 1 ? innerW / 2 : (innerW * i) / (epochs.length - 1));
    const yFor = (v: number) => {
        const ratio = (v - yMin) / ((yMax - yMin) || 1);
        return padTop + innerH - ratio * innerH;
    };

    return (
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ minWidth: width }} className="block">
            {[0, 0.25, 0.5, 0.75, 1].map((t) => {
                const v = yMin + (yMax - yMin) * t;
                const y = yFor(v);
                return (
                    <g key={t}>
                        <line x1={padLeft} x2={width - padRight} y1={y} y2={y} stroke="#f1f5f9" strokeWidth={1} />
                        <text x={padLeft - 5} y={y + 3} fontSize={9} textAnchor="end" fill="#94a3b8">
                            {yFormat ? yFormat(v) : v.toFixed(2)}
                        </text>
                    </g>
                );
            })}
            {epochs.map((e, i) => (
                <text key={e} x={xFor(i)} y={height - 5} fontSize={9} textAnchor="middle" fill="#94a3b8">
                    {e}
                </text>
            ))}
            {series.map((s) => (
                <g key={s.label}>
                    <path
                        d={s.values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(v)}`).join(' ')}
                        fill="none"
                        stroke={s.color}
                        strokeWidth={2}
                        strokeDasharray={s.dashed ? '4 3' : undefined}
                    />
                    {s.values.map((v, i) => (
                        <circle key={i} cx={xFor(i)} cy={yFor(v)} r={2.5} fill={s.color} />
                    ))}
                </g>
            ))}
        </svg>
    );
}

// 依存ライブラリなしの軽量な散布図（ドメイン多様性の可視化用）
function ScatterChart({ groups, height = 220 }: {
    groups: { label: string; color: string; points: { x: number; y: number }[] }[];
    height?: number;
}) {
    const width = 420;
    const padLeft = 34;
    const padRight = 14;
    const padTop = 10;
    const padBottom = 22;
    const innerW = width - padLeft - padRight;
    const innerH = height - padTop - padBottom;

    const allPoints = groups.flatMap((g) => g.points);
    const xs = allPoints.map((p) => p.x);
    const ys = allPoints.map((p) => p.y);
    const xMin = xs.length ? Math.min(...xs) : 0;
    const xMax = xs.length ? Math.max(...xs) : 1;
    const yMin = ys.length ? Math.min(...ys) : 0;
    const yMax = ys.length ? Math.max(...ys) : 1;
    const xSpan = (xMax - xMin) || 1;
    const ySpan = (yMax - yMin) || 1;

    const xFor = (v: number) => padLeft + ((v - xMin) / xSpan) * innerW;
    const yFor = (v: number) => padTop + innerH - ((v - yMin) / ySpan) * innerH;

    return (
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ minWidth: 260 }} className="block">
            <line x1={padLeft} x2={width - padRight} y1={padTop + innerH} y2={padTop + innerH} stroke="#e2e8f0" strokeWidth={1} />
            <line x1={padLeft} x2={padLeft} y1={padTop} y2={padTop + innerH} stroke="#e2e8f0" strokeWidth={1} />
            <text x={padLeft - 5} y={padTop + innerH + 3} fontSize={9} textAnchor="end" fill="#94a3b8">
                {yMin.toFixed(1)}
            </text>
            <text x={padLeft - 5} y={padTop + 4} fontSize={9} textAnchor="end" fill="#94a3b8">
                {yMax.toFixed(1)}
            </text>
            <text x={padLeft} y={height - 6} fontSize={9} textAnchor="start" fill="#94a3b8">
                {xMin.toFixed(1)}
            </text>
            <text x={width - padRight} y={height - 6} fontSize={9} textAnchor="end" fill="#94a3b8">
                {xMax.toFixed(1)}
            </text>
            {groups.map((g) => (
                <g key={g.label}>
                    {g.points.map((p, i) => (
                        <circle
                            key={i}
                            cx={xFor(p.x)}
                            cy={yFor(p.y)}
                            r={4}
                            fill={g.color}
                            fillOpacity={0.75}
                            stroke="white"
                            strokeWidth={0.75}
                        />
                    ))}
                </g>
            ))}
        </svg>
    );
}
