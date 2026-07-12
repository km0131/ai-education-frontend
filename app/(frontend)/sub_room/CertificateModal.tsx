'use client';

import Cookies from 'js-cookie';
import { API_URL } from '@/src/lib/api';
import { unwrapJson } from '@/src/lib/unwrap-json';
import React, { useEffect, useState, useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Tooltip,
    Legend,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

// --- 型定義 ---
type TrainingCurveData = Record<string, { epoch: number; accuracy: number }[]>;
type TestResultsData = Record<string, number>;

interface CertPhoto {
    id: string | number;
    url: string;
}
interface CertCategory {
    id: string | number;
    title: string;
    photos: CertPhoto[];
    avgSaturation?: number;
    avgBrightness?: number;
    avgSharpness?: number;
}

interface EvalCategoryAvg {
    category_index: number;
    average_saturation: number;
    average_brightness: number;
    average_sharpness: number;
}
type CategoryAvgMap = Map<number, { saturation: number; brightness: number; sharpness: number }>;

// /api/v1/result/image_evaluation_get のレスポンスから
// カテゴリindex -> ラベル平均値(彩度・明るさ・鮮明度) の対応表を作る
function buildCategoryAvgMap(raw: unknown): CategoryAvgMap {
    const map: CategoryAvgMap = new Map();
    if (!raw || typeof raw !== 'object') return map;
    const categories = (raw as { categories?: EvalCategoryAvg[] }).categories;
    if (!Array.isArray(categories)) return map;

    categories.forEach((c) => {
        if (c && typeof c.category_index === 'number') {
            map.set(c.category_index, {
                saturation: c.average_saturation,
                brightness: c.average_brightness,
                sharpness: c.average_sharpness,
            });
        }
    });
    return map;
}

interface CertificateModalProps {
    isOpen: boolean;
    onClose: () => void;
    projectUuid: string;
    classId: string;
    studentName: string;
    projectTitle: string;
    courseName: string;
    updatedAt?: string;
}

interface RawCategory {
    category_index?: string | number;
    title?: string;
    photos?: { id: number; path: string }[];
}

// /api/v1/ai/image_acquisition のレスポンス（ImageEditModal と同じ形）を
// 証明書用の categories（カテゴリごとの画像URL一覧）に変換する
function buildCertCategories(raw: unknown, evalByIndex?: CategoryAvgMap): CertCategory[] {
    if (!raw || typeof raw !== 'object') return [];
    const actualData = 'data' in (raw as Record<string, unknown>)
        ? (raw as Record<string, unknown>).data
        : raw;
    if (!actualData || typeof actualData !== 'object') return [];

    return Object.entries(actualData as Record<string, RawCategory>)
        .filter(([key, category]) => key !== 'data' && category && typeof category === 'object')
        .map(([key, category]) => {
            const photosList = category.photos || [];
            const categoryIndex = Number(category.category_index);
            const avg = evalByIndex?.get(categoryIndex);
            return {
                id: category.category_index ?? key,
                title: category.title || key,
                photos: photosList
                    .filter((p) => p && p.path)
                    .map((p) => ({
                        id: p.id,
                        url: p.path.startsWith('http')
                            ? p.path
                            : `${API_URL.replace(/\/$/, '')}/${p.path.replace(/^\//, '')}`,
                    })),
                avgSaturation: avg?.saturation,
                avgBrightness: avg?.brightness,
                avgSharpness: avg?.sharpness,
            };
        });
}

// 印刷時に画像が読み込み途中で欠けることがないよう、
// レポートを表示する前にすべてのサムネイル画像をブラウザにキャッシュさせておく
function preloadImages(categories: CertCategory[]): Promise<void> {
    const urls = categories.flatMap((c) => c.photos.slice(0, 16).map((p) => p.url));
    if (urls.length === 0) return Promise.resolve();

    return Promise.all(
        urls.map(
            (url) =>
                new Promise<void>((resolve) => {
                    const img = new window.Image();
                    img.onload = () => resolve();
                    img.onerror = () => resolve();
                    img.src = url;
                })
        )
    ).then(() => undefined);
}

function formatJaDate(iso?: string): string {
    const d = iso ? new Date(iso) : new Date();
    const target = isNaN(d.getTime()) ? new Date() : d;
    return `${target.getFullYear()}年${target.getMonth() + 1}月${target.getDate()}日`;
}

export function CertificateModal({
                                     isOpen,
                                     onClose,
                                     projectUuid,
                                     classId,
                                     studentName,
                                     projectTitle,
                                     courseName,
                                     updatedAt,
                                 }: CertificateModalProps) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [trainingCurve, setTrainingCurve] = useState<TrainingCurveData>({});
    const [accuracySummary, setAccuracySummary] = useState(0);
    const [bestModelName, setBestModelName] = useState('-');
    const [hasTestResults, setHasTestResults] = useState(false);
    const [categories, setCategories] = useState<CertCategory[]>([]);

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
                const resultBody = JSON.stringify({ project_id: projectUuid });
                const imageBody = JSON.stringify({ project_id: projectUuid });
                const evalBody = JSON.stringify({ project_uuid: projectUuid });

                const [curveRes, resultsRes, imagesRes, evalRes] = await Promise.all([
                    fetch(`${API_URL}/api/v1/result/training_curve`, { method: 'POST', headers, body: resultBody }),
                    fetch(`${API_URL}/api/v1/result/test_results`, { method: 'POST', headers, body: resultBody }),
                    fetch(`${API_URL}/api/v1/ai/image_acquisition`, { method: 'POST', headers, body: imageBody }),
                    fetch(`${API_URL}/api/v1/result/image_evaluation_get`, { method: 'POST', headers, body: evalBody }),
                ]);

                if (!curveRes.ok || !resultsRes.ok) {
                    throw new Error('証明書データの取得に失敗しました');
                }

                const curveRaw = await curveRes.json().catch(() => ({}));
                const resultsRaw = await resultsRes.json().catch(() => ({}));
                const imagesRaw = imagesRes.ok ? await imagesRes.json().catch(() => ({})) : {};
                const evalRaw = evalRes.ok ? await evalRes.json().catch(() => null) : null;

                const curveData = unwrapJson<TrainingCurveData>(curveRaw);
                const resultsData = unwrapJson<TestResultsData>(resultsRaw);
                const numericEntries = Object.entries(resultsData)
                    .filter((e): e is [string, number] => typeof e[1] === 'number');

                if (numericEntries.length > 0) {
                    const best = numericEntries.reduce((a, b) => (b[1] > a[1] ? b : a));
                    setBestModelName(best[0]);
                    setAccuracySummary(Math.round(best[1] * 100));
                    setHasTestResults(true);
                } else {
                    setBestModelName('-');
                    setAccuracySummary(0);
                    setHasTestResults(false);
                }

                const evalByIndex = buildCategoryAvgMap(evalRaw);
                const certCategories = buildCertCategories(imagesRaw, evalByIndex);
                await preloadImages(certCategories);

                setTrainingCurve(curveData || {});
                setCategories(certCategories);
            } catch (err) {
                console.error('[Error] 証明書データ取得失敗:', err);
                setError(err instanceof Error ? err.message : '証明書データの取得に失敗しました');
            } finally {
                setLoading(false);
            }
        };

        fetchAll();
    }, [isOpen, projectUuid]);

    useEffect(() => {
        if (isOpen) return;
        setTrainingCurve({});
        setAccuracySummary(0);
        setBestModelName('-');
        setHasTestResults(false);
        setCategories([]);
        setError(null);
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div className="cert-modal-overlay fixed inset-0 z-[100] overflow-y-auto bg-black/50 backdrop-blur-sm">
            <button
                onClick={onClose}
                className="no-print fixed top-4 right-4 z-[110] bg-white/90 hover:bg-white text-gray-600 hover:text-gray-900 rounded-full w-10 h-10 flex items-center justify-center shadow-lg text-xl font-bold"
                title="閉じる"
            >
                ✕
            </button>

            {loading ? (
                <div className="min-h-screen flex items-center justify-center text-white font-bold animate-pulse">
                    証明書データを読み込み中...
                </div>
            ) : error ? (
                <div className="min-h-screen flex items-center justify-center text-white font-bold">
                    {error}
                </div>
            ) : (
                <CertificateReport
                    studentName={studentName || '無名の生徒'}
                    courseName={courseName || '無題のクラス'}
                    completionDate={formatJaDate(updatedAt)}
                    issuerName={courseName || '無題のクラス'}
                    certificateNo={`${classId}-${projectUuid.slice(0, 8).toUpperCase()}`}
                    accuracySummary={accuracySummary}
                    bestModelName={bestModelName}
                    hasTestResults={hasTestResults}
                    projectTitle={projectTitle}
                    trainingCurve={trainingCurve}
                    categories={categories}
                />
            )}
        </div>
    );
}

