'use client';

import React from 'react';

export type UploadStatus =
    | { type: 'loading'; message: string }
    | { type: 'success'; message: string }
    | { type: 'error'; message: string }
    | null;

interface UploadStatusModalProps {
    status: UploadStatus;
    onClose: () => void;
    /** 成功時にOKを押した際の追加処理(モーダルを閉じてフォームをリセットする等) */
    onSuccessConfirm?: () => void;
}

// 画像送信(AI作成・テストデータ登録など)の送信中/完了/失敗を知らせる共通モーダル。
// alert()の代わりにこれを使うことで、成功/失敗どちらの画面でもアプリのデザインに合わせた見た目になる。
// 送信は数分かかることがあるため、loading状態では閉じるボタンを出さずスピナーで「動いている」ことを伝える。
export function UploadStatusModal({ status, onClose, onSuccessConfirm }: UploadStatusModalProps) {
    if (!status) return null;
    const isLoading = status.type === 'loading';
    const isSuccess = status.type === 'success';

    const headerColor = isLoading ? 'bg-indigo-600' : isSuccess ? 'bg-emerald-500' : 'bg-red-500';
    const title = isLoading ? '送信中...' : isSuccess ? '送信完了！' : '送信に失敗しました';

    return (
        <div className="fixed inset-0 z-[200] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-sm rounded-[2.5rem] shadow-2xl border border-gray-100 overflow-hidden animate-in zoom-in-95 duration-300">
                <div className={`p-8 text-center ${headerColor}`}>
                    <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-white/20 flex items-center justify-center text-3xl">
                        {isLoading ? (
                            <span className="w-8 h-8 border-4 border-white/40 border-t-white rounded-full animate-spin" />
                        ) : isSuccess ? '✓' : '✕'}
                    </div>
                    <h3 className="text-xl font-black text-white tracking-wide">{title}</h3>
                </div>

                <div className="p-8 text-center">
                    <p className="text-slate-700 font-bold leading-relaxed whitespace-pre-wrap">
                        {status.message}
                    </p>
                    {isLoading && (
                        <p className="text-xs text-slate-400 font-bold mt-3">
                            画面を閉じずにこのままお待ちください
                        </p>
                    )}
                </div>

                {!isLoading && (
                    <div className="px-8 pb-8 flex gap-3">
                        <button
                            type="button"
                            onClick={() => {
                                if (isSuccess) onSuccessConfirm?.();
                                onClose();
                            }}
                            className={`flex-1 py-4 text-white font-black rounded-2xl active:scale-95 transition-all text-center ${
                                isSuccess
                                    ? 'bg-emerald-500 hover:bg-emerald-600 shadow-lg shadow-emerald-100'
                                    : 'bg-red-500 hover:bg-red-600 shadow-lg shadow-red-100'
                            }`}
                        >
                            {isSuccess ? 'OK' : 'とじる'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
