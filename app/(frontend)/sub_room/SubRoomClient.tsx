'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { API_URL, securedFetch } from '@/src/lib/api';
import Cookies from 'js-cookie';
import { AiMenuModal } from './AiMenuModal';
import { TrainModals } from './TrainModals';
import { AiModelCard } from './AiModelCard';
import ExplanationModal from './ExplanationModal';
import { CreateAiModal } from './CreateAiModal';
import { ImageEditModal } from './ImageEditModal';
import { ManageTestModal } from './UploadingTestImage';
import LabelMappingModal from './LabelMappingModal';
import { AiResultModal } from './AiResultModal';
import { CertificateModal } from './CertificateModal';
import { CollapsedCategory } from './ExplanationModal';

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
    const searchParams = useSearchParams();

    const [className, setClassName] = useState<string>('読み込み中...');
    const [inviteCode, setInviteCode] = useState<string>('');
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isAiModalOpen, setIsAiModalOpen] = useState(false);

    const [aiModels, setAiModels] = useState<AiModel[]>([]);
    const [isLoadingAi, setIsLoadingAi] = useState(true);
    const [token, setToken] = useState<string | null>(null);
    const [aiSets, setAiSets] = useState<AiSet[]>([
        {name: '', images: [], previewUrls: []}
    ]);
    const [aiProjectTitle, setAiProjectTitle] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [userInfo, setUserInfo] = useState<{ name: string; role: 'teacher' | 'student' | string } | null>(null);
    const [selectedProject, setSelectedProject] = useState<AiModel | null>(null);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [targetAiModel, setTargetAiModel] = useState<AiModel | null>(null);
    const [showTrainResult, setShowTrainResult] = useState(false);
    const [trainResultMessage, setTrainResultMessage] = useState<React.ReactNode>('');
    const [isExplanationModalOpen, setIsExplanationModalOpen] = useState(false);
    const [collapsedCategories, setCollapsedCategories] = useState<CollapsedCategory[]>([]);
    const [isImageEditModalOpen, setIsImageEditModalOpen] = useState(false);
    const [isTestModalOpen, setIsTestModalOpen] = useState(false);
    const [isMappingModalOpen, setIsMappingModalOpen] = useState(false);
    const [isResultModalOpen, setIsResultModalOpen] = useState(false);
    const [isCertificateModalOpen, setIsCertificateModalOpen] = useState(false);
    const [selectedProjectUuid, setSelectedProjectUuid] = useState<string>('');
    const [currentCategories, setCurrentCategories] = useState<{ category_index: number; title: string }[]>([]);

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
        const classId = searchParams.get('id');
        if (!classId) return;

        const fetchRoomData = async () => {
            setIsLoadingAi(true);
            try {
                // ① クラス情報の取得
                const courseRes = await securedFetch(`/api/v1/courses/${classId}`, {method: 'GET'});
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
                const userRes = await securedFetch('/api/v1/user', {method: 'GET'});
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
                    body: JSON.stringify({course_id: Number(classId)}),
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
    }, [searchParams, router]);

    const classId = searchParams.get('id');
    if (!classId) {
        return <div className="min-h-screen bg-gray-50 flex items-center justify-center">読み込み中...</div>;
    }

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
        setAiSets([{name: '', images: [], previewUrls: []}]);
        setIsAiModalOpen(false);
    };

    const handleAddSet = () => {
        setAiSets(prev => [...prev, {name: '', images: [], previewUrls: []}]);
    };

    const handleRemoveSet = (index: number) => {
        if (aiSets.length > 1) {
            // 削除されるセットのプレビューURLを解放
            aiSets[index].previewUrls.forEach(url => URL.revokeObjectURL(url));
            setAiSets(prev => prev.filter((_, i) => i !== index));
        }
    };

    const handleSetFieldChange = (index: number, field: keyof AiSet, value: string) => {
        setAiSets(prev => prev.map((set, i) => i === index ? {...set, [field]: value} : set));
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

        if (!aiProjectTitle) {
            alert('プロジェクトタイトルを入力してください');
            return;
        }

        const isValid = aiSets.every(set => set.name && set.images.length > 0);
        if (!isValid) {
            alert('すべてのカテゴリに名前と画像を1枚以上入れてください');
            return;
        }

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
                        headers: {'Authorization': `Bearer ${savedToken}`},
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

            alert('すべての画像データの送信が完了しました！');
            handleCloseAiModal();
            router.refresh();
        } catch (error: any) {
            console.error(error);
            alert(`エラーが発生しました: ${error.message || '送信失敗'}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    const executeTraining = async (ai: AiModel) => {
        setShowConfirmModal(false);

        try {
            const savedToken = Cookies.get('auth_token');

            const trainPromise = fetch(`${API_URL}/api/v1/ai/ai_creation`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${savedToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    project_id: ai.project_uuid
                }),
            }).then(async (res) => {
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    // エラーの時はステータスコードに関わらず、
                    // オブジェクトを文字列にして catch 側に引き渡す
                    throw new Error(JSON.stringify(data));
                }
                return data; // 正常時はデータをそのまま返す
            });
            const result = await trainPromise;
            // 正常に作成が開始された場合
            setTrainResultMessage(
                <span>
                    ✨ <strong className="text-indigo-600 text-lg">AIの作成をはじめたよ！</strong><br/>
                    かんりょうするまで、すこし待っててね。
                </span>
            );
            setShowTrainResult(true);
            // ステータスを即時準備中に変えて画面をリフレッシュ
            setAiModels(prev => prev.map(m =>
                m.project_uuid === ai.project_uuid ? {...m, status: 'pending'} : m
            ));
            router.refresh();
        } catch (error: unknown) {
            console.error("[Error] AI Training Error:", error);
            let displayMessage: React.ReactNode = '通信に失敗しました。';

            if (error instanceof Error) {
                try {
                    const parsed = JSON.parse(error.message);
                    // すでに作成中で、時間が返ってきた場合
                    if (parsed.time) {
                        displayMessage = (
                            <span>
                                すでにAIを作成中だよ！<br/>
                                （<strong className="text-indigo-600 text-lg">{parsed.time}</strong> にボタンが押されたよ）
                            </span>
                        );
                    } else {
                        // 時間が空、またはその他のエラーメッセージの場合
                        displayMessage = parsed.error || 'AIの作成を開始しました！';
                    }
                } catch {
                    displayMessage = error.message;
                }
            }
            setTrainResultMessage(displayMessage);
            setShowTrainResult(true);
        }
    };

    const handleStartAiTestExecution = () => {
        setIsMappingModalOpen(false);
    };

    const getDescription = async (projectUuid: string) => {
        const savedToken = Cookies.get("auth_token");

        const res = await fetch(`${API_URL}/api/v1/ai/get_description`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${savedToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                project_id: projectUuid,
            }),
        });

        if (!res.ok) {
            throw new Error("取得失敗");
        }

        const data = await res.json();

        if (Array.isArray(data)) return data;
        if (Array.isArray(data.label)) return data.label;

        const key = Object.keys(data).find(k => Array.isArray(data[k]));
        return key ? data[key] : [];

    };

        // メニューアクションの統合ハンドリング
        const handleMenuAction = async (actionType: string, ai: AiModel) => {
            setSelectedProject(null);

            switch (actionType) {
                case 'train':
                    console.log("AIの学習を開始:", ai.project_uuid);// 🚀 カスタム確認画面を開くための状態セット
                    setTargetAiModel(ai);
                    setShowConfirmModal(true);
                    break;
                case 'play':
                    router.push(`/ai/play?id=${ai.project_uuid}`);
                    break;
                case 'test':
                    console.log("AIの性能テスト画面へ:", ai.project_uuid);
                    setSelectedProjectUuid(ai.project_uuid);
                    setTargetAiModel(ai);
                    setSelectedProject(null); // メニューを閉じる

                    // 生徒ラベル情報を取得してモーダルを開く
                    try {
                        const categories = await getDescription(ai.project_uuid);
                        setCurrentCategories(categories);
                        setIsMappingModalOpen(true);
                    } catch (e) {
                        console.error(e);
                    }
                    break;
                case 'explanation':
                    console.log("説明文の作成:", ai.project_uuid);
                    setTargetAiModel(ai);
                    setSelectedProject(null);
                    try {
                        const categories = await getDescription(ai.project_uuid);
                        setCollapsedCategories(categories);
                        setIsExplanationModalOpen(true);
                    } catch (e) {
                        console.error(e);
                    }
                    break;
                case 'view_images':
                    console.log("登録画像を見る:", ai.project_uuid);
                    setTargetAiModel(ai); // 対象のAIモデルをターゲットにセット
                    setIsImageEditModalOpen(true); // モーダルを開く
                    break;
                case 'analytics':
                    console.log("AIの性能を表示:", ai.project_uuid);
                    setTargetAiModel(ai);
                    setIsResultModalOpen(true);
                    break;
                case 'certificate':
                    console.log("終了証書を出力:", ai.project_uuid);
                    setTargetAiModel(ai);
                    setIsCertificateModalOpen(true);
                    break;
                default:
                    console.warn("未知のアクションタイプ:", actionType);
            }
        };


        return (
            <div className="min-h-screen bg-gray-50 flex flex-col">
                {/* Header */}
                {/* Header */}
                <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
                    <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                        {/* 左側セクション: サイドバーボタン、クラス名、先生用コントロール */}
                        <div className="flex items-center gap-4">
                            <button onClick={() => setIsSidebarOpen(true)}
                                    className="p-2 hover:bg-gray-100 rounded-full text-gray-600 transition-colors">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                          d="M4 6h16M4 12h16M4 18h16"/>
                                </svg>
                            </button>
                            <div className="flex items-center gap-4">
                                <h1 className="text-2xl font-bold text-gray-800 tracking-tight">{className}</h1>

                                {/* 🚀 先生ロール用の制御ブロック（Fragmentで並列要素を包む） */}
                                {userInfo?.role === 'teacher' && inviteCode && (
                                    <>
                                        {/* 参加コードバッジ */}
                                        <div
                                            className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 px-3 py-1 rounded-xl shadow-sm">
                                            <span
                                                className="text-[11px] font-black text-amber-700 tracking-wider uppercase">参加コード:</span>
                                            <span
                                                className="font-mono text-base font-black text-amber-900 tracking-widest bg-white px-2 py-0.5 rounded-lg border border-amber-100 select-all">
                                {inviteCode}
                            </span>
                                        </div>

                                        {/* テストデータ管理モーダルを開くボタン */}
                                        <button
                                            onClick={() => setIsTestModalOpen(true)}
                                            className="bg-amber-600 hover:bg-amber-700 text-white font-black text-xs px-4 py-2 rounded-xl shadow-sm hover:shadow active:scale-95 transition-all flex items-center gap-1"
                                        >
                                            <span>⚙️</span> テストデータ管理
                                        </button>

                                        {/* 管理用モーダル本体 */}
                                        <ManageTestModal
                                            isOpen={isTestModalOpen}
                                            onClose={() => setIsTestModalOpen(false)}
                                            classId={classId}
                                            onSuccess={() => {
                                                console.log('テストデータが更新されました');
                                            }}
                                        />
                                    </>
                                )}
                            </div>
                        </div>

                        {/* 右側セクション: AI作成ボタン & ユーザー情報 */}
                        <div className="flex items-center gap-5">
                            <button
                                onClick={() => setIsAiModalOpen(true)}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold text-sm shadow-md transition-all flex items-center gap-1.5"
                            >
                                <span>✨ AIを新しく作る</span>
                            </button>
                            <div className="h-6 w-[1px] bg-gray-200"/>
                            <div className="flex items-center gap-3">
                                {userInfo ? (
                                    <>
                                        {userInfo.role === 'teacher' ? (
                                            <span
                                                className="text-xs px-2.5 py-1 bg-amber-50 text-amber-700 rounded-md font-bold border border-amber-100">先生</span>
                                        ) : (
                                            <span
                                                className="text-xs px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-md font-bold border border-indigo-100">生徒</span>
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
                        <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm"
                             onClick={() => setIsSidebarOpen(false)}></div>
                        <div className="fixed inset-y-0 left-0 z-[110] w-64 bg-white shadow-2xl p-6">
                            <h2 className="text-xl font-black mb-8">メニュー</h2>
                            <div className="space-y-4">
                                <Link href="/main_room"
                                      className="block p-4 hover:bg-indigo-50 rounded-2xl font-bold">ホーム</Link>
                                <button onClick={() => {
                                    router.push('/');
                                }}
                                        className="block w-full text-left p-4 hover:bg-red-50 text-red-500 rounded-2xl font-bold">ログアウト
                                </button>
                            </div>
                        </div>
                    </>
                )}


                <CreateAiModal
                    isOpen={isAiModalOpen}
                    onClose={() => setIsAiModalOpen(false)}
                    classId={classId}
                    onSuccess={() => router.refresh()}
                />

                {/* Main Content */}
                <main className="flex-1 max-w-7xl mx-auto w-full p-6">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-bold text-gray-700">みんなが作ったAIモデル</h2>
                    </div>

                    {isLoadingAi ? (
                        <div
                            className="text-center py-20 text-gray-400 font-medium animate-pulse">AIモデルを読み込んでいます...</div>
                    ) : aiModels.length === 0 ? (
                        <div
                            className="bg-white border-2 border-dashed border-gray-200 rounded-[2rem] p-16 text-center max-w-xl mx-auto mt-10">
                            <p className="text-gray-500 font-bold mb-4 text-lg">まだこのクラスにAIモデルがありません</p>
                            <p className="text-sm text-gray-400 mb-6">右上のボタンから最初のAIを作ってみましょう！</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                            {aiModels.map((ai) => (
                                <AiModelCard
                                    key={ai.project_uuid}
                                    ai={ai}
                                    onSelect={(selectedAi) => setSelectedProject(selectedAi)}
                                    onPlay={(selectedAi) => handleMenuAction('play', selectedAi)}
                                />
                            ))}
                        </div>
                    )}
                </main>

                {/* AI操作メニューモーダル */}
                <AiMenuModal
                    project={selectedProject}
                    onClose={() => setSelectedProject(null)}
                    onAction={handleMenuAction}
                />

                {/* 🚀 切り出した学習関係のモーダル一式 */}
                <TrainModals
                    showConfirm={showConfirmModal}
                    onCloseConfirm={() => {
                        setShowConfirmModal(false);
                        setTargetAiModel(null);
                    }}
                    targetAi={targetAiModel}
                    onExecute={executeTraining}
                    showResult={showTrainResult}
                    onCloseResult={() => setShowTrainResult(false)}
                    resultMessage={trainResultMessage}
                />

                {/* ラベル別説明文作成モーダル */}
                <ExplanationModal
                    isOpen={isExplanationModalOpen}
                    onClose={() => {
                        setIsExplanationModalOpen(false);
                        setTargetAiModel(null); // クリーンアップ
                    }}
                    projectUuid={targetAiModel?.project_uuid || ''}
                    categories={collapsedCategories}
                    onSave={async (explanations, projectUuid) => {
                        try {
                            const savedToken = Cookies.get('auth_token');

                            // Go側の map[int]string に完全に合わせるため、キーを数値に変換したオブジェクトを作る
                            const formattedExplanations: { [key: number]: string } = {};
                            Object.keys(explanations).forEach((key) => {
                                formattedExplanations[Number(key)] = explanations[key];
                            });

                            console.log("送信するデータ:", {
                                project_id: projectUuid,
                                explanations: formattedExplanations
                            });

                            const res = await fetch(`${API_URL}/api/v1/ai/create_description`, {
                                method: 'PUT',
                                headers: {
                                    'Authorization': `Bearer ${savedToken}`,
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({
                                    // 退避させておいた targetAiModel の UUID を指定
                                    project_id: projectUuid,
                                    explanations: formattedExplanations
                                })
                            });

                            // 200 OK 以外はエラーへ飛ばす
                            if (!res.ok) {
                                const errorData = await res.json().catch(() => ({}));
                                throw new Error(errorData.error || '保存に失敗しました');
                            }

                            setIsExplanationModalOpen(false);
                            setTrainResultMessage(
                                <span>
                                    ✨ <strong
                                    className="text-indigo-600 text-lg">すべてのせつめい文をほぞんしたよ！</strong><br/>
                                    ばっちり記録されました。
                                </span>
                            );
                            setShowTrainResult(true);

                            // 保存が成功したら、画面側のモデル一覧（一覧のデータ）もリフレッシュする
                            router.refresh();

                        } catch (error: any) {
                            console.error("[Error] 説明文保存失敗:", error);
                            setIsExplanationModalOpen(false);
                            setTrainResultMessage(
                                <span>
                                ❌ <strong className="text-red-600 text-lg">ほぞんにしっぱいしました</strong><br/>
                                    {error.message || '通信環境をたしかめて、もういちど試してみてね。'}
                            </span>
                            );
                            setShowTrainResult(true);

                            throw error;
                        } finally {
                            setTargetAiModel(null); // クリーンアップ
                        }
                    }}
                    onUpdateLabel={async () => {
                        if (!targetAiModel?.project_uuid) return;
                        try {
                            const categories = await getDescription(targetAiModel.project_uuid);
                            setCollapsedCategories(categories);
                        } catch (e) {
                            console.error(e);
                        }
                    }}
                />

                {/* 🆕 登録画像・ラベルの編集モーダル */}
                <ImageEditModal
                    isOpen={isImageEditModalOpen}
                    onClose={() => {
                        setIsImageEditModalOpen(false);
                        setTargetAiModel(null); // クリーンアップ
                    }}
                    configId={targetAiModel?.project_uuid || ''}
                    classId={classId}
                    projectTitle={targetAiModel?.title || '無題のAI'}
                />
                {/* 🆕 テストラベル紐付けモーダル */}
                <LabelMappingModal
                    isOpen={isMappingModalOpen}
                    onClose={() => {
                        setIsMappingModalOpen(false);
                        setTargetAiModel(null);
                    }}
                    projectUuid={selectedProjectUuid}
                    categories={currentCategories}
                    onStartAiTest={handleStartAiTestExecution}
                    classId={classId}
                />

                {/* 🆕 AIの性能表示モーダル */}
                <AiResultModal
                    isOpen={isResultModalOpen}
                    onClose={() => {
                        setIsResultModalOpen(false);
                        setTargetAiModel(null);
                    }}
                    projectUuid={targetAiModel?.project_uuid || ''}
                    projectTitle={targetAiModel?.title || '無題のAI'}
                />

                {/* 🆕 終了証書モーダル */}
                <CertificateModal
                    isOpen={isCertificateModalOpen}
                    onClose={() => {
                        setIsCertificateModalOpen(false);
                        setTargetAiModel(null);
                    }}
                    projectUuid={targetAiModel?.project_uuid || ''}
                    classId={classId}
                    studentName={targetAiModel?.student_name || ''}
                    projectTitle={targetAiModel?.title || '無題のAI'}
                    courseName={className}
                    updatedAt={targetAiModel?.updated_at}
                />
            </div>
        );
}