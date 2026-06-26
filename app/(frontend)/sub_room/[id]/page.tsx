'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { API_URL, securedFetch } from '@/src/lib/api';
import Cookies from 'js-cookie';

// --- 型定義 ---
interface AiSet {
    name: string;
    images: File[];
    previewUrls: string[];
}

type AiModel = {
    project_uuid: string;
    title?: string;
    student_name?: string;
    status?: string;
    updated_at?: string;
    image_count?: number;
    theme_color?: string;
    [k: string]: any;
};

function normalizeModels(data: any): AiModel[] {
    if (!data) return [];
    if (data && Array.isArray(data.aicard)) return data.aicard;
    if (data && Array.isArray(data.projects)) return data.projects;
    if (data && Array.isArray(data.models)) return data.models;
    if (Array.isArray(data)) return data;

    if (typeof data === "object") {
        const numericKeys = Object.keys(data).filter(k => String(Number(k)) === k);
        if (numericKeys.length) return numericKeys.map(k => data[k]);
        if (Array.isArray(data.results)) return data.results;
    }
    return [];
}

export default function SubRoomContent() {
    const router = useRouter();
    const params = useParams();

    const [className, setClassName] = useState<string>('読み込み中...');
    const [inviteCode, setInviteCode] = useState<string>('');
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isAiModalOpen, setIsAiModalOpen] = useState(false);

    const [aiModels, setAiModels] = useState<AiModel[]>([]);
    const [isLoadingAi, setIsLoadingAi] = useState(true);
    const [token, setToken] = useState<string | null>(null);
    const [aiSets, setAiSets] = useState<AiSet[]>([
        { name: '', images: [], previewUrls: [] }
    ]);
    const [aiProjectTitle, setAiProjectTitle] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [userInfo, setUserInfo] = useState<{ name: string; role: 'teacher' | 'student' | string } | null>(null);
    const [selectedProject, setSelectedProject] = useState<AiModel | null>(null);

    // マウント時にクッキーからトークンを取得
    useEffect(() => {
        const savedToken = Cookies.get('auth_token');
        if (!savedToken) {
            router.push('/');
            return;
        }
        setToken(savedToken);
    }, [router]);

    // ルームデータ・ユーザー情報・AIモデルカード一覧を一括取得
    useEffect(() => {
        if (!params) return;
        const classId = params.id as string;

        const fetchRoomData = async () => {
            setIsLoadingAi(true);
            try {
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

                // ② ログインユーザー情報の取得
                const userRes = await securedFetch('/api/v1/user', { method: 'GET' });
                if (userRes.ok) {
                    const userData = await userRes.json();
                    setUserInfo({
                        name: userData.UserName,
                        role: userData.IsTeacher ? 'teacher' : 'student'
                    });
                }

                // ③ aicard 一覧の取得
                const savedToken = Cookies.get('auth_token');
                const aiRes = await securedFetch(`/api/v1/ai/aicard`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${savedToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ course_id: Number(classId) }),
                });

                if (aiRes.ok) {
                    const aiData = await aiRes.json();
                    setAiModels(normalizeModels(aiData));
                }
            } catch (error) {
                console.error("[Error] fetchRoomData 例外:", error);
            } finally {
                setIsLoadingAi(false);
            }
        };

        fetchRoomData();
    }, [params, router]);

    if (!params) {
        return <div className="min-h-screen bg-gray-50 flex items-center justify-center">読み込み中...</div>;
    }
    const classId = params.id as string;

    // オブジェクトURLのメモリ解放ユーティリティ
    const revokeAllPreviews = (sets: AiSet[]) => {
        sets.forEach(set => {
            set.previewUrls.forEach(url => URL.revokeObjectURL(url));
        });
    };

    // モーダルを閉じる際の状態クリーンアップ
    const handleCloseAiModal = () => {
        revokeAllPreviews(aiSets);
        setAiProjectTitle('');
        setAiSets([{ name: '', images: [], previewUrls: [] }]);
        setIsAiModalOpen(false);
    };

    const handleAddSet = () => {
        setAiSets(prev => [...prev, { name: '', images: [], previewUrls: [] }]);
    };

    const handleRemoveSet = (index: number) => {
        if (aiSets.length > 1) {
            // 削除されるセットのプレビューURLを解放
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

    // 画像アップロード & AIリクエスト送信
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

            // アップロード用プロミスの配列を作成（並行処理で効率化）
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

            // すべてのアップロードを並行して実行
            await Promise.all(uploadPromises);

            alert('すべての画像データの送信とAIの分析を開始しました！');
            handleCloseAiModal();
            router.refresh();
        } catch (error: any) {
            console.error(error);
            alert(`エラーが発生しました: ${error.message || '送信失敗'}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    // メニューアクションの統合ハンドリング
    const handleMenuAction = (actionType: string, ai: AiModel) => {
        setSelectedProject(null);

        switch (actionType) {
            case 'train':
                console.log("AIの学習開始:", ai.project_uuid);
                break;
            case 'play':
                console.log("AIを試す (体験画面へ移行):", ai.project_uuid);
                // 例: router.push(`/ai/play/${ai.project_uuid}`);
                break;
            case 'test':
                console.log("AIの性能テスト画面へ:", ai.project_uuid);
                // 例: router.push(`/ai/test/${ai.project_uuid}`);
                break;
            case 'explanation':
                console.log("説明文の作成:", ai.project_uuid);
                break;
            case 'view_images':
                console.log("登録画像を見る:", ai.project_uuid);
                break;
            case 'analytics':
                console.log("AIの性能を表示:", ai.project_uuid);
                break;
            case 'certificate':
                console.log("終了証書を出力:", ai.project_uuid);
                break;
            default:
                console.warn("未知のアクションタイプ:", actionType);
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
                        <div className="flex items-center gap-3">
                            {userInfo ? (
                                <>
                                    {userInfo.role === 'teacher' ? (
                                        <span className="text-xs px-2.5 py-1 bg-amber-50 text-amber-700 rounded-md font-bold border border-amber-100">先生</span>
                                    ) : (
                                        <span className="text-xs px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-md font-bold border border-indigo-100">生徒</span>
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
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleCloseAiModal}></div>
                    <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-xl z-10 overflow-hidden animate-in zoom-in-95 duration-300 border border-gray-100">
                        <div className="bg-indigo-600 p-8 flex justify-between items-center text-white">
                            <h3 className="text-2xl font-black">AI作成リクエスト</h3>
                            <button onClick={handleCloseAiModal} className="hover:bg-white/20 p-2 rounded-full transition-all">✕</button>
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
                                {isSubmitting ? '学習データを送信中...' : 'AIの学習を開始する'}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* Main Content */}
            <main className="flex-1 max-w-7xl mx-auto w-full p-6">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-bold text-gray-700">みんなが作ったAIモデル</h2>
                </div>

                {isLoadingAi ? (
                    <div className="text-center py-20 text-gray-400 font-medium animate-pulse">AIモデルを読み込んでいます...</div>
                ) : aiModels.length === 0 ? (
                    <div className="bg-white border-2 border-dashed border-gray-200 rounded-[2rem] p-16 text-center max-w-xl mx-auto mt-10">
                        <p className="text-gray-500 font-bold mb-4 text-lg">まだこのクラスにAIモデルがありません</p>
                        <p className="text-sm text-gray-400 mb-6">右上のボタンから最初のAIを作ってみましょう！</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {aiModels.map((ai) => {
                            const isPending = ai.status === 'pending';
                            const validTheme = ai.theme_color || 'indigo';
                            const themeBg = {
                                blue: 'bg-blue-600', green: 'bg-emerald-600', indigo: 'bg-indigo-600',
                                purple: 'bg-purple-600', pink: 'bg-pink-600', orange: 'bg-orange-600'
                            }[validTheme] || 'bg-indigo-600';

                            return (
                                <div
                                    key={ai.project_uuid}
                                    onClick={() => setSelectedProject(ai)}
                                    className="group bg-white rounded-3xl border border-gray-100 overflow-hidden hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 flex flex-col h-76 relative cursor-pointer"
                                >
                                    <div className={`${themeBg} h-28 p-5 relative flex flex-col justify-between text-white`}>
                                        <h3 className="text-xl font-black truncate pr-16">{ai.title || "無題のAI"}</h3>
                                        <p className="text-xs font-bold opacity-90 truncate">作った人: {ai.student_name || "わからない"}</p>
                                    </div>

                                    <div className="absolute top-20 right-4 w-14 h-14 bg-white rounded-full p-1 shadow-md z-10">
                                        <div className={`${themeBg} w-full h-full rounded-full flex items-center justify-center text-white text-xl font-black opacity-95`}>
                                            {ai.student_name ? ai.student_name.charAt(0) : 'A'}
                                        </div>
                                    </div>

                                    <div className="p-5 pt-8 flex-1 flex flex-col justify-between">
                                        <div className="flex flex-col gap-2">
                                            <div className="flex items-center gap-2">
                                                <span className="text-[11px] text-gray-400 font-bold">ステータス:</span>
                                                <span className={`text-xs px-2.5 py-0.5 rounded-full font-black ${
                                                    isPending
                                                        ? 'bg-amber-50 text-amber-700 border border-amber-200 animate-pulse'
                                                        : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                                }`}>
                                                    {ai.status === 'pending' ? '⏳ じゅんび中' : (ai.status || '✅ かんりょう')}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="px-5 py-4 border-t border-gray-50 flex justify-between items-center bg-gray-50/30 relative z-20">
                                        <div className="flex flex-col gap-0.5">
                                            {ai.updated_at && (
                                                <p className="text-[11px] text-gray-400 font-bold">
                                                    更新: {new Date(ai.updated_at).toLocaleDateString('ja-JP', {
                                                    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
                                                })}
                                                </p>
                                            )}
                                        </div>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleMenuAction('play', ai); }}
                                            className="px-3 py-1.5 bg-white border border-gray-200 shadow-sm rounded-xl text-xs font-black text-gray-600 hover:bg-gray-50 hover:text-indigo-600 transition-all relative z-30"
                                        >
                                            テストする
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </main>

            {/* AI操作メニューモーダル */}
            {selectedProject && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSelectedProject(null)}></div>
                    <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-md z-10 overflow-hidden animate-in zoom-in-95 duration-300 border border-gray-100">
                        <div className="bg-indigo-600 p-6 flex justify-between items-center text-white">
                            <div>
                                <span className="text-xs font-bold text-indigo-200 uppercase tracking-wider">AIモデルメニュー</span>
                                <h3 className="text-xl font-black truncate max-w-[280px]">
                                    {selectedProject.title}
                                </h3>
                            </div>
                            <button onClick={() => setSelectedProject(null)} className="hover:bg-white/20 p-2 rounded-full transition-all text-xl">✕</button>
                        </div>

                        <div className="p-6 space-y-3 bg-gray-50/50 overflow-y-auto max-h-[70vh]">
                            <button
                                onClick={() => handleMenuAction('train', selectedProject)}
                                className="w-full flex items-center gap-3.5 px-5 py-3 bg-white hover:bg-indigo-50 border-2 border-indigo-100/50 hover:border-indigo-200 text-indigo-900 rounded-2xl transition-all shadow-sm text-left group"
                            >
                                <span className="text-2xl bg-indigo-50 group-hover:bg-indigo-100 p-2 rounded-xl transition-colors">🤖</span>
                                <div>
                                    <p className="text-sm font-black">AIの学習開始</p>
                                    <p className="text-[11px] text-indigo-400 font-medium mt-0.5">あつめた画像を使って新しく学習しなおすよ</p>
                                </div>
                            </button>

                            <button
                                onClick={() => handleMenuAction('play', selectedProject)}
                                className="w-full flex items-center gap-3.5 px-5 py-3 bg-white hover:bg-sky-50 border-2 border-sky-100/50 hover:border-sky-200 text-sky-900 rounded-2xl transition-all shadow-sm text-left group"
                            >
                                <span className="text-2xl bg-sky-50 group-hover:bg-sky-100 p-2 rounded-xl transition-colors">🎮</span>
                                <div>
                                    <p className="text-sm font-black">AIを試す</p>
                                    <p className="text-[11px] text-sky-500 font-medium mt-0.5">カメラや画像を使って、このAIの動きを体験してみよう</p>
                                </div>
                            </button>

                            <button
                                onClick={() => handleMenuAction('test', selectedProject)}
                                className="w-full flex items-center gap-3.5 px-5 py-3 bg-white hover:bg-rose-50 border-2 border-rose-100/50 hover:border-rose-200 text-rose-900 rounded-2xl transition-all shadow-sm text-left group"
                            >
                                <span className="text-2xl bg-rose-50 group-hover:bg-rose-100 p-2 rounded-xl transition-colors">🎯</span>
                                <div>
                                    <p className="text-sm font-black">AIの性能テスト</p>
                                    <p className="text-[11px] text-rose-500 font-medium mt-0.5">テスト用の画像を選んで、AIが正しく見分けられるか挑戦！</p>
                                </div>
                            </button>

                            <button
                                onClick={() => handleMenuAction('explanation', selectedProject)}
                                className="w-full flex items-center gap-3.5 px-5 py-3 bg-white hover:bg-amber-50 border-2 border-amber-100/50 hover:border-amber-200 text-amber-900 rounded-2xl transition-all shadow-sm text-left group"
                            >
                                <span className="text-2xl bg-amber-50 group-hover:bg-amber-100 p-2 rounded-xl transition-colors">📝</span>
                                <div>
                                    <p className="text-sm font-black">説明文の作成</p>
                                    <p className="text-[11px] text-amber-500 font-medium mt-0.5">このAIモデルがどんなものか説明を追加する</p>
                                </div>
                            </button>

                            <button
                                onClick={() => handleMenuAction('view_images', selectedProject)}
                                className="w-full flex items-center gap-3.5 px-5 py-3 bg-white hover:bg-blue-50 border-2 border-blue-100/50 hover:border-blue-200 text-blue-900 rounded-2xl transition-all shadow-sm text-left group"
                            >
                                <span className="text-2xl bg-blue-50 group-hover:bg-blue-100 p-2 rounded-xl transition-colors">🖼️</span>
                                <div>
                                    <p className="text-sm font-black">登録画像を見る</p>
                                    <p className="text-[11px] text-blue-400 font-medium mt-0.5">各カテゴリに保存されている写真をチェックする</p>
                                </div>
                            </button>

                            <button
                                onClick={() => handleMenuAction('analytics', selectedProject)}
                                className="w-full flex items-center gap-3.5 px-5 py-3 bg-white hover:bg-purple-50 border-2 border-purple-100/50 hover:border-purple-200 text-purple-900 rounded-2xl transition-all shadow-sm text-left group"
                            >
                                <span className="text-2xl bg-purple-50 group-hover:bg-purple-100 p-2 rounded-xl transition-colors">📊</span>
                                <div>
                                    <p className="text-sm font-black">AIの性能を表示</p>
                                    <p className="text-[11px] text-purple-400 font-medium mt-0.5">正解率のグラフやテスト分析結果をみる</p>
                                </div>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}