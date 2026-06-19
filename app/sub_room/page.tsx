'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { clearUserSession, loadUserSession, UserSession } from '@/src/lib/user-session';

// --- 型定義 ---
interface AiSet {
    name: string;
    desc: string;
    images: File[];
    previewUrls: string[];
}

function SubRoomContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const classId = searchParams.get('id');
    const className = searchParams.get('name');

    const [currentUser, setCurrentUser] = useState<UserSession | null>(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    const [isAiModalOpen, setIsAiModalOpen] = useState(false);
    const [aiSets, setAiSets] = useState<AiSet[]>([
        { name: '', desc: '', images: [], previewUrls: [] }
    ]);

    // セッション取得
    useEffect(() => {
        const session = loadUserSession();
        if (session) {
            setCurrentUser(session);
            return;
        }

        clearUserSession();
        router.push('/');
    }, [router]);

    const handleAddSet = () => {
        setAiSets(prev => [...prev, { name: '', desc: '', images: [], previewUrls: [] }]);
    };

    const handleRemoveSet = (index: number) => {
        if (aiSets.length > 1) {
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
        e.target.value = ''; // Reset for same file selection
    };

    const handleSetImageRemove = (setIndex: number, imageIndex: number) => {
        setAiSets(prev => prev.map((set, i) => {
            if (i === setIndex) {
                // Revoke URL to prevent memory leaks
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

    const [isSubmitting, setIsSubmitting] = useState(false);

    // 画像リサイズ用ユーティリティ
    const resizeImage = (file: File, width: number, height: number): Promise<Blob> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target?.result as string;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        ctx.drawImage(img, 0, 0, width, height);
                        canvas.toBlob((blob) => {
                            if (blob) resolve(blob);
                            else reject(new Error('Blob conversion failed'));
                        }, 'image/jpeg', 0.9);
                    } else {
                        reject(new Error('Canvas context failed'));
                    }
                };
            };
            reader.onerror = (error) => reject(error);
        });
    };

    // BlobをBase64文字列に変換
    const blobToBase64 = (blob: Blob): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    };

    const handleAiSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isSubmitting) return;

        // Validation
        const isValid = aiSets.every(set => set.name && set.desc && set.images.length > 0);
        if (!isValid) {
            alert('すべてのカテゴリに名前、説明、画像を1枚以上入れてください');
            return;
        }

        setIsSubmitting(true);
        try {
            const processedSets = await Promise.all(aiSets.map(async (set) => {
                const base64Images = await Promise.all(
                    set.images.map(async (img) => {
                        const blob = await resizeImage(img, 300, 300);
                        return await blobToBase64(blob);
                    })
                );

                return {
                    name: set.name,
                    description: set.desc,
                    images: base64Images
                };
            }));

            const response = await fetch('/api/ai_create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    classId: classId,
                    aiSets: processedSets
                }),
            });

            if (!response.ok) throw new Error('通信エラーが発生しました');

            alert('AIの学習を開始しました！');
            setIsAiModalOpen(false);
            setAiSets([{ name: '', desc: '', images: [], previewUrls: [] }]);
        } catch (error) {
            console.error(error);
            alert('送信に失敗しました');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!currentUser) return <div className="min-h-screen bg-gray-50 flex items-center justify-center">読み込み中...</div>;

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            {/* Header */}
            <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button onClick={() => setIsSidebarOpen(true)} className="p-2 hover:bg-gray-100 rounded-full text-gray-600 transition-colors">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
                        </button>
                        <h1 className="text-xl font-bold text-gray-800">{className}</h1>
                    </div>
                    <div className="flex items-center gap-4">
                        <span className="text-xs px-3 py-1 bg-indigo-50 text-indigo-700 rounded-full font-bold border border-indigo-100">{currentUser.role === 'teacher' ? '先生' : '生徒'}</span>
                        <div className="text-sm font-bold text-gray-700">{currentUser.name}</div>
                    </div>
                </div>
            </header>

            <main className="flex-1 max-w-7xl mx-auto w-full p-6 flex flex-col items-center justify-center">
                <div className="bg-white rounded-[2.5rem] shadow-xl border border-gray-100 overflow-hidden w-full max-w-2xl">
                    <div className="bg-indigo-600 p-12 text-center text-white">
                        <h2 className="text-3xl font-black mb-8">AIを作成する</h2>
                        <button
                            onClick={() => setIsAiModalOpen(true)}
                            className="bg-white text-indigo-600 px-10 py-5 rounded-3xl font-black text-xl shadow-2xl hover:scale-105 active:scale-95 transition-all"
                        >
                            ✨ AIを新しく作る
                        </button>
                    </div>
                    <div className="p-10 text-center">
                        <p className="text-gray-500 font-bold mb-6">作成ボタンを押して学習を開始しましょう</p>
                        <Link href="/api/main_room" className="text-indigo-600 font-bold hover:underline">ホームに戻る</Link>
                    </div>
                </div>
            </main>

            {/* Sidebar */}
            {isSidebarOpen && (
                <>
                    <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm" onClick={() => setIsSidebarOpen(false)}></div>
                    <div className="fixed inset-y-0 left-0 z-[110] w-64 bg-white shadow-2xl p-6">
                        <h2 className="text-xl font-black mb-8">メニュー</h2>
                        <div className="space-y-4">
                            <Link href="/api/main_room" className="block p-4 hover:bg-indigo-50 rounded-2xl font-bold">ホーム</Link>
                            <button onClick={() => router.push('/')} className="block w-full text-left p-4 hover:bg-red-50 text-red-500 rounded-2xl font-bold">ログアウト</button>
                        </div>
                    </div>
                </>
            )}

            {/* AI Modal */}
            {isAiModalOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setIsAiModalOpen(false)}></div>
                    <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-xl z-10 overflow-hidden animate-in zoom-in-95 duration-300 border border-gray-100">
                        <div className="bg-indigo-600 p-8 flex justify-between items-center text-white">
                            <h3 className="text-2xl font-black">AI作成リクエスト</h3>
                            <button onClick={() => setIsAiModalOpen(false)} className="hover:bg-white/20 p-2 rounded-full transition-all">✕</button>
                        </div>
                        <form onSubmit={handleAiSubmit} className="p-8 space-y-8 overflow-y-auto max-h-[75vh]">
                            {aiSets.map((set, setIdx) => (
                                <div key={setIdx} className="p-8 bg-indigo-50/30 rounded-[2.5rem] border-2 border-indigo-100/50 flex flex-col gap-6 relative">
                                    {aiSets.length > 1 && (
                                        <button type="button" onClick={() => handleRemoveSet(setIdx)} className="absolute -top-3 -right-3 bg-white text-red-500 p-3 rounded-full shadow-lg border-2 border-red-50 hover:bg-red-50 font-black">✕</button>
                                    )}
                                    <h4 className="font-black text-indigo-900 border-l-4 border-indigo-500 pl-4">カテゴリ #{setIdx + 1}</h4>

                                    <div className="grid grid-cols-3 gap-3">
                                        {set.previewUrls.map((url, i) => (
                                            <div key={i} className="relative aspect-square group">
                                                <img src={url} className="w-full h-full object-cover rounded-2xl border-2 border-white shadow-md" />
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
                                    <textarea
                                        className="w-full p-4 border-2 border-indigo-50 rounded-2xl font-bold text-gray-800 focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 outline-none transition-all resize-none h-28 placeholder:text-gray-300"
                                        placeholder="AIが認識した時の説明文"
                                        value={set.desc}
                                        onChange={(e) => handleSetFieldChange(setIdx, 'desc', e.target.value)}
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
                                {isSubmitting ? '学習データを送信中...' : 'AIの学習を開始する'}
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function SubRoomPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center">読み込み中...</div>}>
            <SubRoomContent />
        </Suspense>
    );
}
