'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { securedFetch } from '@/src/lib/api';

// --- 型定義 ---
interface AiSet {
    name: string;
    desc: string;
    images: File[];
    previewUrls: string[];
}

interface CreatedAiModel {
    id: string;
    title: string;
    description: string;
    creator_name: string;
    image_count: number;
    theme_color: string;
    updata_time: string;
}

function SubRoomContent() {
    const router = useRouter();
    const params = useParams();

    // 🌟 セッション管理用のStateはすべて廃止
    const [className, setClassName] = useState<string>('読み込み中...');
    const [inviteCode, setInviteCode] = useState<string>('');
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isAiModalOpen, setIsAiModalOpen] = useState(false);
    const [aiModels, setAiModels] = useState<CreatedAiModel[]>([]);
    const [isLoadingAi, setIsLoadingAi] = useState(true);
    const [aiSets, setAiSets] = useState<AiSet[]>([
        { name: '', desc: '', images: [], previewUrls: [] }
    ]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [userInfo, setUserInfo] = useState<{ name: string; role: 'teacher' | 'student' | string } | null>(null);

    // 🌟 データの同期はparams（URLのID）の確定のみをトリガーにする
    useEffect(() => {
        if (!params) return;
        const classId = params.id as string;

        const fetchRoomData = async () => {
            try {
                console.log(`[Debug] APIリクエスト開始: /api/v1/courses/${classId}`);

                // ① クラス情報の取得
                const courseRes = await securedFetch(`/api/v1/courses/${classId}`, { method: 'GET' });

                if (courseRes.status === 401 || courseRes.status === 403) {
                    router.push('/');
                    return;
                }

                if (courseRes.ok) {
                    const courseData = await courseRes.json();
                    setClassName(courseData.title || '無題のクラス');
                    setInviteCode(courseData.invite_code || courseData.code || '');
                } else {
                    router.push('/main_room');
                    return;
                }

                // 🌟 ② ユーザー情報の取得（独立したAPIを正しく叩く）
                const userRes = await securedFetch('/api/v1/user', { method: 'GET' });
                if (userRes.status === 401 || userRes.status === 403) {
                    router.push('/');
                    return;
                }

                if (userRes.ok) {
                    const userData = await userRes.json();
                    console.log("[Debug] 受信したユーザーデータ:", userData);

                    // バックエンドのJSONキー（例: name や role, もしくは user_name など）に合わせてセット
                    // 💡 もしGo側が "user_name" で返している場合は `userData.user_name` に書き換えてください
                    setUserInfo({
                        name: userData.UserName, // キー名を合わせる
                        role: userData.IsTeacher ? 'teacher' : 'student' // 真偽値から文字列へ変換
                    });
                }

                // 🌟 ③ みんなが作成したAIの一覧を取得（パスを修正）
                const aiRes = await securedFetch(`/api/v1/courses/${classId}/ai_models`, { method: 'GET' });
                if (aiRes.status === 401 || aiRes.status === 403) {
                    router.push('/');
                    return;
                }

                if (aiRes.ok) {
                    const aiData = await aiRes.json();
                    setAiModels(aiData.models || []);
                }
            } catch (error) {
                console.error("[Debug] fetchRoomData例外:", error);
            } finally {
                setIsLoadingAi(false);
            }
        };

        fetchRoomData();
    }, [params, router]);
    // 安全な型ガード
    if (!params) {
        return <div className="min-h-screen bg-gray-50 flex items-center justify-center">読み込み中...</div>;
    }
    const classId = params.id as string;

    // --- 各種ハンドラー関数（ロジックは維持） ---
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

            if (response.status === 401 || response.status === 403) {
                router.push('/');
                return;
            }

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

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            {/* Header */}
            <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button onClick={() => setIsSidebarOpen(true)} className="p-2 hover:bg-gray-100 rounded-full text-gray-600 transition-colors">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
                        </button>

                        <div className="flex items-center gap-4">
                            <h1 className="text-2xl font-bold text-gray-800 tracking-tight">{className}</h1>

                            {/* 先生の時のみ表示するよう userInfo.role をチェック */}
                            {userInfo?.role === 'teacher' && inviteCode && (
                                <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 px-3 py-1 rounded-xl shadow-sm">
                                    <span className="text-[11px] font-black text-amber-700 tracking-wider uppercase">参加コード:</span>
                                    <span className="font-mono text-base font-black text-amber-900 tracking-widest bg-white px-2 py-0.5 rounded-lg border border-amber-100 select-all">
                                        {inviteCode}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-5">
                        <button
                            onClick={() => setIsAiModalOpen(true)}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold text-sm shadow-md transition-all flex items-center gap-1.5"
                        >
                            <span>✨ AIを新しく作る</span>
                        </button>

                        <div className="h-6 w-[1px] bg-gray-200" />

                        {/* 🌟 3. マイページ部分をユーザー情報表示に書き換え */}
                        <div className="flex items-center gap-3">
                            {userInfo ? (
                                <>
                                    {userInfo.role === 'teacher' ? (
                                        <span className="text-xs px-2.5 py-1 bg-amber-50 text-amber-700 rounded-md font-bold border border-amber-100">
                                            先生
                                        </span>
                                    ) : (
                                        <span className="text-xs px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-md font-bold border border-indigo-100">
                                            生徒
                                        </span>
                                    )}
                                    <div className="text-sm font-bold text-gray-700">{userInfo.name} さん</div>
                                </>
                            ) : (
                                <div className="text-sm font-bold text-gray-400 animate-pulse">読み込み中...</div>
                            )}
                        </div>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="flex-1 max-w-7xl mx-auto w-full p-6">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-bold text-gray-700">みんなが作ったAIモデル</h2>
                </div>

                {isLoadingAi ? (
                    <div className="text-center py-20 text-gray-400 font-medium">AIモデルを読み込んでいます...</div>
                ) : aiModels.length === 0 ? (
                    <div className="bg-white border-2 border-dashed border-gray-200 rounded-[2rem] p-16 text-center max-w-xl mx-auto mt-10">
                        <p className="text-gray-500 font-bold mb-4 text-lg">まだこのクラスにAIモデルがありません</p>
                        <p className="text-sm text-gray-400 mb-6">右上のボタンから最初のAIを作ってみましょう！</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {aiModels.map((ai) => {
                            const validTheme = ai.theme_color || 'indigo';
                            const themeBg = {
                                blue: 'bg-blue-600', green: 'bg-emerald-600', indigo: 'bg-indigo-600',
                                purple: 'bg-purple-600', pink: 'bg-pink-600', orange: 'bg-orange-600'
                            }[validTheme] || 'bg-indigo-600';

                            return (
                                <div key={ai.id} className="group bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-lg transition-all duration-200 flex flex-col h-76 relative">
                                    <div className={`${themeBg} h-28 p-5 relative flex flex-col justify-between text-white`}>
                                        <h3 className="text-2xl font-bold truncate pr-16 hover:underline cursor-pointer">
                                            {ai.title}
                                        </h3>
                                        <p className="text-sm font-medium opacity-90 truncate">
                                            作った人: {ai.creator_name}
                                        </p>
                                    </div>

                                    <div className="absolute top-20 right-4 w-16 h-16 bg-white rounded-full p-1 shadow-md z-10">
                                        <div className={`${themeBg} w-full h-full rounded-full flex items-center justify-center text-white text-2xl font-bold opacity-90`}>
                                            {ai.creator_name ? ai.creator_name.charAt(0) : 'A'}
                                        </div>
                                    </div>

                                    <div className="p-5 pt-10 flex-1 flex flex-col justify-between">
                                        <p className="text-sm text-gray-600 line-clamp-3 leading-relaxed">
                                            {ai.description}
                                        </p>
                                    </div>

                                    <div className="px-5 py-3 border-t border-gray-100 flex justify-between items-center bg-gray-50/50 relative z-20">
                                        <div className="flex flex-col gap-0.5">
                                            <div className="flex items-center gap-1.5 mb-0.5">
                                                <span className="text-xs bg-gray-200 text-gray-700 px-2 py-0.5 rounded-md font-bold">
                                                    画像 {ai.image_count || 0}枚
                                                </span>
                                            </div>
                                            {ai.updata_time && (
                                                <p className="text-[11px] text-gray-400 font-medium">
                                                    作成: {new Date(ai.updata_time).toLocaleDateString('ja-JP', {
                                                    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
                                                })}
                                                </p>
                                            )}
                                        </div>

                                        <button className="px-3 py-1.5 bg-white border border-gray-200 shadow-sm rounded-lg text-xs font-bold text-gray-600 hover:bg-gray-50 transition-colors">
                                            テストする
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </main>

            {/* Sidebar */}
            {isSidebarOpen && (
                <>
                    <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm" onClick={() => setIsSidebarOpen(false)}></div>
                    <div className="fixed inset-y-0 left-0 z-[110] w-64 bg-white shadow-2xl p-6">
                        <h2 className="text-xl font-black mb-8">メニュー</h2>
                        <div className="space-y-4">
                            <Link href="/main_room" className="block p-4 hover:bg-indigo-50 rounded-2xl font-bold">ホーム</Link>
                            <button onClick={() => { router.push('/'); }} className="block w-full text-left p-4 hover:bg-red-50 text-red-500 rounded-2xl font-bold">ログアウト</button>
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