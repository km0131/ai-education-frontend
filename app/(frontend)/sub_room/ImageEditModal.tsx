import React, { useState, useEffect } from 'react';
import { API_URL } from '@/src/lib/api';
import { buildUploadImageFiles } from '@/src/lib/imageResize';
import { processSelectedFiles } from '@/src/lib/heicConvert';
import { watchConversionStatus, UploadedPhotoInfo } from '@/src/lib/conversionStatus';
import VirtualizedPhotoGrid from '@/src/components/VirtualizedPhotoGrid';

// バックエンドのデータ構造に合わせた型定義
interface PhotoInfo {
    id: number;
    path: string;
}

interface CategoryPhotos {
    title: string;
    category_index: number;
    photos: PhotoInfo[];
}

interface ImageEditModalProps {
    isOpen: boolean;
    onClose: () => void;
    configId: string; // 対象プロジェクトのUUID (upload_session_id に割り当て)
    classId: string;  // リンク（params.id）から取得したクラスID
    projectTitle: string;
}

export const ImageEditModal: React.FC<ImageEditModalProps> = ({
                                                                  isOpen,
                                                                  onClose,
                                                                  configId,
                                                                  classId, // 親から受け取る
                                                                  projectTitle
                                                              }) => {
    const [categoryMap, setCategoryMap] = useState<Record<string, CategoryPhotos>>({});
    const [loading, setLoading] = useState(false);

    // 1. 画像データの取得処理（独立）
    const fetchImages = async () => {
        setLoading(true);
        try {
            const savedToken = document.cookie
                .split('; ')
                .find(row => row.startsWith('auth_token='))
                ?.split('=')[1];

            const res = await fetch(`${API_URL}/api/v1/ai/image_acquisition`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${savedToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    project_id: configId
                }),
            });

            if (res.ok) {
                const resBody = await res.json();
                console.log("APIレスポンスの生データ:", resBody);

                let actualData = resBody;
                if (resBody && typeof resBody === 'object' && 'data' in resBody) {
                    actualData = resBody.data;
                }

                console.log("categoryMapに最終セットするデータ:", actualData);
                setCategoryMap(actualData || {});
            } else {
                console.error('画像の取得に失敗しました。ステータス:', res.status);
            }
        } catch (err) {
            console.error('Failed to fetch images:', err);
        } finally {
            setLoading(false);
        }
    };

    // 2. 画像の即座追加処理（独立＆正しいエンドポイント）
    // 2. 画像の即座追加 (Upload)
    const handleAddImage = async (
        categoryId: string, // 1始まりの数値文字列 ("1", "2")
        categoryTitle: string, // 「ご本殿」や「牛」
        e: React.ChangeEvent<HTMLInputElement>
    ) => {
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

        const savedToken = document.cookie
            .split('; ')
            .find(row => row.startsWith('auth_token='))
            ?.split('=')[1];

        const { original, resized } = await buildUploadImageFiles(file);

        const formData = new FormData();
        // 🚀 Goの ImageUploadRequest 構造体に完全適合
        formData.append('course_id', classId);               // クラスID（数値の文字列）
        formData.append('category_id', categoryId);         // カテゴリID（1始まりの数値の文字列）
        formData.append('category_title', categoryTitle);     // ラベル名（「ご本殿」や「牛」）
        formData.append('title', projectTitle);              // 🔥【修正】現在のAIカードのタイトル
        formData.append('upload_session_id', configId);      // プロジェクトのUUID文字列
        formData.append('file', original);
        if (resized) formData.append('resized_file', resized);

        try {
            const res = await fetch(`${API_URL}/api/v1/ai/image_updated`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${savedToken}` },
                body: formData,
            });

            if (res.ok) {
                const data = await res.json().catch(() => null) as { photo?: UploadedPhotoInfo } | null;
                const uploaded = data?.photo;
                if (uploaded?.ConversionStatus === 'processing' && uploaded.ID) {
                    watchConversionStatus(`${API_URL}/api/v1/ai/photo_status`, savedToken, [{ photoId: uploaded.ID, fileName: file.name }], (fileName, reason) => {
                        console.warn(`[conversionStatus] ${fileName}: ${reason}`);
                        alert(`${fileName}: サーバー側での画像変換に失敗しました(${reason})。この画像は学習データに含まれていない可能性があります。`);
                    });
                }
                fetchImages();
            } else {
                const errorData = await res.json().catch(() => ({}));
                const prefix = errorData.filename ? `${errorData.filename}: ` : '';
                alert(`画像の追加に失敗しました: ${prefix}${errorData.error || 'サーバーエラー'}`);
            }
        } catch (err) {
            alert('通信エラーが発生しました');
        }
    };

    // 3. 初回読み込みの監視
    useEffect(() => {
        if (isOpen && configId) {
            fetchImages();
        }
    }, [isOpen, configId]);

    // 3. 画像の即座削除 (Delete)
    const handleDeleteImage = async (photoId: number) => {
        if (!confirm('この画像を削除してもよろしいですか？')) return;
        const savedToken = document.cookie
            .split('; ')
            .find(row => row.startsWith('auth_token='))
            ?.split('=')[1];

        try {
            const res = await fetch(`${API_URL}/api/v1/ai/delete_image`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${savedToken}` },
                body: JSON.stringify({
                    photo_id: photoId ,
                    project_id: configId
                }),
            });

            if (res.ok) {
                fetchImages();
            } else {
                alert('画像の削除に失敗しました');
            }
        } catch (err) {
            alert('通信エラーが発生しました');
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="w-full max-w-4xl max-h-[85vh] bg-white rounded-2xl shadow-xl flex flex-col overflow-hidden">

                {/* ヘッダー */}
                <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                    <div>
                        <h3 className="text-lg font-bold text-gray-800">登録画像・ラベルの編集</h3>
                        <p className="text-xs text-gray-400 mt-0.5">画像の追加・削除は即座に反映されます</p>
                    </div>
                    <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 transition-colors">
                        ✕
                    </button>
                </div>

                {/* メインコンテンツエリア */}
                <div className="flex-1 overflow-y-auto p-6 space-y-8">
                    {loading && Object.keys(categoryMap).length === 0 ? (
                        <div className="text-center py-12 text-sm text-gray-400">読み込み中...</div>
                    ) : Object.keys(categoryMap).length === 0 ? (
                        <div className="text-center py-12 text-sm text-gray-400">カテゴリデータがありません</div>
                    ) : (
                        Object.entries(categoryMap).map(([titleKey, category]) => {
                            // "data" というキー自体がループに紛れ込んだ場合のスキップガード
                            if (titleKey === 'data' || !category || typeof category !== 'object') return null;

                            // 🚀 バックエンドが uint で待っている「category_index」を文字列にしてターゲットにする
                            const backendCategoryId = category.category_index?.toString() || "1";
                            const displayTitle = category.title || titleKey;
                            const photosList = category.photos || [];

                            return (
                                <div key={titleKey} className="border border-gray-100 rounded-xl p-5 bg-white shadow-sm space-y-4">

                                    {/* タイトルヘッダー */}
                                    <div className="flex justify-between items-center border-b border-gray-50 pb-2">
                                        <div className="flex items-center gap-2">
                                            <span className="px-2.5 py-1 bg-indigo-50 text-indigo-600 text-xs font-bold rounded-md">ラベル</span>
                                            <h4 className="text-base font-bold text-gray-800">{displayTitle}</h4>
                                            <span className="text-xs text-gray-400">({photosList.length}枚)</span>
                                        </div>

                                        {/* 即座追加用のインプット */}
                                        <label className="cursor-pointer px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1 shadow-sm">
                                            <span>📷 画像を追加</span>
                                            <input
                                                type="file"
                                                accept="image/*,.heic,.heif,.cr2,.cr3"
                                                className="hidden"
                                                /* 🚀 本物の category_index を含む backendCategoryId を渡す */
                                                onChange={(e) => handleAddImage(backendCategoryId, displayTitle, e)}
                                            />
                                        </label>
                                    </div>

                                    {/* 画像グリッド(仮想スクロール: grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-4 相当) */}
                                    <VirtualizedPhotoGrid
                                        items={photosList
                                            .filter((photo) => photo && photo.path)
                                            .map((photo) => ({
                                                id: photo.id,
                                                url: photo.path.startsWith('http')
                                                    ? photo.path
                                                    : `${API_URL.replace(/\/$/, '')}/${photo.path.replace(/^\//, '')}`,
                                                alt: displayTitle,
                                            }))}
                                        columns={{ base: 2, sm: 4, md: 5 }}
                                        gap={16}
                                        onDelete={handleDeleteImage}
                                        fallbackImageUrl="https://placehold.co/150?text=No+Image"
                                        emptyMessage="画像が登録されていません。"
                                    />

                                </div>
                            );
                        })
                    )}
                </div>

                {/* フッター */}
                <div className="px-6 py-4 border-t border-gray-100 flex justify-end bg-gray-50/30">
                    <button onClick={onClose} className="px-5 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm font-bold rounded-xl transition-colors">
                        閉じる
                    </button>
                </div>

            </div>
        </div>
    );
};