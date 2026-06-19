'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { clearUserSession, loadUserSession, UserSession } from '@/src/lib/user-session';

// --- 型定義 ---
interface ClassRoom {
    id: string;
    className: string;
    teacherName: string;
    description: string;
    themeColor: string; // カードの背景色用
}

// --- モックデータ ---
// UserデータはAPIから取得するため削除


const INITIAL_CLASSES: ClassRoom[] = [];

export default function MainRoomPage() {
    // --- State ---
    const router = useRouter();
    const [currentUser, setCurrentUser] = useState<UserSession | null>(null);
    const [classes, setClasses] = useState<ClassRoom[]>([]);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showJoinModal, setShowJoinModal] = useState(false);

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

    // クラス一覧取得
    React.useEffect(() => {
        if (!currentUser) return;

        const fetchClasses = async () => {
            try {
                const res = await fetch('/api/my_courses');
                if (!res.ok) {
                    throw new Error('クラス一覧の取得に失敗しました');
                }
                const data = await res.json();

                if (data.status === 'success' && Array.isArray(data.courses)) {
                    console.log('Fetched courses:', data.courses); // Debug log
                    const mappedClasses: ClassRoom[] = data.courses.map((c: any) => ({
                        id: c.ID || c.id,
                        // Try various casing conventions
                        className: c.ClassName || c.class_name || c.className || c.title || '（クラス名なし）',
                        teacherName: c.TeacherName || c.teacher_name || c.teacherName || '（先生不明）',
                        description: c.Description || c.description,
                        themeColor: c.ThemeColor || c.theme_color || c.themeColor || 'bg-gray-600',
                    }));
                    setClasses(mappedClasses);
                }
            } catch (error) {
                console.error('Failed to fetch classes:', error);
            }
        };
        fetchClasses();
    }, [currentUser]);

    // 入力フォーム用State
    const [newClassName, setNewClassName] = useState('');
    const [newClassDesc, setNewClassDesc] = useState('');
    const [joinCode, setJoinCode] = useState('');

    // --- Actions ---

    // クラス作成 (先生のみ)
    const handleCreateClass = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentUser) return;

        try {
            const res = await fetch('/api/create_class', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    className: newClassName,
                    description: newClassDesc,
                }),
            });

            if (!res.ok) {
                throw new Error('クラスの作成に失敗しました');
            }

            const data = await res.json();

            alert(`作成しました！招待コードは ${data.course} です`);
            window.location.reload();

        } catch (error) {
            console.error(error);
            alert('クラスの作成に失敗しました');
        }
    };

    // クラス参加 (全員)
    const handleJoinClass = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const res = await fetch('/api/join_class', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ inviteCode: joinCode })
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || '参加に失敗しました');
            }

            const data = await res.json();
            alert(data.message || 'クラスに参加しました！');
            window.location.reload();

        } catch (error) {
            console.error(error);
            alert('クラスに参加できませんでした。コードを確認してください。');
        }
    };

    // ログアウト
    const handleLogout = () => {
        router.push('/');
    };

    if (!currentUser) {
        return (
            <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center">
                <div className="text-gray-500 text-lg">読み込み中...</div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            {/* --- Sidebar (Drawer) --- */}
            {isSidebarOpen && (
                <>
                    <div
                        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
                        onClick={() => setIsSidebarOpen(false)}
                    ></div>
                    <div className="fixed inset-y-0 left-0 z-50 w-64 bg-white shadow-2xl transform transition-transform duration-300 ease-in-out animate-in slide-in-from-left">
                        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                            <h2 className="font-bold text-gray-700 flex items-center gap-2">
                                <div className="w-8 h-8 bg-yellow-400 rounded-md flex items-center justify-center text-white font-bold text-lg">
                                    A
                                </div>
                                AI Classroom
                            </h2>
                            <button
                                onClick={() => setIsSidebarOpen(false)}
                                className="p-1 rounded-full hover:bg-gray-200 text-gray-500 transition-colors"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <div className="p-4 flex flex-col h-[calc(100%-64px)] justify-between">
                            <div className="space-y-1">
                                <div className="px-4 py-2 text-sm text-gray-500 font-medium">
                                    ようこそ、{currentUser.name} さん
                                </div>
                                {/* ここに他のメニュー項目を追加可能 */}
                            </div>

                            <div className="pt-4 border-t border-gray-100">
                                <button
                                    onClick={handleLogout}
                                    className="flex items-center gap-3 w-full px-4 py-3 text-red-600 hover:bg-red-50 rounded-lg transition-colors font-medium"
                                >
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                                    </svg>
                                    ログアウト
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}

            {/* --- Header --- */}
            <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">

                    {/* Left: Branding & Hamburger */}
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => setIsSidebarOpen(true)}
                            className="p-2 -ml-2 rounded-full hover:bg-gray-100 text-gray-600"
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                            </svg>
                        </button>
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-yellow-400 rounded-md flex items-center justify-center text-white font-bold text-lg">
                                A
                            </div>
                            <h1 className="text-xl text-gray-700 font-medium hidden sm:block">
                                AI Classroom
                            </h1>
                        </div>
                    </div>

                    {/* Right: Actions & Profile */}
                    <div className="flex items-center gap-4">
                        {/* Role Badge */}
                        <span className="text-xs px-3 py-1 bg-blue-50 text-blue-700 rounded-full font-medium border border-blue-100">
                            {currentUser.role === 'teacher' ? '先生' : '生徒'}
                        </span>

                        {/* Plus Button Menu */}
                        <div className="relative">
                            <button
                                onClick={() => setIsMenuOpen(!isMenuOpen)}
                                className="p-2 rounded-full hover:bg-gray-100 text-gray-600 transition-colors"
                                title="クラスを作成または参加"
                            >
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                            </button>

                            {/* Dropdown Menu */}
                            {isMenuOpen && (
                                <>
                                    <div
                                        className="fixed inset-0 z-10"
                                        onClick={() => setIsMenuOpen(false)}
                                    ></div>
                                    <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 z-20 border border-gray-100 origin-top-right animate-in fade-in zoom-in-95 duration-100">
                                        <button
                                            onClick={() => { setShowJoinModal(true); setIsMenuOpen(false); }}
                                            className="block w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 bg-white"
                                        >
                                            クラスに参加
                                        </button>
                                        {currentUser.role === 'teacher' && (
                                            <button
                                                onClick={() => { setShowCreateModal(true); setIsMenuOpen(false); }}
                                                className="block w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 bg-white"
                                            >
                                                クラスを作成
                                            </button>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>

                        {/* User Avatar */}
                        <div className="text-sm font-medium text-gray-700">
                            {currentUser.name}
                        </div>
                    </div>
                </div>
            </header>

            {/* --- Main Content --- */}
            <main className="flex-1 w-full max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
                {classes.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-96 text-gray-500">
                        <p className="text-xl">クラスがありません</p>
                        <p className="text-sm mt-2">右上の「＋」ボタンからクラスを追加または参加してください</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {classes.map((cls) => {
                            // Helper to ensure valid theme color or generate one from ID
                            // Tailwind requires full class names to be present in source to be compiled.
                            // We explicitly list the allowed colors to ensure they are picked up.
                            const ALLOWED_COLORS = ['bg-blue-600', 'bg-emerald-600', 'bg-amber-600', 'bg-indigo-600', 'bg-rose-600'];

                            let validTheme = cls.themeColor;
                            if (!ALLOWED_COLORS.includes(validTheme)) {
                                validTheme = ALLOWED_COLORS[
                                    Math.abs(String(cls.id || '0').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % ALLOWED_COLORS.length
                                ];
                            }

                            return (
                                <div
                                    key={cls.id}
                                    className="group bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-lg transition-all duration-200 flex flex-col h-72 cursor-pointer relative"
                                >
                                    {/* Link wrapper for Header and Body */}
                                    <div
                                        onClick={() => {
                                            const name = encodeURIComponent(cls.className);
                                            const url = `/sub_room?id=${cls.id}&name=${name}`;

                                            console.log("強制遷移先:", url);

                                            // router.push ではなく、ブラウザの機能で強制移動
                                            window.location.href = url;
                                        }}
                                        className="flex flex-col flex-1 cursor-pointer"
                                    >
                                        {/* Card Header (Google Classroom Style) */}
                                        <div className={`${validTheme} h-24 p-4 relative flex flex-col justify-between`}>
                                            <div className="flex justify-between items-start">
                                                <h2 className="text-xl text-white font-medium hover:underline truncate pr-8">
                                                    {cls.className}
                                                </h2>
                                                <div className="text-white opacity-80 hover:opacity-100 p-1 hover:bg-white/20 rounded-full transition-colors absolute right-2 top-2">
                                                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                                        <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
                                                    </svg>
                                                </div>
                                            </div>
                                            <p className="text-white text-sm hover:underline truncate mb-1">
                                                {cls.teacherName}
                                            </p>
                                        </div>

                                        {/* Avatar (Floating) */}
                                        <div className="absolute top-16 right-4 w-16 h-16 bg-white rounded-full p-1 shadow-md z-10">
                                            <div className={`${validTheme} w-full h-full rounded-full flex items-center justify-center text-white text-2xl font-bold opacity-90`}>
                                                {cls.teacherName ? cls.teacherName.charAt(0) : 'A'}
                                            </div>
                                        </div>

                                        {/* Card Body */}
                                        <div className="p-4 pt-12 flex-1">
                                            <p className="text-xs text-gray-500 line-clamp-3">
                                                {cls.description}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Card Footer */}
                                    <div className="px-4 py-3 border-t border-gray-100 flex justify-end gap-1 bg-white relative z-20">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); /* フォルダ開く処理 */ }}
                                            className="p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors"
                                            title="ワークフォルダを開く"
                                        >
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
                                            </svg>
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); /* 課題一覧処理 */ }}
                                            className="p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors"
                                            title="課題一覧"
                                        >
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </main>

            {/* --- Modals --- */}

            {/* Create Class Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowCreateModal(false)}></div>
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-md z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="px-6 py-4 border-b border-gray-100">
                            <h3 className="text-lg font-medium text-gray-900">クラスを作成</h3>
                        </div>
                        <form onSubmit={handleCreateClass} className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">クラス名 (必須)</label>
                                <input
                                    type="text"
                                    value={newClassName}
                                    onChange={(e) => setNewClassName(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                                    placeholder="例: 3年B組 数学"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">内容・科目など</label>
                                <input
                                    type="text"
                                    value={newClassDesc}
                                    onChange={(e) => setNewClassDesc(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                                    placeholder="例: 微分積分の基礎"
                                />
                            </div>
                            <div className="pt-4 flex justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => setShowCreateModal(false)}
                                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-50 rounded-md hover:bg-gray-100 focus:outline-none ring-offset-2 focus:ring-2"
                                >
                                    キャンセル
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none ring-offset-2 focus:ring-2"
                                    disabled={!newClassName}
                                >
                                    作成
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Join Class Modal */}
            {showJoinModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowJoinModal(false)}></div>
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-md z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="px-6 py-4 border-b border-gray-100">
                            <h3 className="text-lg font-medium text-gray-900">クラスに参加</h3>
                        </div>
                        <form onSubmit={handleJoinClass} className="p-6 space-y-4">
                            <div>
                                <p className="text-sm text-gray-600 mb-4">
                                    先生から伝えられたクラスコードを入力してください。
                                </p>
                                <label className="block text-sm font-medium text-gray-700 mb-1">クラスコード</label>
                                <input
                                    type="text"
                                    value={joinCode}
                                    onChange={(e) => setJoinCode(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                                    placeholder="例: abc-defg-hij"
                                    required
                                />
                            </div>
                            <div className="pt-4 flex justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => setShowJoinModal(false)}
                                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-50 rounded-md hover:bg-gray-100 focus:outline-none"
                                >
                                    キャンセル
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none"
                                    disabled={!joinCode}
                                >
                                    参加
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

