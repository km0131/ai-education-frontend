'use client';

import React, { useEffect, useRef, useState } from 'react';
import Cookies from 'js-cookie';
import { API_URL } from '@/src/lib/api';
import { uploadImageWithRetry } from '@/src/lib/uploadWithRetry';
import { prefetchUploadImageFiles } from '@/src/lib/imageResize';
import { processSelectedFiles, isRawFile, isHeicFile, HeicConversionFailure } from '@/src/lib/heicConvert';
import { watchConversionStatus, UploadedPhotoInfo } from '@/src/lib/conversionStatus';
import { UploadStatusModal, UploadStatus } from '@/src/components/UploadStatusModal';

interface CreateAiModalProps {
    isOpen: boolean;
    onClose: () => void;
    classId: string;
    onSuccess: () => void;
}

interface AiSet {
    name: string;
    images: File[];
    previewUrls: string[];
    failedFiles: HeicConversionFailure[];
}

export function CreateAiModal({ isOpen, onClose, classId, onSuccess }: CreateAiModalProps) {
    const [aiProjectTitle, setAiProjectTitle] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [aiSets, setAiSets] = useState<AiSet[]>([
        { name: '', images: [], previewUrls: [], failedFiles: [] }
    ]);
    const [statusModal, setStatusModal] = useState<UploadStatus>(null);

    // オブジェクトURLのメモリ解放ユーティリティ
    const revokeAllPreviews = (sets: AiSet[]) => {
        sets.forEach(set => {
            set.previewUrls.forEach(url => URL.revokeObjectURL(url));
        });
    };

    // アンマウント時にも、その時点で残っているプレビューを必ず解放する(リーク防止の最終防衛線)
    const aiSetsRef = useRef(aiSets);
    aiSetsRef.current = aiSets;
    useEffect(() => {
        return () => revokeAllPreviews(aiSetsRef.current);
    }, []);

    if (!isOpen) return null;

    // モーダルを閉じる際の状態クリーンアップ
    const handleClose = () => {
        revokeAllPreviews(aiSets);
        setAiProjectTitle('');
        setAiSets([{ name: '', images: [], previewUrls: [], failedFiles: [] }]);
        onClose();
    };

    const handleAddSet = () => {
        setAiSets(prev => [...prev, { name: '', images: [], previewUrls: [], failedFiles: [] }]);
    };

    const handleRemoveSet = (index: number) => {
        if (aiSets.length > 1) {
            aiSets[index].previewUrls.forEach(url => URL.revokeObjectURL(url));
            setAiSets(prev => prev.filter((_, i) => i !== index));
        }
    };

    const handleSetFieldChange = (index: number, field: keyof AiSet, value: string) => {
        setAiSets(prev => prev.map((set, i) => i === index ? { ...set, [field]: value } : set));
    };

    const handleSetImageChange = async (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
        const rawFiles = Array.from(e.target.files || []);
        e.target.value = '';
        if (rawFiles.length === 0) return;

        // HEIC/HEIFはここでJPEGに変換し、.AAE/.MOV等の非画像ファイルは除外する。
        // 変換に失敗したファイルはfailedFilesに積んで一覧表示し、送信対象には含めない。
        const { files, failures } = await processSelectedFiles(rawFiles);

        setAiSets(prev => prev.map((set, i) => {
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

    const handleSetFailedFileDismiss = (setIndex: number, failIndex: number) => {
        setAiSets(prev => prev.map((set, i) => {
            if (i === setIndex) {
                return { ...set, failedFiles: set.failedFiles.filter((_, fi) => fi !== failIndex) };
            }
            return set;
        }));
    };

    const handleSetImageRemove = (setIndex: number, imageIndex: number) => {
        setAiSets(prev => prev.map((set, i) => {
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

    const handleAiSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isSubmitting) return;

        if (!aiProjectTitle) { setStatusModal({ type: 'error', message: 'プロジェクトタイトルを入力してください' }); return; }

        const isValid = aiSets.every(set => set.name && set.images.length > 0);
        if (!isValid) { setStatusModal({ type: 'error', message: 'すべてのカテゴリに名前と画像を1枚以上入れてください' }); return; }

        setIsSubmitting(true);
        try {
            const savedToken = Cookies.get('auth_token');
            const uploadSessionId = crypto.randomUUID();

            // カテゴリ横断でフラットな一覧にし、元の並び順を保ったままリサイズを先行投入する
            // (Workerプールの並列度で処理されるため、アップロード中も次画像のリサイズが進む)
            const flatItems = aiSets.flatMap((set, setIdx) =>
                set.images.map((file) => ({ file, categoryId: setIdx + 1, categoryName: set.name }))
            );
            const totalCount = flatItems.length;
            let completedCount = 0;
            setStatusModal({ type: 'loading', message: `画像を送信しています…(0/${totalCount}枚)` });

            const resizedFilePromises = prefetchUploadImageFiles(flatItems.map((item) => item.file));

            // フロント(createImageBitmap/heic2any)のどちらでも変換できず、バックエンドの
            // heif-convert/exiftoolフォールバックが非同期で必要になった画像はここに積み、
            // アップロードループ完了後にバックグラウンドで完了確認する(送信ループはブロックしない)
            const pendingConversions: { photoId: number; fileName: string }[] = [];

            // アップロードは後続処理の都合上1枚ずつ順番に送信する(並行実行はしない)
            for (let i = 0; i < flatItems.length; i++) {
                const { categoryId, categoryName } = flatItems[i];
                try {
                    const { original, resized } = await resizedFilePromises[i];

                    const formData = new FormData();
                    formData.append('course_id', classId);
                    formData.append('category_id', categoryId.toString());
                    formData.append('category_title', categoryName);
                    formData.append('title', aiProjectTitle);
                    formData.append('upload_session_id', uploadSessionId);
                    formData.append('file', original);
                    if (resized) formData.append('resized_file', resized);

                    const uploaded = await uploadImageWithRetry(`${API_URL}/api/v1/ai/upload_image`, formData, savedToken) as UploadedPhotoInfo | null;
                    if (uploaded?.ConversionStatus === 'processing' && uploaded.ID) {
                        pendingConversions.push({ photoId: uploaded.ID, fileName: original.name });
                    }
                    completedCount += 1;
                    setStatusModal({ type: 'loading', message: `画像を送信しています…(${completedCount}/${totalCount}枚)` });
                } catch (err) {
                    throw new Error(err instanceof Error ? `${categoryName}: ${err.message}` : `${categoryName} の画像送信に失敗しました`);
                }
            }

            if (pendingConversions.length > 0) {
                watchConversionStatus(`${API_URL}/api/v1/ai/photo_status`, savedToken, pendingConversions, (fileName, reason) => {
                    console.warn(`[conversionStatus] ${fileName}: ${reason}`);
                    alert(`${fileName}: サーバー側での画像変換に失敗しました(${reason})。この画像は学習データに含まれていない可能性があります。`);
                });
            }

            setStatusModal({ type: 'success', message: 'すべての画像データの送信が完了しました！' });
            revokeAllPreviews(aiSets);
            setAiProjectTitle('');
            setAiSets([{ name: '', images: [], previewUrls: [], failedFiles: [] }]);
            onSuccess();
        } catch (error: any) {
            console.error(error);
            setStatusModal({ type: 'error', message: error.message || '送信に失敗しました' });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <>
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleClose}></div>
                <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-xl z-10 overflow-hidden animate-in zoom-in-95 duration-300 border border-gray-100">
                    <div className="bg-indigo-600 p-8 flex justify-between items-center text-white">
                        <h3 className="text-2xl font-black">AI作成リクエスト</h3>
                        <button type="button" onClick={handleClose} className="hover:bg-white/20 p-2 rounded-full transition-all">✕</button>
                    </div>
                    <form onSubmit={handleAiSubmit} className="p-8 space-y-8 overflow-y-auto max-h-[75vh]">
                        <div>
                            <label className="block text-indigo-900 font-black mb-2 px-2">プロジェクトタイトル</label>
                            <input
                                className="w-full p-4 border-2 border-indigo-100 rounded-2xl font-bold text-gray-800 focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 outline-none transition-all placeholder:text-gray-300"
                                placeholder="例：福岡の観光地分類プロジェクト"
                                value={aiProjectTitle}
                                onChange={(e) => setAiProjectTitle(e.target.value)}
                                required
                            />
                        </div>

                        {aiSets.map((set, setIdx) => (
                            <div key={setIdx} className="p-8 bg-indigo-50/30 rounded-[2.5rem] border-2 border-indigo-100/50 flex flex-col gap-6 relative">
                                {aiSets.length > 1 && (
                                    <button type="button" onClick={() => handleRemoveSet(setIdx)} className="absolute -top-3 -right-3 bg-white text-red-500 p-3 rounded-full shadow-lg border-2 border-red-50 hover:bg-red-50 font-black">✕</button>
                                )}
                                <h4 className="font-black text-indigo-900 border-l-4 border-indigo-500 pl-4">カテゴリ #{setIdx + 1}</h4>

                                <div className="grid grid-cols-3 gap-3">
                                    {set.previewUrls.map((url, i) => (
                                        <div key={i} className="relative aspect-square group">
                                            {isRawFile(set.images[i]) || isHeicFile(set.images[i]) ? (
                                                <div className="w-full h-full flex flex-col items-center justify-center gap-1 rounded-2xl border-2 border-white shadow-md bg-indigo-50 text-indigo-400 p-1">
                                                    <span className="text-xl">📷</span>
                                                    <span className="text-[10px] font-bold text-center break-all line-clamp-2">{set.images[i].name}</span>
                                                </div>
                                            ) : (
                                                <img src={url} className="w-full h-full object-cover rounded-2xl border-2 border-white shadow-md" alt="preview" />
                                            )}
                                            <button type="button" onClick={() => handleSetImageRemove(setIdx, i)} className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-6 h-6 text-xs font-black shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                                        </div>
                                    ))}
                                    <label className="aspect-square border-4 border-dashed border-indigo-100 rounded-2xl flex flex-col items-center justify-center text-indigo-300 cursor-pointer hover:bg-white hover:border-indigo-400 transition-all text-xl font-bold">
                                        <span>+</span>
                                        <input type="file" className="hidden" multiple accept="image/*,.heic,.heif,.cr2,.cr3" onChange={(e) => handleSetImageChange(setIdx, e)} />
                                    </label>
                                </div>

                                {set.failedFiles.length > 0 && (
                                    <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-2xl p-3 space-y-1">
                                        <p className="font-black">ブラウザでの変換に失敗したファイル(送信時にサーバー側で変換を試みます):</p>
                                        <ul className="space-y-0.5">
                                            {set.failedFiles.map((f, fi) => (
                                                <li key={fi} className="flex items-center justify-between gap-2">
                                                    <span className="break-all">{f.name}（{f.reason}）</span>
                                                    <button type="button" onClick={() => handleSetFailedFileDismiss(setIdx, fi)} className="shrink-0 text-red-400 hover:text-red-600 font-black">✕</button>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                <input
                                    className="w-full p-4 border-2 border-indigo-50 rounded-2xl font-bold text-gray-800 focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 outline-none transition-all placeholder:text-gray-300"
                                    placeholder="カテゴリ名（例：太宰府天満宮）"
                                    value={set.name}
                                    onChange={(e) => handleSetFieldChange(setIdx, 'name', e.target.value)}
                                    required
                                />
                            </div>
                        ))}
                        <button type="button" onClick={handleAddSet} className="w-full py-5 border-4 border-dashed border-indigo-100 rounded-[2rem] text-indigo-500 font-black hover:bg-indigo-50 hover:border-indigo-200 transition-all">+ カテゴリを追加</button>
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="w-full py-6 bg-indigo-600 text-white rounded-[2rem] font-black text-lg shadow-xl shadow-indigo-200 hover:bg-indigo-700 active:scale-95 disabled:bg-indigo-300 transition-all"
                        >
                            {isSubmitting ? '学習データを送信中...' : 'AIの学習データを送信する'}
                        </button>
                    </form>
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
