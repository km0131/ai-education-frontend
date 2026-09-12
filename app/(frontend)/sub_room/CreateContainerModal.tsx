'use client';

import React, { useState } from 'react';
import { securedFetch } from '@/src/lib/api';
import { UploadStatusModal, UploadStatus } from '@/src/components/UploadStatusModal';

interface CreateContainerModalProps {
    isOpen: boolean;
    onClose: () => void;
    classId: string;
    onSuccess: () => void;
}

export function CreateContainerModal({ isOpen, onClose, classId, onSuccess }: CreateContainerModalProps) {
    const [name, setName] = useState('');
    // 作成中/失敗はUploadStatusModal(送信系モーダルと共通のデザイン)で表示する。
    // 失敗時はこのモーダルを閉じずに背後に残し、生徒が名前を打ち直さずそのまま
    // 「もう一度試す」を押せるようにする(NextPlan.md フェーズ2「コンテナ起動
    // 失敗時のリトライ・ユーザー通知フローを設計」)。
    const [statusModal, setStatusModal] = useState<UploadStatus>(null);
    const isSubmitting = statusModal?.type === 'loading';

    if (!isOpen) return null;

    const handleClose = () => {
        setName('');
        setStatusModal(null);
        onClose();
    };

    const submitCreate = async () => {
        setStatusModal({ type: 'loading', message: '環境を作成しています...' });
        try {
            const res = await securedFetch('/api/v2/program/container/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ course_id: Number(classId), name }),
            });
            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                // retryableが明示的にfalseの時だけ再試行を隠す(未指定時は
                // 再試行を許可する側に倒す - バックエンドのclassifyStartError
                // と同じ方針)。
                const retryable = data.retryable !== false;
                setStatusModal({
                    type: 'error',
                    message: data.error || 'コンテナの作成に失敗しました',
                    ...(retryable ? { onRetry: submitCreate, retryLabel: 'もう一度試す' } : {}),
                });
                return;
            }

            setStatusModal(null);
            setName('');
            onSuccess();
            onClose();
        } catch (error) {
            setStatusModal({
                type: 'error',
                message: error instanceof Error ? error.message : 'コンテナの作成に失敗しました',
                onRetry: submitCreate,
                retryLabel: 'もう一度試す',
            });
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        submitCreate();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleClose}></div>
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md z-50 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100">
                    <h3 className="text-lg font-medium text-gray-900">コンテナを作成</h3>
                </div>
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">環境の名前</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            disabled={isSubmitting}
                            maxLength={100}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none text-black disabled:bg-gray-50 disabled:text-gray-400"
                            placeholder="例: 電卓アプリ作成用"
                            autoFocus
                        />
                    </div>

                    <div className="pt-4 flex justify-end gap-3">
                        <button
                            type="button"
                            onClick={handleClose}
                            disabled={isSubmitting}
                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-50 rounded-md hover:bg-gray-100 disabled:opacity-50"
                        >
                            キャンセル
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
                        >
                            作成
                        </button>
                    </div>
                </form>
            </div>

            {/* 作成中/失敗の通知(失敗時は「もう一度試す」でこのモーダルを閉じずに再送信できる) */}
            <UploadStatusModal status={statusModal} onClose={() => setStatusModal(null)} />
        </div>
    );
}
