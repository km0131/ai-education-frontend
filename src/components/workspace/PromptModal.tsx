'use client';

import React, { useEffect, useRef, useState } from 'react';

export interface PromptModalState {
    title: string;
    label: string;
    initialValue?: string;
    confirmLabel?: string;
    onSubmit: (value: string) => void;
}

interface PromptModalProps {
    state: PromptModalState | null;
    onClose: () => void;
}

// ファイル/フォルダ名の入力用モーダル(新規作成・名前変更で共用)。
// window.prompt()の代わりにワークスペースのVS Code風ダークテーマに合わせた
// 見た目で表示する。Enterで確定・Escapeまたは背景クリックで閉じる。
export function PromptModal({ state, onClose }: PromptModalProps) {
    const [value, setValue] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!state) return;
        setValue(state.initialValue ?? '');
    }, [state]);

    useEffect(() => {
        if (state) inputRef.current?.focus();
    }, [state]);

    if (!state) return null;

    const trimmed = value.trim();
    const canSubmit = trimmed.length > 0;

    const submit = () => {
        if (!canSubmit) return;
        state.onSubmit(trimmed);
        onClose();
    };

    return (
        <div
            className="fixed inset-0 z-[300] bg-black/50 flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label={state.title}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-sm rounded-lg bg-[#252526] border border-[#3c3c3c] shadow-2xl overflow-hidden"
            >
                <div className="px-4 py-3 border-b border-[#3c3c3c]">
                    <h3 className="text-sm font-bold text-[#cccccc]">{state.title}</h3>
                </div>

                <div className="px-4 py-4">
                    <label className="block text-xs text-[#8a8a8a] mb-1.5">{state.label}</label>
                    <input
                        ref={inputRef}
                        type="text"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                submit();
                            } else if (e.key === 'Escape') {
                                e.preventDefault();
                                onClose();
                            }
                        }}
                        className="w-full px-2.5 py-1.5 rounded-md bg-[#3c3c3c] text-[#cccccc] text-sm border border-[#5a5a5a] focus:outline-none focus:border-[#007acc]"
                    />
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
                        onClick={submit}
                        disabled={!canSubmit}
                        className="px-3 py-1.5 rounded-md text-xs font-bold text-white bg-[#0e639c] hover:bg-[#1177bb] disabled:opacity-40 disabled:hover:bg-[#0e639c] transition-colors"
                    >
                        {state.confirmLabel ?? 'OK'}
                    </button>
                </div>
            </div>
        </div>
    );
}
