'use client';

import React, { useState, useEffect } from 'react';
import { API_URL } from '@/src/lib/api';

// バックエンドから届くデータの型定義
interface CollapsedCategory {
    category_index: number;
    title: string;
    explanation: string;
}

interface ExplanationModalProps {
    isOpen: boolean;
    onClose: () => void;
    projectUuid: string; // 親から渡されるUUID
    categories: { category_index: number; title: string }[];
    onSave: (explanations: { [key: string]: string }, projectUuid: string) => Promise<void>;
    onUpdateLabel: () => Promise<void> | void;
}

export default function ExplanationModal({ isOpen, onClose,projectUuid, categories, onSave,onUpdateLabel }: ExplanationModalProps) {
    // 現在選択されているカテゴリのインデックス（初期値は最初のカテゴリ）
    const [activeTab, setActiveTab] = useState<number>(0);
    // 各カテゴリの説明文を保持するState（型: { [category_index]: "説明文" }）
    const [textValues, setTextValues] = useState<{ [key: number]: string }>({});
    const [isSaving, setIsSaving] = useState(false);
    const [mode, setMode] = useState<'explanation' | 'edit_labels'>('explanation');
    const [labelsLoading, setLabelsLoading] = useState<number | null>(null);
    const [localCategories, setLocalCategories] = useState(categories);
    const [successLabels, setSuccessLabels] = useState<number | null>(null);

    // カテゴリが渡されたら、Stateの初期枠を用意する
    useEffect(() => {
        if (isOpen && Array.isArray(categories)) {
            setLocalCategories(categories);
            const initialValues: { [key: number]: string } = {};
            categories.forEach(c => {
                // バックエンドから届いた explanation をセット（無ければ空文字）
                initialValues[c.category_index] = c.explanation || '';
            });
            setTextValues(initialValues);

            // 最初のタブを自動選択
            if (categories.length > 0) {
                setActiveTab(categories[0].category_index);
            }
        }
    }, [isOpen]);

    if (!isOpen || !categories || categories.length === 0) return null;

    // テキストエリアの入力をStateに反映
    const handleTextChange = (index: number, text: string) => {
        setTextValues((prev) => ({
            ...prev,
            [index]: text,
        }));
    };

    // 保存ボタンが押されたとき
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        try {
            await onSave(textValues,projectUuid);
            onClose(); // 成功したら閉じる
        } catch (err) {
            alert('せつめいのほぞんにしっぱいしました。');
        } finally {
            setIsSaving(false);
        }
    };

    const handleLabelRename = async (index: number, oldName: string, newName: string) => {
        setLabelsLoading(index);
        try {
            const savedToken = document.cookie
                .split('; ')
                .find(row => row.startsWith('auth_token='))
                ?.split('=')[1];

            const response = await fetch(`${API_URL}/api/v1/ai/up_label`, { // 💡 パスは環境に合わせて調整
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${savedToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    config_id: projectUuid,        // Go: ConfigID
                    old_label_name: oldName,       // Go: OldLabelName
                    new_label_name: newName.trim() // Go: NewLabelName
                }),
            });

            if (!response.ok) throw new Error('エラーが発生しました');

            // 🚀 変更点：レスポンスの件数をチェック
            const data = await response.json(); // JSONをパース

            // uplabelが定義されており、かつ1以上の数値であれば成功
            if (data && typeof data.uplabel === 'number' && data.uplabel > 0) {
                // 🚀 変更点：ローカルのデータを新しい名前に書き換えて画面を更新！
                setLocalCategories((prev) =>
                    prev.map((c) =>
                        c.title === oldName ? { ...c, title: newName.trim() } : c
                    )
                );

                if (onUpdateLabel) await onUpdateLabel(); // 親のデータも裏で更新

                setSuccessLabels(index);
                setTimeout(() => setSuccessLabels(null), 2000);
            } else {
                // 件数が0、または期待したキーが返ってこなかった場合
                throw new Error('更新されたデータがありませんでした');
            }
        } catch (err) {
            console.error(err);
            alert('ラベルのなまえ変更に失敗しました。');
        } finally {
            setLabelsLoading(null);
        }
    };

    // 現在選ばれているカテゴリのタイトルを取得
    const currentCategoryTitle = categories.find(c => c.category_index === activeTab)?.title || '';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-fade-in">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden border-4 border-[#e0f2fe]">

                {/* ヘッダー */}
                <div className="bg-[#f0f9ff] px-6 py-4 border-b-2 border-dashed border-[#e0f2fe] flex justify-between items-center">
                    <h3 className="text-xl font-bold text-[#0ea5e9] tracking-tight">
                        {mode === 'explanation' ? '📝 ラベルごとのせつめい' : '🏷️ ラベルのなまえをかえる'}
                    </h3>

                    {/* 🚀 変更箇所：モード切り替えボタンを追加 */}
                    {mode === 'explanation' ? (
                        <button
                            type="button"
                            onClick={() => setMode('edit_labels')}
                            className="text-xs font-black text-amber-800 bg-amber-100 hover:bg-amber-200 px-3 py-1.5 rounded-xl transition-all"
                        >
                            ✏️ なまえをかえる
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setMode('explanation')}
                            className="text-xs font-black text-[#0ea5e9] bg-sky-50 hover:bg-sky-100 px-3 py-1.5 rounded-xl transition-all"
                        >
                            ◀ せつめいにもどる
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 font-bold text-lg p-1"
                    >
                        ✖
                    </button>
                </div>

                {mode === 'explanation' && (
                    <>
                {/* ラベル切り替えタブ */}
                <div className="flex bg-slate-50 border-b border-slate-100 p-2 gap-2 overflow-x-auto">
                    {categories.map((cat) => (
                        <button
                            key={cat.category_index}
                            type="button"
                            onClick={() => setActiveTab(cat.category_index)}
                            className={`px-4 py-2 text-sm font-bold rounded-full transition-all whitespace-nowrap ${
                                activeTab === cat.category_index
                                    ? 'bg-[#0ea5e9] text-white shadow-md scale-105'
                                    : 'text-slate-500 hover:bg-slate-200'
                            }`}
                        >
                            🏷️ {cat.title}
                        </button>
                    ))}
                </div>

                {/* フォーム本体 */}
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block mb-2 text-sm font-semibold text-slate-600">
                            🌟 <span className="text-[#0ea5e9] font-bold">{currentCategoryTitle}</span> のせつめい文
                        </label>
                        <textarea
                            className="w-full h-40 px-4 py-3 text-base border-2 border-slate-200 rounded-2xl focus:border-[#38bdf8] focus:outline-none focus:ring-4 focus:ring-sky-100 transition-all resize-none"
                            placeholder={`${currentCategoryTitle}ってどんなもの？きづいたことや特徴を書いてみよう！`}
                            value={textValues[activeTab] || ''}
                            onChange={(e) => handleTextChange(activeTab, e.target.value)}
                            disabled={isSaving}
                        />
                    </div>

                    {/* ボタンエリア */}
                    <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-5 py-2.5 text-sm font-bold text-slate-500 rounded-full hover:bg-slate-100 transition-all"
                            disabled={isSaving}
                        >
                            やめる
                        </button>
                        <button
                            type="submit"
                            disabled={isSaving}
                            className="bg-[#34d399] hover:bg-[#10b981] text-white font-bold px-6 py-2.5 rounded-full transition-all transform hover:scale-105 shadow-md disabled:opacity-50 disabled:scale-100"
                        >
                            {isSaving ? 'ほぞん中...' : 'これにする！'}
                        </button>
                    </div>
                </form>
                    </>
                )}

                {/* --- 2. 🚀 追加箇所：ラベルのなまえ変更モードの画面 --- */}
                {mode === 'edit_labels' && (
                    <div className="p-6 space-y-4 overflow-y-auto max-h-[60vh]">
                        <p className="text-xs font-bold text-gray-400">
                            現在登録されているラベル名を入力して変更できます。（ボタンを押すとすぐに保存されます）
                        </p>
                        <div className="space-y-3">
                            {localCategories.map((cat, idx) => {
                                const label = cat.title;
                                const isLoading = labelsLoading === idx;
                                return (
                                    <form
                                        key={cat.category_index}
                                        onSubmit={async (e) => {
                                            e.preventDefault();
                                            const formData = new FormData(e.currentTarget);
                                            const newLabelName = formData.get(`new_label_${idx}`) as string;
                                            if (!newLabelName.trim() || newLabelName === label) return;

                                            // 💡 ここでバックエンドの更新処理を呼ぶ（前述のhandleUpdateLabelなど）
                                            await handleLabelRename(idx, label, newLabelName);
                                        }}
                                        className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-2xl hover:border-amber-300 transition-all"
                                    >
                                        <div className="flex items-center gap-1.5 min-w-[100px] max-w-[140px] truncate">
                                            <span className="text-sm">🏷️</span>
                                            <span className="text-sm font-black text-gray-700 truncate" title={label}>{label}</span>
                                        </div>
                                        <span className="text-gray-400 text-xs">▶</span>
                                        <input
                                            type="text"
                                            name={`new_label_${idx}`}
                                            defaultValue={label}
                                            disabled={isLoading}
                                            className="..."
                                            required
                                        />
                                        <button
                                            type="submit"
                                            disabled={isLoading}
                                            className="..."
                                        >
                                            {isLoading ? '保存中...' : '保存'}
                                        </button>
                                    </form>
                                );
                            })}
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
}