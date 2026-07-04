'use client';

import React, { useState } from 'react';
import Cookies from 'js-cookie';
import { API_URL } from '@/src/lib/api';

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
}

export function CreateAiModal({ isOpen, onClose, classId, onSuccess }: CreateAiModalProps) {
    const [aiProjectTitle, setAiProjectTitle] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [aiSets, setAiSets] = useState<AiSet[]>([
        { name: '', images: [], previewUrls: [] }
    ]);

    if (!isOpen) return null;

    // オブジェクトURLのメモリ解放ユーティリティ
    const revokeAllPreviews = (sets: AiSet[]) => {
        sets.forEach(set => {
            set.previewUrls.forEach(url => URL.revokeObjectURL(url));
        });
    };

    // モーダルを閉じる際の状態クリーンアップ
    const handleClose = () => {
        revokeAllPreviews(aiSets);
        setAiProjectTitle('');
        setAiSets([{ name: '', images: [], previewUrls: [] }]);
        onClose();
    };

    const handleAddSet = () => {
        setAiSets(prev => [...prev, { name: '', images: [], previewUrls: [] }]);
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

    const handleSetImageChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length > 0) {
            setAiSets(prev => prev.map((set, i) => {
                if (i === index) {
                    const newUrls = files.map(file => URL.createObjectURL(file));
                    return {
                        ...set,
                        images: [...set.images, ...files],
                        previewUrls: [...set.previewUrls, ...newUrls]
                    };
                }
                return set;
            }));
        }
        e.target.value = '';
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

        if (!aiProjectTitle) { alert('プロジェクトタイトルを入力してください'); return; }

        const isValid = aiSets.every(set => set.name && set.images.length > 0);
        if (!isValid) { alert('すべてのカテゴリに名前と画像を1枚以上入れてください'); return; }

        setIsSubmitting(true);
        try {
            const savedToken = Cookies.get('auth_token');
            const uploadSessionId = crypto.randomUUID();
            const uploadPromises: Promise<Response>[] = [];

            for (let setIdx = 0; setIdx < aiSets.length; setIdx++) {
                const set = aiSets[setIdx];
                const categoryId = (setIdx + 1);

                for (let imgIdx = 0; imgIdx < set.images.length; imgIdx++) {
                    const file = set.images[imgIdx];

                    const formData = new FormData();
                    formData.append('course_id', classId);
                    formData.append('category_id', categoryId.toString());
                    formData.append('category_title', set.name);
                    formData.append('title', aiProjectTitle);
                    formData.append('upload_session_id', uploadSessionId);
                    formData.append('file', file);

                    const uploadPromise = fetch(`${API_URL}/api/v1/ai/upload_image`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${savedToken}` },
                        body: formData,
                    }).then(async (res) => {
                        if (!res.ok) {
                            const errorData = await res.json().catch(() => ({}));
                            throw new Error(errorData.error || `${set.name} の画像送信に失敗しました`);
                        }
                        return res;
                    });

                    uploadPromises.push(uploadPromise);
                }
            }

            await Promise.all(uploadPromises);

            alert('すべての画像データの送信が完了しました！');
            handleClose();
            onSuccess();
        } catch (error: any) {
            console.error(error);
            alert(`エラーが発生しました: ${error.message || '送信失敗'}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
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
                                        <img src={url} className="w-full h-full object-cover rounded-2xl border-2 border-white shadow-md" alt="preview" />
                                        <button type="button" onClick={() => handleSetImageRemove(setIdx, i)} className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-6 h-6 text-xs font-black shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                                    </div>
                                ))}
                                <label className="aspect-square border-4 border-dashed border-indigo-100 rounded-2xl flex flex-col items-center justify-center text-indigo-300 cursor-pointer hover:bg-white hover:border-indigo-400 transition-all text-xl font-bold">
                                    <span>+</span>
                                    <input type="file" className="hidden" multiple accept="image/*" onChange={(e) => handleSetImageChange(setIdx, e)} />
                                </label>
                            </div>

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
    );
}