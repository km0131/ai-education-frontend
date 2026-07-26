'use client';

import React, { useState, useEffect, useRef } from 'react';
import Cookies from 'js-cookie';
import { API_URL } from '@/src/lib/api';
import VirtualizedPhotoGrid from '@/src/components/VirtualizedPhotoGrid';
import { uploadImageWithRetry } from '@/src/lib/uploadWithRetry';
import { buildUploadImageFiles, prefetchUploadImageFiles } from '@/src/lib/imageResize';
import { processSelectedFiles, isRawFile, isHeicFile, HeicConversionFailure } from '@/src/lib/heicConvert';
import { UploadStatusModal, UploadStatus } from '@/src/components/UploadStatusModal';

// ========================================================
// 型定義 (Types)
// ========================================================
interface TestImageInfo {
    id: number;
    image_url: string;
}
type TestImageMap = Record<string, Record<string, Record<string, TestImageInfo[]>>>;

interface TestUploadSet {
    correctLabelName: string;
    images: File[];
    previewUrls: string[];
    failedFiles: HeicConversionFailure[];
}

interface ManageTestModalProps {
    isOpen: boolean;
    onClose: () => void;
    classId: string;
    onSuccess: () => void;
}

interface TestImageViewSectionProps {
    classId: string;
    onSuccess: () => void;
}

type ViewMode = 'menu' | 'register' | 'view' | 'edit_labels';