/**
 * ============================================================
 * CertificateReport
 * ============================================================
 * 3枚組の印刷用レポート（A4横 x 3ページ）
 *   1枚目: 修了証（表紙）
 *   2枚目: AI学習結果レポート（学習曲線グラフ + 最終精度）
 *   3枚目: あつめた学習画像一覧（カテゴリごとのサムネイル）
 * ============================================================
 */

const MODEL_COLORS = ['#c9a339', '#1f9c86', '#7f8fd6'];

// 印鑑画像の読み込み場所。用意した印影画像をこのパスに配置してください（例: public/certificate/hanko.png）。
const HANKO_IMAGE_URL = '/hanko.png';

// 表紙(1枚目)の背景に敷く額縁画像の読み込み場所。用意した frame.png をこのパスに配置してください
// （例: public/certificate/frame.png）。同梱の cert-frame.png がその画像です。
const FRAME_IMAGE_URL = '/waku.png';

// 表紙(1枚目)のタイトルと発行元。今は直書きで固定。
const COVER_TITLE_TEXT = '修了書';
const COVER_ISSUER_TEXT = '九州情報大学　荒平ゼミ';



function buildChartData(trainingCurve: TrainingCurveData) {
    const modelNames = Object.keys(trainingCurve || {});
    if (modelNames.length === 0) return null;

    const labelSet = new Set<number>();
    modelNames.forEach((name) => {
        (trainingCurve[name] || []).forEach((p) => labelSet.add(p.epoch));
    });
    const labels = Array.from(labelSet).sort((a, b) => a - b);

    const datasets = modelNames.map((name, i) => {
        const points = trainingCurve[name] || [];
        const byEpoch = new Map(points.map((p) => [p.epoch, p.accuracy]));
        return {
            label: name,
            data: labels.map((ep) => (byEpoch.has(ep) ? (byEpoch.get(ep) as number) * 100 : null)),
            borderColor: MODEL_COLORS[i % MODEL_COLORS.length],
            backgroundColor: MODEL_COLORS[i % MODEL_COLORS.length],
            borderWidth: 2.5,
            pointRadius: 3,
            pointBackgroundColor: '#f5efdd',
            pointBorderWidth: 2,
            tension: 0.25,
            spanGaps: true,
        };
    });

    return { labels, datasets };
}

