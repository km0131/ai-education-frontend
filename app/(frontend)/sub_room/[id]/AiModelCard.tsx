// components/room/AiModelCard.tsx
'use client';

import React from 'react';

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

interface AiModelCardProps {
    ai: AiModel;
    onSelect: (ai: AiModel) => void;
}

export const AiModelCard: React.FC<AiModelCardProps> = ({ ai, onSelect }) => {
    const isPending = ai.status === 'pending';
    const validTheme = ai.theme_color || 'indigo';

    const themeBg = {
        blue: 'bg-blue-600', green: 'bg-emerald-600', indigo: 'bg-indigo-600',
        purple: 'bg-purple-600', pink: 'bg-pink-600', orange: 'bg-orange-600'
    }[validTheme] || 'bg-indigo-600';

    return (
        <div
            onClick={() => onSelect(ai)}
            className="group bg-white rounded-3xl border border-gray-100 overflow-hidden hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 flex flex-col h-76 relative cursor-pointer"
        >
            {/* カードヘッダー */}
            <div className={`${themeBg} h-28 p-5 relative flex flex-col justify-between text-white`}>
                <h3 className="text-xl font-black truncate pr-16">{ai.title || "無題のAI"}</h3>
                <p className="text-xs font-bold opacity-90 truncate">作った人: {ai.student_name || "わからない"}</p>
            </div>

            {/* 作成者アイコン風バッジ */}
            <div className="absolute top-20 right-4 w-14 h-14 bg-white rounded-full p-1 shadow-md z-10">
                <div className={`${themeBg} w-full h-full rounded-full flex items-center justify-center text-white text-xl font-black opacity-95`}>
                    {ai.student_name ? ai.student_name.charAt(0) : 'A'}
                </div>
            </div>

            {/* コンテンツ */}
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

            {/* フッター情報 */}
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
                    onClick={(e) => {
                        e.stopPropagation();
                        console.log("即時テスト実行:", ai.project_uuid);
                    }}
                    className="px-3 py-1.5 bg-white border border-gray-200 shadow-sm rounded-xl text-xs font-black text-gray-600 hover:bg-gray-50 hover:text-indigo-600 transition-all relative z-30"
                >
                    テストする
                </button>
            </div>
        </div>
    );
};