// ========================================================
// 1. 子コンポーネント: TestImageViewSection (定義を上に配置)
// ========================================================
function TestImageViewSection({ classId, onSuccess }: TestImageViewSectionProps) {
    const [categoryMap, setCategoryMap] = useState<TestImageMap>({});
    const [loading, setLoading] = useState(false);
    const [batchId, setBatchId] = useState<string>('');

    useEffect(() => {
        if (classId) {
            setBatchId(crypto.randomUUID());
            fetchRegisteredImages();
        }
    }, [classId]);

    const fetchRegisteredImages = async () => {
        setLoading(true);
        try {
            const savedToken = Cookies.get('auth_token');
            const res = await fetch(`${API_URL}/api/v1/test/get_images`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${savedToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    course_id: Number(classId) // 👈 バックエンドの uint (数値) に合わせて送信
                }),
            });

            if (res.ok) {
                const resBody = await res.json();
                let actualData = resBody && resBody.img ? resBody.img : {};
                if (resBody && typeof resBody === 'object' && 'data' in resBody) {
                    actualData = resBody.data;
                }
                setCategoryMap(actualData || {});
            }
        } catch (err) {
            console.error('Failed to fetch test images:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteImage = async (photoId: number) => {
        if (!confirm('このテスト画像を削除してもよろしいですか？')) return;
        const savedToken = Cookies.get('auth_token');

        try {
            const res = await fetch(`${API_URL}/api/v1/test/delete_tsst_image`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${savedToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ photo_id: photoId }),
            });

            if (res.ok) {
                fetchRegisteredImages();
                onSuccess();
            } else {
                alert('画像の削除に失敗しました');
            }
        } catch (err) {
            alert('通信エラーが発生しました');
        }
    };

    const handleAddImageInView = async (correctLabelName: string,currentBatchId: string, e: React.ChangeEvent<HTMLInputElement>) => {
        const rawFile = e.target.files?.[0];
        e.target.value = '';
        if (!rawFile) return;

        const { files, failures } = await processSelectedFiles([rawFile]);
        if (files.length === 0) return; // .AAE/.MOV等の除外対象のみ送信をやめる
        if (failures.length > 0) {
            // ブラウザでの変換には失敗したが、元ファイルのまま送信してバックエンドのフォールバックに委ねる
            console.warn(`HEIC変換に失敗したため元ファイルのまま送信します: ${failures[0].name}(${failures[0].reason})`);
        }
        const file = files[0];

        const savedToken = Cookies.get('auth_token');
        const { original, resized } = await buildUploadImageFiles(file);
        const formData = new FormData();
        formData.append('course_id', classId);
        formData.append('correct_label_name', correctLabelName);
        formData.append('batch_id', currentBatchId);
        formData.append('file', original);
        if (resized) formData.append('resized_file', resized);

        try {
            const res = await fetch(`${API_URL}/api/v1/test/uploading_test_image`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${savedToken}` },
                body: formData,
            });

            if (res.ok) {
                fetchRegisteredImages();
                onSuccess();
            } else {
                const errorData = await res.json().catch(() => ({}));
                const prefix = errorData.filename ? `${errorData.filename}: ` : '';
                alert(`画像の追加に失敗しました: ${prefix}${errorData.error || 'エラー'}`);
            }
        } catch (err) {
            alert('通信エラーが発生しました');
        }
    };

    if (loading && Object.keys(categoryMap).length === 0) {
        return <div className="text-center py-12 text-sm text-gray-400 font-bold">データを読み込み中...</div>;
    }

    if (Object.keys(categoryMap).length === 0) {
        return <div className="text-center py-12 text-sm text-gray-400 font-bold bg-gray-50 rounded-2xl border border-dashed">登録済みのテスト画像データがありません</div>;
    }

    return (
        <div className="space-y-6">
            {Object.entries(categoryMap).map(([courseIdKey, batchesObj]) => {
                // 💡 現在開いているクラス(classId)のデータ以外はスキップ
                if (courseIdKey !== String(classId)) return null;
                if (!batchesObj || typeof batchesObj !== 'object') return null;

                // 第2階層: BatchID ごとのループ
                return Object.entries(batchesObj).map(([batchIdKey, labelsObj]) => {
                    if (!labelsObj || typeof labelsObj !== 'object') return null;

                    return (
                        <div key={batchIdKey} className="p-6 bg-gray-50/50 rounded-[2.5rem] border border-gray-200/60 space-y-4 mb-4">

                            {/* 第3階層: 正解ラベル名（牛、馬など）ごとのループ */}
                            {Object.entries(labelsObj).map(([labelName, photos]) => {
                                const photosList = photos || [];

                                return (
                                    <div key={`${batchIdKey}-${labelName}`} className="p-4 bg-orange-50/20 rounded-[1.5rem] border-2 border-orange-100/40 space-y-3">
                                        <div className="flex justify-between items-center border-b border-orange-100/50 pb-2">
                                            <div className="flex items-center gap-2">
                                                <span className="px-2.5 py-1 bg-orange-50 text-orange-700 text-xs font-black rounded-lg">正解ラベル</span>
                                                <h4 className="text-sm font-black text-gray-800">{labelName}</h4>
                                                <span className="text-xs text-gray-400 font-bold">({photosList.length}枚)</span>
                                            </div>

                                            {/* 1枚追加ボタン (ここでも必要であれば batchIdKey を利用可能) */}
                                            <label className="cursor-pointer px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-xs font-black rounded-xl transition-all flex items-center gap-1 shadow-sm active:scale-95">
                                                <span>📷 1枚追加</span>
                                                <input
                                                    type="file"
                                                    accept="image/*,.heic,.heif,.cr2,.cr3"
                                                    className="hidden"
                                                    onChange={(e) => handleAddImageInView(labelName, batchIdKey, e)}
                                                />
                                            </label>
                                        </div>

                                        {/* 画像グリッド表示エリア(仮想スクロール: grid-cols-3 sm:grid-cols-5 gap-3 相当) */}
                                        <VirtualizedPhotoGrid
                                            items={photosList
                                                .filter((photo) => photo && photo.image_url)
                                                .map((photo) => ({
                                                    id: photo.id,
                                                    url: photo.image_url.startsWith('http')
                                                        ? photo.image_url
                                                        : `${API_URL.replace(/\/$/, '')}/${photo.image_url.replace(/^\//, '')}`,
                                                    alt: labelName,
                                                }))}
                                            columns={{ base: 3, sm: 5 }}
                                            gap={12}
                                            onDelete={handleDeleteImage}
                                            emptyMessage="テスト画像が登録されていません。"
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    );
                });
            })}
        </div>
    );
}