const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    plugins: {
        legend: {
            position: 'bottom' as const,
            labels: {
                font: { family: "'JetBrains Mono', monospace", size: 11 },
                color: '#1c2947',
                usePointStyle: true,
                boxWidth: 8,
            },
        },
        title: { display: false },
        tooltip: { enabled: false },
    },
    scales: {
        x: {
            title: { display: true, text: 'epoch', color: '#7a8399', font: { size: 11 } },
            grid: { color: 'rgba(28,41,71,0.06)' },
            ticks: { color: '#7a8399', font: { size: 10 } },
        },
        y: {
            min: 0,
            max: 100,
            title: { display: true, text: 'accuracy (%)', color: '#7a8399', font: { size: 11 } },
            grid: { color: 'rgba(28,41,71,0.06)' },
            ticks: { color: '#7a8399', font: { size: 10 } },
        },
    },
};

interface CertificateReportProps {
    studentName: string;
    courseName: string;
    completionDate: string;
    issuerName: string;
    certificateNo: string;
    accuracySummary: number;
    bestModelName: string;
    hasTestResults: boolean;
    projectTitle: string;
    trainingCurve: TrainingCurveData;
    categories: CertCategory[];
    onPrint?: () => void;
}

function CertificateReport({
                               studentName,
                               courseName,
                               completionDate,
                               issuerName,
                               certificateNo,
                               accuracySummary,
                               bestModelName,
                               hasTestResults,
                               projectTitle,
                               trainingCurve,
                               categories = [],
                               onPrint,
                           }: CertificateReportProps) {
    const chartData = useMemo(() => buildChartData(trainingCurve), [trainingCurve]);

    return (
        <div className="cert-report-root">
            <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap');

        .cert-report-root {
          --navy: #1c2947;
          --navy-deep: #0d1526;
          --paper: #f5efdd;
          --paper-panel: #fbf8ef;
          --gold: #b8892b;
          --gold-bright: #d9a53f;
          --gold-soft: #e6c988;
          --teal: #1f9c86;
          --ink: #1c2130;
          --ink-soft: #6b7286;
          --line: rgba(28,41,71,0.18);
          font-family: 'Plus Jakarta Sans', sans-serif;
          color: var(--ink);
          background: #d9d3c0;
        }

        .cert-toolbar {
          display: flex;
          justify-content: center;
          padding: 20px;
        }
        .cert-toolbar button {
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
          letter-spacing: 0.05em;
          padding: 10px 26px;
          border-radius: 999px;
          border: 1px solid rgba(217,165,63,0.5);
          background: var(--navy-deep);
          color: var(--gold-bright);
          cursor: pointer;
        }

        .print-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 28px;
          padding: 24px;
        }

        .page-sheet {
          position: relative;
          width: 297mm;
          max-width: 100%;
          aspect-ratio: 297 / 210;
          background: var(--paper);
          box-shadow: 0 28px 60px -22px rgba(13,21,38,0.45);
          padding: 16mm 18mm;
          box-sizing: border-box;
          overflow: hidden;
        }

        /* 二重罫線 + 四隅の角飾りによる、より端正な額縁 */
        .page-frame { position: absolute; inset: 8mm; border: 1px solid var(--line); pointer-events: none; }
        .page-frame::before { content: ""; position: absolute; inset: 4px; border: 1px solid rgba(28,41,71,0.08); }
        .corner {
          position: absolute;
          width: 22px;
          height: 22px;
          border: 2px solid var(--gold);
        }
        .corner.tl { top: 8mm; left: 8mm; border-right: none; border-bottom: none; }
        .corner.tr { top: 8mm; right: 8mm; border-left: none; border-bottom: none; }
        .corner.bl { bottom: 8mm; left: 8mm; border-right: none; border-top: none; }
        .corner.br { bottom: 8mm; right: 8mm; border-left: none; border-top: none; }

        .cover-logo {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 130px;
          height: 130px;
          background-image: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAMAAABF0y+mAAAAJFBMVEVHcEw/cq8/cq8/cq8/cq8/cq8/cq8/cq8/cq8/cq8/cq8/cq8ZyLl0AAAAC3RSTlMAJg0bUfdBaTKX1tsSR1IAAACKSURBVCiRzdBLEsQgCARQPhJNuP99hx4qGjUHCJtevEIQos8WuyLE25s5VCI2hbmz/KPtdrqxIRaFFSqwSsesaSSwmDvpbRH18lmfVnLnri1NYURQTj1Go1rHZ6uOdQpM0jiHdr3qZkPDbLVb403Tuloq7hY3OldLjXnYarNUyZ03w0cFIfZiX6kfcFEIXSUwBQgAAAAASUVORK5CYII=');
          background-repeat: no-repeat;
          background-position: center;
          background-size: contain;
          opacity: 0.3;
          filter: sepia(1) saturate(4) hue-rotate(-12deg) brightness(0.85);
          mix-blend-mode: multiply;
          pointer-events: none;
        }

        .eyebrow {
          display: flex;
          align-items: center;
          gap: 10px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11.5px;
          letter-spacing: 0.3em;
          text-transform: uppercase;
          color: var(--teal);
          font-weight: 700;
        }
        .eyebrow .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--teal); box-shadow: 0 0 0 4px rgba(31,156,134,0.14); }
        .eyebrow .rule { flex: 1; height: 1px; background: linear-gradient(to right, var(--line), transparent); }

        /* ---------- ページ1: 表紙（縦書き証書スタイル） ---------- */
        .cover-sheet {
          background-color: #f3e8ca;
          background-image: url('${FRAME_IMAGE_URL}');
          background-repeat: no-repeat;
          background-position: center;
          background-size: 100% 100%;
        }

        .cover-content {
          position: relative;
          height: 100%;
          box-sizing: border-box;
          padding: 46mm 26mm 26mm;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          color: var(--ink);
        }
        .cover-title {
          font-family: 'Fraunces', serif;
          font-weight: 700;
          font-size: 30px;
          line-height: 1.4;
          letter-spacing: 0.03em;
          color: var(--navy-deep);
        }
        .cover-name {
          font-family: 'Fraunces', serif;
          font-weight: 600;
          font-size: 23px;
          color: var(--navy-deep);
          margin-top: 14px;
        }
        .cover-desc {
          margin-top: 16px;
          max-width: 480px;
          font-size: 17.5px;
          line-height: 1.95;
          letter-spacing: 0.01em;
          color: var(--ink);
        }
        .cover-bottomright {
          position: absolute;
          bottom: 32mm;
          right: 34mm;
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .cover-bottomright .date-issuer { text-align: right; }
        .cover-bottomright .date-text {
          display: block;
          font-family: 'Fraunces', serif;
          font-weight: 700;
          font-size: 24px;
          color: var(--navy-deep);
        }
        .cover-bottomright .issuer-text {
          display: block;
          font-family: 'JetBrains Mono', monospace;
          font-size: 14px;
          letter-spacing: 0.02em;
          color: var(--ink-soft);
          margin-top: 4px;
        }
        .cover-certno {
          position: absolute;
          bottom: 3mm;
          left: 8mm;
          font-family: 'JetBrains Mono', monospace;
          font-size: 8px;
          letter-spacing: 0.05em;
          color: var(--ink-soft);
          opacity: 0.55;
        }
        .hanko-img {
          display: block;
          width: 66px;
          height: 66px;
          object-fit: contain;
          mix-blend-mode: multiply;
        }

        /* ---------- ページ2: データ検証 ---------- */
        .report-inner { position: relative; height: 100%; display: flex; flex-direction: column; }
        .report-inner h2 {
          font-family: 'Fraunces', serif;
          font-weight: 600;
          font-size: 24px;
          color: var(--navy-deep);
          margin: 16px 0 18px;
        }
        .report-body { flex: 1; min-height: 0; display: flex; gap: 20px; }
        .stat-panel {
          width: 200px;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .stat-card {
          background: var(--navy-deep);
          border-radius: 10px;
          padding: 16px 18px;
          box-shadow: inset 0 0 0 1px rgba(217,165,63,0.3);
        }
        .stat-card .stat-label {
          font-family: 'JetBrains Mono', monospace;
          font-size: 10.5px;
          letter-spacing: 0.12em;
          color: var(--gold-soft);
          text-transform: uppercase;
        }
        .stat-card .stat-value {
          font-family: 'JetBrains Mono', monospace;
          font-size: 34px;
          font-weight: 700;
          color: var(--gold-bright);
          margin-top: 6px;
        }
        .stat-note {
          font-family: 'JetBrains Mono', monospace;
          font-size: 11.5px;
          color: var(--ink-soft);
          background: var(--paper-panel);
          border: 1px solid var(--line);
          border-radius: 8px;
          padding: 12px 14px;
          line-height: 1.6;
        }
        .stat-note b { color: var(--teal); }
        .chart-card {
          flex: 1;
          min-width: 0;
          background: var(--paper-panel);
          border: 1px solid var(--line);
          border-radius: 10px;
          padding: 16px;
          box-sizing: border-box;
        }

        /* ---------- ページ3: 画像ギャラリー ---------- */
        .gallery-inner { position: relative; height: 100%; overflow: hidden; display: flex; flex-direction: column; }
        .gallery-inner h2 {
          font-family: 'Fraunces', serif;
          font-weight: 600;
          font-size: 22px;
          color: var(--navy-deep);
          margin: 16px 0 14px;
        }
        .category-block { margin-bottom: 14px; }
        .category-block h3 {
          font-family: 'JetBrains Mono', monospace;
          font-size: 12.5px;
          font-weight: 700;
          color: var(--navy);
          letter-spacing: 0.02em;
          margin: 0 0 6px;
        }
        .avg-label {
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          color: var(--ink-soft);
          margin: -4px 0 6px;
        }
        .image-grid {
          display: grid;
          grid-template-columns: repeat(8, 1fr);
          gap: 5px;
        }
        .thumb-img {
          width: 100%;
          aspect-ratio: 1 / 1;
          object-fit: cover;
          border-radius: 4px;
          border: 1px solid var(--line);
        }
        .more-text {
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'JetBrains Mono', monospace;
          font-size: 10.5px;
          color: var(--ink-soft);
          background: rgba(28,41,71,0.05);
          border-radius: 4px;
        }

        @media print {
          .no-print { display: none !important; }

          /* モーダルの外側（sub_room のヘッダーやカード一覧など）を印刷対象から除外し、
             証明書の中身だけを通常のドキュメントフローで印刷することで、
             固定配置 + overflow-y:auto による1ページ目だけの表示切れを防ぐ */
          body * { visibility: hidden; }
          .cert-modal-overlay, .cert-modal-overlay * { visibility: visible; }
          .cert-modal-overlay {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            height: auto !important;
            overflow: visible !important;
            background: none !important;
            backdrop-filter: none !important;
          }

          .cert-report-root { background: #fff; }
          .print-container { padding: 0; gap: 0; }
          @page { size: A4 landscape; margin: 0; }
          .page-sheet {
            width: 297mm;
            height: 210mm;
            aspect-ratio: auto;
            box-shadow: none;
            page-break-after: always;
            break-after: page;
          }
          .page-sheet:last-child { page-break-after: auto; break-after: auto; }
        }
      `}</style>

            <div className="cert-toolbar no-print">
                <button onClick={onPrint || (() => window.print())}>印刷 / PDFで保存する</button>
            </div>

            <div className="print-container">
                {/* ページ1: 修了証 */}
                <section className="page-sheet cover-sheet">
                    <div className="cover-logo" />
                    <div className="cover-content">
                        <div className="cover-title">{COVER_TITLE_TEXT}</div>
                        <div className="cover-name">{studentName} 殿</div>
                        <div className="cover-desc">
                            あなたは「AI×歴史教室」における研究課題において
                            自ら収集したデータを用いて極めて優秀なAIモデルを構築するとともに
                            大宰府天満宮の歴史と文化に関する深い知見を修得されました
                            その優れた探究心と熱心な学習の成果をたたえここにこれを賞します
                        </div>
                    </div>
                    <div className="cover-bottomright">
                        <div className="date-issuer">
                            <span className="date-text">{completionDate}</span>
                            <span className="issuer-text">{COVER_ISSUER_TEXT}</span>
                        </div>
                        <img src={HANKO_IMAGE_URL} alt="印影" className="hanko-img" />
                    </div>
                    <div className="cover-certno">CERT NO. {certificateNo}</div>
                </section>

                {/* ページ2: 学習結果レポート */}
                <section className="page-sheet">
                    <div className="page-frame" />
                    <span className="corner tl" />
                    <span className="corner tr" />
                    <span className="corner bl" />
                    <span className="corner br" />
                    <div className="report-inner">
                        <div className="eyebrow">
                            <span className="dot" />
                            DATA VERIFICATION
                            <span className="rule" />
                        </div>
                        <h2>AI学習結果レポート（データ検証）</h2>
                        <div className="report-body">
                            <div className="stat-panel">
                                {hasTestResults ? (
                                    <>
                                        <div className="stat-card">
                                            <div className="stat-label">最終精度</div>
                                            <div className="stat-value">{accuracySummary}%</div>
                                        </div>
                                        <div className="stat-note">
                                            best model: <b>{bestModelName}</b>
                                        </div>
                                    </>
                                ) : (
                                    <div className="stat-note">
                                        まだテスト結果がありません（先にAIの性能テストを実行してください）
                                    </div>
                                )}
                            </div>
                            <div className="chart-card">
                                {chartData ? (
                                    <Line data={chartData} options={chartOptions} />
                                ) : (
                                    <p style={{ color: 'var(--ink-soft)' }}>学習曲線データがありません。</p>
                                )}
                            </div>
                        </div>
                    </div>
                </section>

                {/* ページ3: 画像ギャラリー */}
                <section className="page-sheet">
                    <div className="page-frame" />
                    <span className="corner tl" />
                    <span className="corner tr" />
                    <span className="corner bl" />
                    <span className="corner br" />
                    <div className="gallery-inner">
                        <div className="eyebrow">
                            <span className="dot" />
                            TRAINING PHOTO RECORD
                            <span className="rule" />
                        </div>
                        <h2>集めた学習画像一覧（体験の記録）</h2>
                        {categories.map((cat) => (
                            <div key={cat.id} className="category-block">
                                <h3>{cat.title}（{cat.photos.length}枚）</h3>
                                {cat.avgSaturation !== undefined && (
                                    <div className="avg-label">
                                        平均 彩度 {cat.avgSaturation.toFixed(2)} ・ 明るさ {cat.avgBrightness?.toFixed(2)} ・ 鮮明度 {cat.avgSharpness?.toFixed(2)}
                                    </div>
                                )}
                                <div className="image-grid">
                                    {cat.photos.slice(0, 16).map((photo) => (
                                        <img src={photo.url} className="thumb-img" key={photo.id} alt={cat.title} />
                                    ))}
                                    {cat.photos.length > 16 && (
                                        <span className="more-text">ほか {cat.photos.length - 16} 枚</span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            </div>
        </div>
    );
}
