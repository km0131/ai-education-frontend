'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, securedFetch } from '@/src/lib/api';
import Cookies from 'js-cookie';

export interface ClassRoom {
    id: string;            // 小文字の id
    title: string;         // 小文字
    description: string;   // 小文字
    teacher_name: string;  // 先生（ハイフンなし）
    student_count: number; // 生徒数
    invite_code: string;   // 招待コード
    theme_color: string;   // テーマカラー
    updata_time: string;   // ISO日時の文字列
}

export default function MainRoomPage() {
    const router = useRouter();
    const [token, setToken] = useState<string | null>(null);
    const [classes, setClasses] = useState<ClassRoom[]>([]);

    const [userName, setUserName] = useState<string>('');
    const [isTeacher, setIsTeacher] = useState<boolean>(false);

    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showJoinModal, setShowJoinModal] = useState(false);

    const [newClassName, setNewClassName] = useState('');
    const [newClassDesc, setNewClassDesc] = useState('');
    const [joinCode, setJoinCode] = useState('');

    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [createdClassCode, setCreatedClassCode] = useState('');

    const [showJoinSuccessModal, setShowJoinSuccessModal] = useState(false);
    const [joinSuccessMessage, setJoinSuccessMessage] = useState('');

    // 1. マウント時にクッキーからトークンを取得
    useEffect(() => {
        const savedToken = Cookies.get('auth_token');
        if (!savedToken) {
            router.push('/');
            return;
        }
        setToken(savedToken);
    }, [router]);

    // 1.5. バックエンドから最新のユーザー情報を取得
    useEffect(() => {
        if (!token) return;

        const fetchUserInfo = async () => {
            try {
                const res = await securedFetch('/api/v1/user');
                if (!res.ok) throw new Error('ユーザー情報の取得に失敗しました');
                const data = await res.json();

                if (data.UserName) setUserName(data.UserName);
                if (data.IsTeacher !== undefined) setIsTeacher(data.IsTeacher);
            } catch (error) {
                console.error('Failed to fetch user info:', error);
                Cookies.remove('auth_token');
                router.push('/');
            }
        };

        fetchUserInfo();
    }, [token, router]);

    // 2. クラス一覧取得
    useEffect(() => {
        if (!token) return;

        const fetchClasses = async () => {
            try {
                const res = await securedFetch('/api/v1/my_courses');
                if (!res.ok) throw new Error('クラス一覧の取得に失敗しました');
                const data = await res.json();

                if (data.status === 'success') {
                    const rawCourses = data.courses || [];
                    const rawStudentCourses = data.studentcourses || [];
                    const combined = [...rawCourses, ...rawStudentCourses];

                    // 🌟 APIから返ってきた本物のデータを正しくマッピングする
                    const mappedCourses: ClassRoom[] = combined.map((cls: any) => ({
                        id: String(cls.id),
                        title: cls.title || '無題のクラス',
                        description: cls.description || '',
                        teacher_name: cls.teacher_name || '担当の先生',
                        student_count: cls.student_count || 0,
                        invite_code: cls.invite_code || '',
                        theme_color: cls.theme_color || 'blue',
                        updata_time: cls.updata_time || '',
                    }));

                    setClasses(mappedCourses);
                }
            } catch (error) {
                console.error('Failed to fetch classes:', error);
            }
        };
        fetchClasses();
    }, [token]);

    // クラス作成
    const handleCreateClass = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!token) return;

        try {
            const res = await fetch(`${API_URL}/api/v1/create_class`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                    className: newClassName,
                    description: newClassDesc,
                }),
            });

            if (!res.ok) throw new Error('クラスの作成に失敗しました');
            const data = await res.json();

            if (res.status === 201 || data.message === "クラスを作成しました") {
                setCreatedClassCode(data.class_code || '---');
                setShowSuccessModal(true);

                // 🌟 小文字プロパティ＆本物のデータに合わせた即時反映
                const newCourse: ClassRoom = {
                    id: data.id ? String(data.id) : String(Date.now()),
                    title: newClassName,
                    description: newClassDesc,
                    teacher_name: userName ? userName.split('-')[0] : '担当の先生',
                    student_count: 0,
                    invite_code: data.class_code || '------',
                    theme_color: 'green',
                    updata_time: new Date().toISOString(),
                };

                setClasses((prev) => [newCourse, ...prev]);

                setNewClassName('');
                setNewClassDesc('');
                setShowCreateModal(false);
            }
        } catch (error) {
            console.error(error);
            alert('クラスの作成に失敗しました');
        }
    };

    // クラス参加
    const handleJoinClass = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!token) return;

        try {
            const res = await securedFetch('/api/v1/join_class', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({ inviteCode: joinCode })
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || '参加に失敗しました');
            }

            const data = await res.json();

            // 🌟 クラス参加時もフロント側で擬似カードを即時反映（リロード不要にする）
            const newJoinedCourse: ClassRoom = {
                id: data.course?.id ? String(data.course.id) : String(Date.now()),
                title: data.course?.title || `参加したクラス (${joinCode})`,
                description: data.course?.description || 'クラスに参加しました。授業内容を確認しましょう！',
                teacher_name: data.course?.teacher_name || '担当の先生',
                student_count: data.course?.student_count || 1,
                invite_code: joinCode,
                theme_color: 'blue',
                updata_time: new Date().toISOString(),
            };

            setClasses((prev) => [...prev, newJoinedCourse]);

            setJoinSuccessMessage(data.message || 'クラスに参加しました！');
            setShowJoinSuccessModal(true);

            setJoinCode('');
            setShowJoinModal(false);

        } catch (error: any) {
            console.error(error);
            alert(error.message || 'クラスに参加できませんでした。コードを確認してください。');
        }
    };

    const handleLogout = () => {
        Cookies.remove('auth_token');
        Cookies.remove('user_name');
        Cookies.remove('user_role');
        router.push('/');
    };

    if (!token) {
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
                                    ようこそ、{userName ? userName.split('-')[0] : '...'} さん
                                </div>
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

                    <div className="flex items-center gap-4">
                        <span className="text-xs px-3 py-1 bg-blue-50 text-blue-700 rounded-full font-medium border border-blue-100">
                            {isTeacher ? '先生' : '生徒'}
                        </span>

                        <div className="relative">
                            <button
                                onClick={() => setIsMenuOpen(!isMenuOpen)}
                                className="p-2 rounded-full hover:bg-gray-100 text-gray-600 transition-colors"
                            >
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                            </button>

                            {isMenuOpen && (
                                <>
                                    <div className="fixed inset-0 z-10" onClick={() => setIsMenuOpen(false)}></div>
                                    <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 z-20 border border-gray-100 origin-top-right">
                                        <button
                                            onClick={() => { setShowJoinModal(true); setIsMenuOpen(false); }}
                                            className="block w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 bg-white"
                                        >
                                            クラスに参加
                                        </button>
                                        {isTeacher && (
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

                        <div className="text-sm font-medium text-gray-700">{userName ? userName.split('-')[0] : ''}</div>
                    </div>
                </div>
            </header>

            {/* --- Main Content --- */}
            <main className="flex-1 w-full max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
                {!classes || classes.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-96 text-gray-500">
                        <p className="text-xl">クラスがありません</p>
                        <p className="text-sm mt-2">右上の「＋」ボタンからクラスを追加または参加してください</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {classes.map((cls) => {
                            const COLOR_MAP: Record<string, string> = {
                                blue: 'bg-blue-600',
                                emerald: 'bg-emerald-600',
                                amber: 'bg-amber-600',
                                indigo: 'bg-indigo-600',
                                rose: 'bg-rose-600',
                                green: 'bg-emerald-600',
                            };

                            let validTheme = COLOR_MAP[cls.theme_color];
                            if (!validTheme) {
                                const ALLOWED_COLORS = ['bg-blue-600', 'bg-emerald-600', 'bg-amber-600', 'bg-indigo-600', 'bg-rose-600'];
                                validTheme = ALLOWED_COLORS[
                                Math.abs(String(cls.id || '0').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % ALLOWED_COLORS.length
                                    ];
                            }
                            return (
                                <div
                                    key={cls.id}
                                    className="group bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-lg transition-all duration-200 flex flex-col h-76 cursor-pointer relative"
                                >
                                    <div
                                        onClick={async () => {
                                            try {
                                                // 🌟 securedFetch を使って、トークンやベースURLの記述を共通形式に統一
                                                const response = await securedFetch(`/api/v1/courses/${cls.id}`, {
                                                    method: 'GET',
                                                });

                                                // アクセス権がない、またはクラスが存在しない場合は弾く
                                                if (!response.ok) {
                                                    alert('このクラスへのアクセス権限がないか、存在しません。');
                                                    return;
                                                }

                                                // 認証が通ったら安全に動的ルートへ遷移
                                                const url = `/sub_room/${cls.id}`;
                                                console.log("セキュア遷移成功:", url);
                                                router.push(url);

                                            } catch (error) {
                                                console.error("遷移チェックエラー:", error);
                                                alert('通信エラーが発生しました。時間を置いてやり直してください。');
                                            }
                                        }}
                                        className="flex flex-col flex-1 cursor-pointer"
                                    >
                                        {/* 上部ヘッダー（クラス名と先生名のみですっきり配置） */}
                                        <div className={`${validTheme} h-28 p-5 relative flex flex-col justify-between`}>
                                            <div className="flex justify-between items-start">
                                                {/* pr-16 でアバターとの被りを防止、text-2xl で堂々と表示 */}
                                                <h2 className="text-2xl text-white font-bold hover:underline truncate pr-16">
                                                    {cls.title}
                                                </h2>
                                            </div>
                                            <div className="mb-1">
                                                <p className="text-white text-base hover:underline truncate font-medium">
                                                    {cls.teacher_name}
                                                </p>
                                            </div>
                                        </div>

                                        {/* 右上のアバター丸アイコン */}
                                        <div className="absolute top-20 right-4 w-16 h-16 bg-white rounded-full p-1 shadow-md z-10">
                                            <div className={`${validTheme} w-full h-full rounded-full flex items-center justify-center text-white text-2xl font-bold opacity-90`}>
                                                {cls.teacher_name ? cls.teacher_name.charAt(0) : 'A'}
                                            </div>
                                        </div>

                                        {/* クラスの説明文 */}
                                        <div className="p-5 pt-10 flex-1 flex flex-col justify-between">
                                            <p className="text-sm text-gray-600 line-clamp-3 leading-relaxed">
                                                {cls.description}
                                            </p>
                                        </div>
                                    </div>

                                    {/* 下部ステータス・ボタンエリア（人数、更新日時、フォルダを横一列に統合） */}
                                    <div className="px-5 py-3 border-t border-gray-100 flex justify-between items-center bg-gray-50/50 relative z-20">
                                        {/* 左側：引っ越してきた「人数」と「更新日時」を縦に並べる */}
                                        <div className="flex flex-col gap-0.5">
                                            {/* 🌟 生徒数をここに移動：小さめのグレーバッジ風にして文字をハッキリと表示 */}
                                            <div className="flex items-center gap-1.5 mb-0.5">
                                                <span className="text-xs bg-gray-200 text-gray-700 px-2 py-0.5 rounded-md font-bold">
                                                    生徒 {cls.student_count || 0}人
                                                </span>
                                            </div>

                                            {/* 更新日時 */}
                                            {cls.updata_time ? (
                                                <p className="text-[11px] text-gray-400 font-medium">
                                                    更新: {new Date(cls.updata_time).toLocaleDateString('ja-JP', {
                                                    month: '2-digit',
                                                    day: '2-digit',
                                                    hour: '2-digit',
                                                    minute: '2-digit'
                                                })}
                                                </p>
                                            ) : (
                                                <span className="text-[11px] text-gray-300">--/-- --:--</span>
                                            )}
                                        </div>

                                        {/* 右側：ワークフォルダボタン */}
                                        <div className="flex gap-1">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); }}
                                                className="p-2 text-gray-500 hover:bg-gray-200 rounded-full transition-colors bg-white border border-gray-100 shadow-sm"
                                                title="ワークフォルダを開く"
                                            >
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
                                                </svg>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </main>

            {/* --- Modals --- */}
            {showCreateModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowCreateModal(false)}></div>
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-md z-50 overflow-hidden">
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
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none text-black"
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
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none text-black"
                                    placeholder="例: 微分積分の基礎"
                                />
                            </div>
                            <div className="pt-4 flex justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => setShowCreateModal(false)}
                                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-50 rounded-md hover:bg-gray-100"
                                >
                                    キャンセル
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
                                    disabled={!newClassName}
                                >
                                    作成
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {showJoinModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowJoinModal(false)}></div>
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-md z-50 overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-100">
                            <h3 className="text-lg font-medium text-gray-900">クラスに参加</h3>
                        </div>
                        <form onSubmit={handleJoinClass} className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">クラスコード</label>
                                <input
                                    type="text"
                                    value={joinCode}
                                    onChange={(e) => setJoinCode(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none text-black"
                                    placeholder="例: abc-defg-hij"
                                    required
                                />
                            </div>
                            <div className="pt-4 flex justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => setShowJoinModal(false)}
                                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-50 rounded-md hover:bg-gray-100"
                                >
                                    キャンセル
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
                                    disabled={!joinCode}
                                >
                                    参加
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* --- クラス作成成功モーダル --- */}
            {showSuccessModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowSuccessModal(false)}></div>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md z-50 overflow-hidden transform transition-all animate-in fade-in zoom-in-95 duration-200">
                        <div className="p-6 text-center">
                            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-emerald-100 mb-4">
                                <svg className="h-6 w-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                            </div>

                            <h3 className="text-xl font-bold text-gray-900 mb-2">クラスを作成しました！</h3>
                            <p className="text-sm text-gray-500 mb-6">生徒に以下の招待コードを共有してください。</p>

                            <div className="bg-gray-50 rounded-xl p-4 border border-gray-100 flex items-center justify-between gap-3 mb-6">
                                <span className="font-mono text-2xl font-bold tracking-wider text-gray-800 select-all mx-auto pl-6">
                                    {createdClassCode}
                                </span>
                                <button
                                    onClick={() => navigator.clipboard.writeText(createdClassCode)}
                                    className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                    title="コードをコピー"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                                    </svg>
                                </button>
                            </div>

                            <button
                                type="button"
                                onClick={() => setShowSuccessModal(false)}
                                className="w-full py-3 px-4 bg-gray-900 hover:bg-gray-800 text-white font-medium rounded-xl transition-colors shadow-sm text-sm"
                            >
                                画面を閉じる
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- クラス参加成功モーダル --- */}
            {showJoinSuccessModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowJoinSuccessModal(false)}></div>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md z-50 overflow-hidden transform transition-all animate-in fade-in zoom-in-95 duration-200">
                        <div className="p-6 text-center">
                            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-blue-100 mb-4">
                                <svg className="h-6 w-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                            </div>

                            <h3 className="text-xl font-bold text-gray-900 mb-2">クラスに参加しました！</h3>
                            <p className="text-sm text-gray-500 mb-6">
                                {joinSuccessMessage}
                            </p>

                            <button
                                type="button"
                                onClick={() => setShowJoinSuccessModal(false)}
                                className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-colors shadow-sm text-sm"
                            >
                                ダッシュボードへ進む
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

