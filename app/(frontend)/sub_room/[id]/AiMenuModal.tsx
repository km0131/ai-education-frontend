// components/room/AiMenuModal.tsx
'use client';

import React from 'react';

// メインコードで扱っている型と同じもの
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

interface AiMenuModalProps {
    project: AiModel | null;
    onClose: () => void;
    onAction: (actionType: string, ai: AiModel) => void;
}

export const AiMenuModal: React.FC<AiMenuModalProps> = ({ project, onClose, onAction }) => {
    if (!project) return null;

    // メニュー項目のデータ配列化（メンテナンスしやすくするため）
    const menuItems = [
        { type: 'train', icon: '🤖', title: 'AIの学習開始', desc: 'あつめた画像を使って新しく学習しなおすよ', bg: 'hover:bg-indigo-50 border-indigo-100/50 hover:border-indigo-200 text-indigo-900', iconBg: 'bg-indigo-50 group-hover:bg-indigo-100' },
        { type: 'play', icon: '🎮', title: 'AIを試す', desc: 'カメラや画像を使って、このAIの動きを体験してみよう', bg: 'hover:bg-sky-50 border-sky-100/50 hover:border-sky-200 text-sky-900', iconBg: 'bg-sky-50 group-hover:bg-sky-100' },
        { type: 'test', icon: '🎯', title: 'AIの性能テスト', desc: 'テスト用の画像を選んで、AIが正しく見分けられるか挑戦！', bg: 'hover:bg-rose-50 border-rose-100/50 hover:border-rose-200 text-rose-900', iconBg: 'bg-rose-50 group-hover:bg-rose-100' },
        { type: 'explanation', icon: '📝', title: '説明文の作成', desc: 'このAIモデルがどんなものか説明を追加する', bg: 'hover:bg-amber-50 border-amber-100/50 hover:border-amber-200 text-amber-900', iconBg: 'bg-amber-50 group-hover:bg-amber-100' },
        { type: 'view_images', icon: '🖼️', title: '登録画像を見る', desc: '各カテゴリに保存されている写真をチェックする', bg: 'hover:bg-blue-50 border-blue-100/50 hover:border-blue-200 text-blue-900', iconBg: 'bg-blue-50 group-hover:bg-blue-100' },
        { type: 'analytics', icon: '📊', title: 'AIの性能を表示', desc: '正解率のグラフやテスト分析結果をみる', bg: 'hover:bg-purple-50 border-purple-100/50 hover:border-purple-200 text-purple-900', iconBg: 'bg-purple-50 group-hover:bg-purple-100' },
        { type: 'certificate', icon: '🎓', title: '終了証書を出力', desc: 'AIを作り終えたがんばりの証明書を印刷する', bg: 'hover:bg-emerald-50 border-emerald-100/50 hover:border-emerald-200 text-emerald-900', iconBg: 'bg-emerald-50 group-hover:bg-emerald-100' },
    ];

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}></div>
            <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-md z-10 overflow-hidden animate-in zoom-in-95 duration-300 border border-gray-100">

                <div className="bg-indigo-600 p-6 flex justify-between items-center text-white">
                    <div>
                        <span className="text-xs font-bold text-indigo-200 uppercase tracking-wider">AIモデルメニュー</span>
                        <h3 className="text-xl font-black truncate max-w-[280px]">
                            {project.title}
                        </h3>
                    </div>
                    <button onClick={onClose} className="hover:bg-white/20 p-2 rounded-full transition-all text-xl">✕</button>
                </div>

                <div className="p-6 space-y-3 bg-gray-50/50 overflow-y-auto max-h-[70vh]">
                    {menuItems.map((item) => (
                        <button
                            key={item.type}
                            onClick={() => onAction(item.type, project)}
                            className={`w-full flex items-center gap-3.5 px-5 py-3 bg-white border-2 text-left group rounded-2xl transition-all shadow-sm ${item.bg}`}
                        >
                            <span className={`text-2xl p-2 rounded-xl transition-colors ${item.iconBg}`}>{item.icon}</span>
                            <div>
                                <p className="text-sm font-black">{item.title}</p>
                                <p className="text-[11px] font-medium mt-0.5 opacity-80">{item.desc}</p>
                            </div>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};