// ========================================================
// 2. メインコンポーネント: ManageTestModal
// ========================================================
export function ManageTestModal({ isOpen, onClose, classId, onSuccess }: ManageTestModalProps) {
    const [mode, setMode] = useState<ViewMode>('menu');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [uploadSets, setUploadSets] = useState<TestUploadSet[]>([
        {correctLabelName: '', images: [], previewUrls: [], failedFiles: []}
    ]);
    const [labels, setLabels] = useState<string[]>([]);
    const [labelsLoading, setLabelsLoading] = useState(false);
    const [statusModal, setStatusModal] = useState<UploadStatus>(null);

    useEffect(() => {
        if (mode === 'edit_labels' && classId) {
            fetchTestLabels();
        }
    }, [mode, classId]);

    const fetchTestLabels = async () => {
        setLabelsLoading(true);
        try {
            const savedToken = Cookies.get('auth_token');
            const res = await fetch(`${API_URL}/api/v1/test/get_test_label`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${savedToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    course_id: Number(classId)
                }),
            });

            if (res.ok) {
                const data = await res.json();
                // { labels: [...] } か [...] のどちらでも受け取れるようにハンドリング
                setLabels(data.labels || data || []);
            } else {
                console.error('Failed to fetch test labels');
            }
        } catch (err) {
            console.error('Network error fetching test labels:', err);
        } finally {
            setLabelsLoading(false);
        }
    };

    const revokeAllPreviews = (sets: TestUploadSet[]) => {
        sets.forEach(set => set.previewUrls.forEach(url => URL.revokeObjectURL(url)));
    };

    // アンマウント時にも、その時点で残っているプレビューを必ず解放する(リーク防止の最終防衛線)
    const uploadSetsRef = useRef(uploadSets);
    uploadSetsRef.current = uploadSets;
    useEffect(() => {
        return () => revokeAllPreviews(uploadSetsRef.current);
    }, []);

    if (!isOpen) return null;

    const handleClose = () => {
        revokeAllPreviews(uploadSets);
        setUploadSets([{correctLabelName: '', images: [], previewUrls: [], failedFiles: []}]);
        setMode('menu');
        onClose();
    };

    const handleAddSet = () => setUploadSets(prev => [...prev, {correctLabelName: '', images: [], previewUrls: [], failedFiles: []}]);
    const handleRemoveSet = (index: number) => {
        if (uploadSets.length > 1) {
            uploadSets[index].previewUrls.forEach(url => URL.revokeObjectURL(url));
            setUploadSets(prev => prev.filter((_, i) => i !== index));
        }
    };
    const handleLabelChange = (index: number, value: string) => {
        setUploadSets(prev => prev.map((set, i) => i === index ? {...set, correctLabelName: value} : set));
    };
    const handleImageChange = async (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
        const rawFiles = Array.from(e.target.files || []);
        e.target.value = '';
        if (rawFiles.length === 0) return;

        const { files, failures } = await processSelectedFiles(rawFiles);

        setUploadSets(prev => prev.map((set, i) => {
            if (i === index) {
                const newUrls = files.map(file => URL.createObjectURL(file));
                return {
                    ...set,
                    images: [...set.images, ...files],
                    previewUrls: [...set.previewUrls, ...newUrls],
                    failedFiles: [...set.failedFiles, ...failures]
                };
            }
            return set;
        }));
    };

    const handleFailedFileDismiss = (setIndex: number, failIndex: number) => {
        setUploadSets(prev => prev.map((set, i) => {
            if (i === setIndex) {
                return { ...set, failedFiles: set.failedFiles.filter((_, fi) => fi !== failIndex) };
            }
            return set;
        }));
    };
    const handleImageRemove = (setIndex: number, imageIndex: number) => {
        setUploadSets(prev => prev.map((set, i) => {
            if (i === setIndex) {
                URL.revokeObjectURL(set.previewUrls[imageIndex]);
                return {
                    ...set,
                    images: set.images.filter((_, imgI) => imgI !== imageIndex),
                    previewUrls: set.previewUrls.filter((_, imgI) => imgI !== imageIndex)
                };
            }
            return set;
        }));
    };

    const handleTestSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isSubmitting) return;

        const isValid = uploadSets.every(set => set.correctLabelName && set.images.length > 0);
        if (!isValid) {
            setStatusModal({ type: 'error', message: 'すべてのテスト分類に名前とテスト画像を1枚以上入れてください' });
            return;
        }

        setIsSubmitting(true);
        const uploadBatchId = crypto.randomUUID();
        try {
            const savedToken = Cookies.get('auth_token');

            // ラベル横断でフラットな一覧にし、元の並び順を保ったままリサイズを先行投入する
            // (Workerプールの並列度で処理されるため、アップロード中も次画像のリサイズが進む)
            const flatItems = uploadSets.flatMap((set) =>
                set.images.map((file) => ({ file, correctLabelName: set.correctLabelName }))
            );
            const totalCount = flatItems.length;
            let completedCount = 0;
            setStatusModal({ type: 'loading', message: `テスト画像を送信しています…(0/${totalCount}枚)` });

            const resizedFilePromises = prefetchUploadImageFiles(flatItems.map((item) => item.file));

            // アップロードは後続処理の都合上1枚ずつ順番に送信する(並行実行はしない)
            for (let i = 0; i < flatItems.length; i++) {
                const { correctLabelName } = flatItems[i];
                try {
                    const { original, resized } = await resizedFilePromises[i];

                    const formData = new FormData();
                    formData.append('course_id', classId);
                    formData.append('correct_label_name', correctLabelName);
                    formData.append('file', original);
                    if (resized) formData.append('resized_file', resized);
                    formData.append('batch_id', uploadBatchId);

                    await uploadImageWithRetry(`${API_URL}/api/v1/test/uploading_test_image`, formData, savedToken);
                    completedCount += 1;
                    setStatusModal({ type: 'loading', message: `テスト画像を送信しています…(${completedCount}/${totalCount}枚)` });
                } catch (err) {
                    throw new Error(err instanceof Error ? `${correctLabelName}: ${err.message}` : `${correctLabelName} の送信に失敗`);
                }
            }
            setStatusModal({ type: 'success', message: 'テストデータの登録が完了しました！' });
            revokeAllPreviews(uploadSets);
            setUploadSets([{correctLabelName: '', images: [], previewUrls: [], failedFiles: []}]);
            onSuccess();
        } catch (error: any) {
            setStatusModal({ type: 'error', message: error.message || '送信に失敗しました' });
        } finally {
            setIsSubmitting(false);
        }
    };
    const handleUpdateLabel = async (oldLabelName: string, newLabelName: string) => {
        try {
            const savedToken = Cookies.get('auth_token');
            const res = await fetch(`${API_URL}/api/v1/test/up_test_label`, {
                method: 'POST', // または 'PUT'
                headers: {
                    'Authorization': `Bearer ${savedToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    course_id: Number(classId),
                    old_label_name: oldLabelName,
                    new_label_name: newLabelName
                }),
            });

            if (res.ok) {
                // 🚀 保存が成功したら、画面に表示されているラベル一覧を最新の状態に再取得する
                alert(`ラベル「${oldLabelName}」を「${newLabelName}」に変更しました`);
                await fetchTestLabels();
            } else {
                const errorData = await res.json().catch(() => ({}));
                alert(`エラー: ${errorData.error || 'ラベルの更新に失敗しました'}`);
            }
        } catch (err) {
            console.error('Network error updating label:', err);
            alert('通信エラーが発生しました');
        }
    };

    return (
        <>
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleClose}></div>

            <div
                className={`bg-white rounded-[3rem] shadow-2xl w-full ${mode === 'view' ? 'max-w-3xl' : 'max-w-xl'} z-10 overflow-hidden animate-in zoom-in-95 duration-300 border border-gray-100 transition-all`}>

                {/* ヘッダー */}
                <div className="bg-amber-600 p-8 flex justify-between items-center text-white">
                    <div>
                        <h3 className="text-2xl font-black">性能テスト画像管理</h3>
                        <p className="text-xs text-amber-100 mt-1">先生専用コントロールパネル</p>
                    </div>
                    <button type="button" onClick={handleClose}
                            className="hover:bg-white/20 p-2 rounded-full transition-all">✕
                    </button>
                </div>

                {/* 1. 初期メニュー画面 */}
                {mode === 'menu' && (
                    <div className="p-8 space-y-4">
                        <p className="text-center text-gray-500 font-bold text-sm mb-6">実行したいメニューを選択してください</p>
                        <button type="button" onClick={() => setMode('register')}
                                className="w-full p-5 bg-amber-50 hover:bg-amber-100/70 border-2 border-amber-200 rounded-2xl text-left flex justify-between items-center group transition-all">
                            <span className="font-black text-amber-900 text-lg">📁 テストデータを登録する</span>
                            <span className="text-amber-500 group-hover:translate-x-1 transition-transform">➔</span>
                        </button>
                        <button type="button" onClick={() => setMode('view')}
                                className="w-full p-5 bg-orange-50 hover:bg-orange-100/70 border-2 border-orange-200 rounded-2xl text-left flex justify-between items-center group transition-all">
                            <span className="font-black text-orange-900 text-lg">🔍 登録済みのデータを確認する</span>
                            <span className="text-orange-500 group-hover:translate-x-1 transition-transform">➔</span>
                        </button>
                        <button type="button" onClick={() => setMode('edit_labels')}
                                className="w-full p-5 bg-yellow-50 hover:bg-yellow-100/70 border-2 border-yellow-200 rounded-2xl text-left flex justify-between items-center group transition-all">
                            <span className="font-black text-yellow-900 text-lg">🏷️ テスト用ラベルを確認する</span>
                            <span className="text-yellow-500 group-hover:translate-x-1 transition-transform">➔</span>
                        </button>
                    </div>
                )}

                {/* 2. データを登録（アップロード）画面 */}
                {mode === 'register' && (
                    <form onSubmit={handleTestSubmit} className="p-8 space-y-6 overflow-y-auto max-h-[70vh]">
                        <div className="flex justify-between items-center">
                            <span className="text-sm font-bold text-gray-400">モード: データ登録</span>
                            <button type="button" onClick={() => setMode('menu')}
                                    className="text-xs font-black text-amber-700 bg-amber-50 px-3 py-1.5 rounded-xl hover:bg-amber-100 transition-all">◀
                                メニューに戻る
                            </button>
                        </div>
                        {uploadSets.map((set, setIdx) => (
                            <div key={setIdx}
                                 className="p-6 bg-amber-50/30 rounded-[2.5rem] border-2 border-amber-100/50 flex flex-col gap-4 relative">
                                {uploadSets.length > 1 && (
                                    <button type="button" onClick={() => handleRemoveSet(setIdx)}
                                            className="absolute -top-2 -right-2 bg-white text-red-500 p-2.5 rounded-full shadow-md border border-red-100 hover:bg-red-50 font-black text-xs">✕</button>
                                )}
                                <h4 className="font-black text-amber-900 border-l-4 border-amber-500 pl-3 text-sm">テスト分類
                                    #{setIdx + 1}</h4>
                                <div className="grid grid-cols-4 gap-2">
                                    {set.previewUrls.map((url, i) => (
                                        <div key={i} className="relative aspect-square group">
                                            {isRawFile(set.images[i]) || isHeicFile(set.images[i]) ? (
                                                <div className="w-full h-full flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-white shadow-sm bg-amber-50 text-amber-500 p-1">
                                                    <span className="text-lg">📷</span>
                                                    <span className="text-[9px] font-bold text-center break-all line-clamp-2">{set.images[i].name}</span>
                                                </div>
                                            ) : (
                                                <img src={url}
                                                     className="w-full h-full object-cover rounded-xl border-2 border-white shadow-sm"
                                                     alt="preview"/>
                                            )}
                                            <button type="button" onClick={() => handleImageRemove(setIdx, i)}
                                                    className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 text-[10px] font-black shadow flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">✕
                                            </button>
                                        </div>
                                    ))}
                                    <label
                                        className="aspect-square border-2 border-dashed border-amber-200 rounded-xl flex flex-col items-center justify-center text-amber-400 cursor-pointer hover:bg-white hover:border-amber-400 transition-all text-lg font-bold">
                                        <span>+</span>
                                        <input type="file" className="hidden" multiple accept="image/*,.heic,.heif,.cr2,.cr3"
                                               onChange={(e) => handleImageChange(setIdx, e)}/>
                                    </label>
                                </div>

                                {set.failedFiles.length > 0 && (
                                    <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl p-3 space-y-1">
                                        <p className="font-black">ブラウザでの変換に失敗したファイル(送信時にサーバー側で変換を試みます):</p>
                                        <ul className="space-y-0.5">
                                            {set.failedFiles.map((f, fi) => (
                                                <li key={fi} className="flex items-center justify-between gap-2">
                                                    <span className="break-all">{f.name}（{f.reason}）</span>
                                                    <button type="button" onClick={() => handleFailedFileDismiss(setIdx, fi)} className="shrink-0 text-red-400 hover:text-red-600 font-black">✕</button>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                <input
                                    className="w-full p-3 border-2 border-amber-50 rounded-xl font-bold text-gray-800 focus:ring-4 focus:ring-amber-50 focus:border-amber-400 outline-none transition-all placeholder:text-gray-300 text-sm"
                                    placeholder="テストの正解ラベル名（例：牛）"
                                    value={set.correctLabelName}
                                    onChange={(e) => handleLabelChange(setIdx, e.target.value)}
                                    required
                                />
                            </div>
                        ))}
                        <button type="button" onClick={handleAddSet}
                                className="w-full py-4 border-2 border-dashed border-amber-200 rounded-2xl text-amber-600 font-black hover:bg-amber-50 transition-all text-sm">+
                            テスト分類を追加
                        </button>
                        <button type="submit" disabled={isSubmitting}
                                className="w-full py-5 bg-amber-600 text-white rounded-2xl font-black shadow-lg shadow-amber-100 hover:bg-amber-700 disabled:bg-amber-300 transition-all">
                            {isSubmitting ? 'テストデータを送信中...' : '保存する'}
                        </button>
                    </form>
                )}

                {/* 3. リアルタイム画像確認・個別追加・削除画面 */}
                {mode === 'view' && (
                    <div className="p-8 space-y-6 overflow-y-auto max-h-[70vh]">
                        <div className="flex justify-between items-center">
                            <span className="text-sm font-bold text-orange-500">モード: 登録データの確認・編集</span>
                            <button type="button" onClick={() => setMode('menu')}
                                    className="text-xs font-black text-orange-700 bg-orange-50 px-3 py-1.5 rounded-xl hover:bg-orange-100 transition-all">◀
                                メニューに戻る
                            </button>
                        </div>

                        <TestImageViewSection classId={classId} onSuccess={onSuccess}/>
                    </div>
                )}

                {/* 4. ラベルの変更画面 */}
                {mode === 'edit_labels' && (
                    <div className="p-8 space-y-6 overflow-y-auto max-h-[70vh]">
                        <div className="flex justify-between items-center">
                            <span className="text-sm font-bold text-amber-600">モード: テスト用ラベルの変更</span>
                            <button type="button" onClick={() => setMode('menu')}
                                    className="text-xs font-black text-amber-800 bg-amber-50 px-3 py-1.5 rounded-xl hover:bg-amber-100 transition-all">◀
                                メニューに戻る
                            </button>
                        </div>

                        {labelsLoading ? (
                            <div className="text-center py-12 text-sm text-gray-400 font-bold">ラベルを読み込み中...</div>
                        ) : labels.length === 0 ? (
                            <div className="text-center py-12 text-sm text-gray-400 font-bold bg-gray-50 rounded-2xl border border-dashed">
                                登録済みのテスト用ラベルはありません
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <p className="text-xs font-bold text-gray-400">
                                    現在登録されているラベル名を入力して変更できます。（一括ではなく、各ラベルごとに保存されます）
                                </p>

                                <div className="space-y-3">
                                    {labels.map((label, idx) => {
                                        // 各ラベルの変更後テキストを管理するためのローカルの状態や、Refの代わりにID等を利用するか、
                                        // ここでは簡易的にフォームの onSubmit でその行の入力を取得できるようにします。
                                        return (
                                            <form
                                                key={idx}
                                                onSubmit={async (e) => {
                                                    e.preventDefault();
                                                    const formData = new FormData(e.currentTarget);
                                                    const newLabelName = formData.get(`new_label_${idx}`) as string;

                                                    if (!newLabelName.trim() || newLabelName === label) return;

                                                    await handleUpdateLabel(label, newLabelName);

                                                }}
                                                className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-2xl hover:border-amber-300 transition-all"
                                            >
                                                <div className="flex items-center gap-1.5 min-w-[120px] max-w-[180px] truncate">
                                                    <span className="text-sm">🏷️</span>
                                                    <span className="text-sm font-black text-gray-700 truncate" title={label}>
                                        {label}
                                    </span>
                                                </div>

                                                <span className="text-gray-400 text-xs">▶</span>

                                                <input
                                                    type="text"
                                                    name={`new_label_${idx}`}
                                                    defaultValue={label}
                                                    placeholder="新しいラベル名を入力"
                                                    className="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm font-bold focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200 transition-all"
                                                    required
                                                />

                                                <button
                                                    type="submit"
                                                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-black text-xs rounded-xl shadow-sm hover:shadow transition-all whitespace-nowrap"
                                                >
                                                    保存
                                                </button>
                                            </form>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>

        {/* 送信結果モーダル(成功/失敗) */}
        <UploadStatusModal
            status={statusModal}
            onClose={() => setStatusModal(null)}
            onSuccessConfirm={handleClose}
        />
        </>
    );
}