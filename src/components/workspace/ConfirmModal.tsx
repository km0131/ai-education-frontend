'use client';

import React, { useEffect } from 'react';

export interface ConfirmModalState {
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
}

interface ConfirmModalProps {
    state: ConfirmModalState | null;
    onClose: () => void;
}

// 削除などの破壊的操作向けの確認モーダル。window.confirm()の代わりに
// ワークスペースのVS Code風ダークテーマに合わせた見た目で表示する。
// Escapeまたは背景クリックでキャンセル扱い。
export function ConfirmModal({ state, onClose }: ConfirmModalProps) {
    useEffect(() => {
        if (!state) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [state, onClose]);

    if (!state) return null;

    return (
        <div
            className="fixed inset-0 z-[300] bg-black/50 flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div
                role="alertdialog"
                aria-modal="true"
                aria-label={state.title}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-sm rounded-lg bg-[#252526] border border-[#3c3c3c] shadow-2xl overflow-hidden"
            >
                <div className="px-4 py-3 border-b border-[#3c3c3c]">
                    <h3 className="text-sm font-bold text-[#cccccc]">{state.title}</h3>
                </div>

                <div className="px-4 py-4">
                    <p className="text-sm text-[#cccccc] leading-relaxed whitespace-pre-wrap">{state.message}</p>
                </div>

                <div className="px-4 pb-4 flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-3 py-1.5 rounded-md text-xs font-bold text-[#cccccc] bg-[#3c3c3c] hover:bg-[#4a4a4a] transition-colors"
                    >
                        キャンセル
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            state.onConfirm();
                            onClose();
                        }}
                        className={`px-3 py-1.5 rounded-md text-xs font-bold text-white transition-colors ${
                            state.danger ? 'bg-[#a1260d] hover:bg-[#c42b0e]' : 'bg-[#0e639c] hover:bg-[#1177bb]'
                        }`}
                    >
                        {state.confirmLabel ?? '削除'}
                    </button>
                </div>
            </div>
        </div>
    );
}
