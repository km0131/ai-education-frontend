'use client';

import React from 'react';

// --- 型定義 ---
type AiModel = {
    project_uuid: string;
    title?: string;
    [k: string]: any;
};

interface TrainModalsProps {
    // 確認モーダル用
    showConfirm: boolean;
    onCloseConfirm: () => void;
    targetAi: AiModel | null;
    onExecute: (ai: AiModel) => void;

    // 結果モーダル用
    showResult: boolean;
    onCloseResult: () => void;
    resultMessage: React.ReactNode;
}

export function TrainModals({
                                showConfirm,
                                onCloseConfirm,
                                targetAi,
                                onExecute,
                                showResult,
                                onCloseResult,
                                resultMessage,
                            }: TrainModalsProps) {
    return (
        <>
            {/* 🚀 学習開始の確認画面モーダル */}
            {showConfirm && targetAi && (
                <div className="fixed inset-0 z-[200] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-white w-full max-w-sm rounded-[2.5rem] shadow-2xl border border-gray-100 overflow-hidden animate-in zoom-in-95 duration-300">
                        <div className="bg-amber-500 p-6 text-white text-center">
                            <h3 className="text-xl font-black tracking-wide">AIの学習をはじめる？</h3>
                        </div>

                        <div className="p-8 text-center">
                            <p className="text-slate-700 font-bold leading-relaxed">
                                「<span className="text-indigo-600 font-black">{targetAi.title || '無題のAI'}</span>」<br />
                                の学習を開始してもいいですか？
                            </p>
                        </div>

                        <div className="px-8 pb-8 flex gap-3">
                            <button
                                type="button"
                                onClick={onCloseConfirm}
                                className="flex-1 py-4 bg-gray-100 hover:bg-gray-200 text-gray-600 font-black rounded-2xl transition-all text-center"
                            >
                                やめる
                            </button>
                            <button
                                type="button"
                                onClick={() => onExecute(targetAi)}
                                className="flex-1 py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-black rounded-2xl shadow-lg shadow-indigo-100 active:scale-95 transition-all text-center"
                            >
                                はじめる！
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 🚀 学習結果・時間案内モーダル */}
            {showResult && (
                <div className="fixed inset-0 z-[200] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-white w-full max-w-sm rounded-[2.5rem] shadow-2xl border border-gray-100 overflow-hidden animate-in zoom-in-95 duration-300">
                        <div className="bg-indigo-600 p-6 text-white text-center">
                            <h3 className="text-xl font-black tracking-wide">AI作成ステータス</h3>
                        </div>

                        <div className="p-8 text-center">
                            <p className="text-slate-700 font-bold leading-relaxed whitespace-pre-wrap">
                                {resultMessage}
                            </p>
                        </div>

                        <div className="px-8 pb-8">
                            <button
                                type="button"
                                onClick={onCloseResult}
                                className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-black rounded-2xl shadow-lg shadow-indigo-100 active:scale-95 transition-all text-center"
                            >
                                OK
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}