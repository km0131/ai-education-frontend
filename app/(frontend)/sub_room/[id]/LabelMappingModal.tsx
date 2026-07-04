'use client';

import React, { useState, useEffect } from 'react';
import { API_URL } from '@/src/lib/api';

interface LabelMappingModalProps {
    isOpen: boolean;
    onClose: () => void;
    projectUuid: string;
    categories: { category_index: number; title: string }[];
    // テスト画面に進むためのコールバック（メイン画面側で次のステップを呼ぶ）
    onStartAiTest: () => void;
    classId: string;
}

interface SavedMappingResponse {
    // 既存の登録データ型（例: [{ category_index: 2, test_label: "本殿" }]）
    mappings: { category_index: number; test_label: string }[];
}

export default function LabelMappingModal({
                                              isOpen,
                                              onClose,
                                              projectUuid,
                                              categories,
                                              onStartAiTest,
                                              classId
                                          }: LabelMappingModalProps) {
    const [testLabels, setTestLabels] = useState<string[]>([]);

    // DBに保存されている「初期状態」を保持するState（変更検知用）
    const [originalMapping, setOriginalMapping] = useState<{ [key: number]: string }>({});
    // 画面上でユーザーが選択中の状態を保持するState
    const [currentMapping, setCurrentMapping] = useState<{ [key: number]: string }>({});

    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [hasSavedAtLeastOnce, setHasSavedAtLeastOnce] = useState(false);

    // AIテスト実行中の状態（押した時間が返ってきたらここに保持する）
    const [executionTime, setExecutionTime] = useState<string | null>(null);
    const [isExecuting, setIsExecuting] = useState(false);

    // 1. データの一斉取得（テストラベル一覧 ＆ 既存の紐付け設定）
    useEffect(() => {
        const initModalData = async () => {
            if (!isOpen) return;
            setIsLoading(true);
            setExecutionTime(null);
            try {
                const savedToken = document.cookie
                    .split('; ')
                    .find(row => row.startsWith('auth_token='))
                    ?.split('=')[1];

                // テストラベル一覧を取得
                const labelRes = await fetch(`${API_URL}/api/v1/test/get_test_label`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${savedToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        course_id: Number(classId)
                    }),
                });
                const labelData = await labelRes.json();
                const fetchedTestLabels = Array.isArray(labelData?.labels) ? labelData.labels : [];
                setTestLabels(fetchedTestLabels);
                // 登録が既にあるか確認するAPIを叩く
                const mappingRes = await fetch(`${API_URL}/api/v1/test/get_test_label_map`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${savedToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        project_uuid: projectUuid
                    }),
                });
                const initialMap: { [key: number]: string } = {};
                // まずすべての生徒ラベルを空文字（空白）で初期化
                categories.forEach(cat => { initialMap[cat.category_index] = ''; });
                if (mappingRes.ok) {
                    const mappingData = await mappingRes.json();
                    console.log("=== デバッグ: モーダルが開いたときのデータ ===");
                    console.log("親から渡された生徒カテゴリ一覧:", categories);
                    console.log("APIから返ってきた紐付けデータ:", mappingData);

                    // 💡 実際の配列データを取得
                    const fetchedMappings = Array.isArray(mappingData?.labels)
                        ? mappingData.labels
                        : (Array.isArray(mappingData) ? mappingData : []);

                    if (fetchedMappings.length > 0) {
                        fetchedMappings.forEach((m: any) => {
                            // 💡 小文字の m.student_label_name で検索するよう修正
                            const targetCategory = categories.find(cat => cat.title === m.student_label_name);
                            console.log(`比較中... APIの生徒名: [${m.student_label_name}] -> 見つかったカテゴリ:`, targetCategory);
                            // 一致する生徒カテゴリが見つかった場合、そのcategory_indexに対して小文字の m.teacher_label_name をセット
                            if (targetCategory) {
                                initialMap[targetCategory.category_index] = m.teacher_label_name || '';
                            }
                        });
                        // すべてのカテゴリに紐付けが存在するかチェック
                        const isAllMapped = categories.every(cat => {
                            const value = initialMap[cat.category_index];
                            return value !== undefined && value !== '';
                        });

                        // すべて埋まっている場合のみ、テスト開始フラグを true にする
                        if (isAllMapped) {
                            setHasSavedAtLeastOnce(true);
                        } else {
                            setHasSavedAtLeastOnce(false); // 漏れがある場合は false に戻す
                        }
                    }
                    console.log("最終的にできあがった画面の初期値マップ:", initialMap);
                }
                // 変更検知用に、オリジナルとカレントの両方に同じ初期値をセット
                setOriginalMapping({ ...initialMap });
                setCurrentMapping({ ...initialMap });
            } catch (err) {
                console.error(err);
                alert('データの読み込みに失敗しました。');
            } finally {
                setIsLoading(false);
            }
        };

        initModalData();
    }, [isOpen, projectUuid, categories]);

    if (!isOpen) return null;

    // プルダウン変更時の検知
    const handleSelectChange = (categoryIndex: number, value: string) => {
        setCurrentMapping(prev => ({
            ...prev,
            [categoryIndex]: value
        }));
    };

    // 💡 フロント側での変更検知ロジック
    // originalMapping と currentMapping の中身を比較し、1箇所でも違えば true
    const isChanged = categories.some(
        cat => originalMapping[cat.category_index] !== currentMapping[cat.category_index]
    );

    // 保存処理（変更があった項目だけでなく、整合性を保つため現在のマッピング全体を送るのが一般的ですが、
    // ここでは仕様通り選択された生徒ラベルと先生（テスト）ラベルのペアとして送信します）
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isChanged) return; // 変更がなければ何もしない

        setIsSaving(true);
        try {
            const savedToken = document.cookie
                .split('; ')
                .find(row => row.startsWith('auth_token='))
                ?.split('=')[1];

            const response = await fetch(`${API_URL}/api/v1/test/up_test_label_map`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${savedToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    project_uuid: projectUuid,
                    course_id: Number(classId),
                    mappings: Object.entries(currentMapping)
                        .map(([index, testLabel]) => {
                            // 現在のインデックス(キー)に対応する生徒カテゴリ(categories)を探す
                            const category = categories.find(cat => cat.category_index === Number(index));

                            return {
                                // categories.title から生徒のラベル名を抽出してセット
                                student_label_name: category ? category.title : '',
                                teacher_label_name: testLabel // 選択された先生のテストラベル名
                            };
                        })
                        // 万が一、生徒ラベル名が空のデータは送信対象から除外する（ガード）
                        .filter(m => m.student_label_name !== '')
                }) // 👈 JSON.stringify の閉じ括弧
            });

            if (!response.ok) throw new Error('保存に失敗しました');

            alert('紐付けを保存しました！');
            // 保存成功時、現在の状態を「オリジナル」に昇格させて変更ボタンを非活性に戻す
            setOriginalMapping({ ...currentMapping });
            setHasSavedAtLeastOnce(true);
        } catch (err) {
            console.error(err);
            alert('紐付けの保存に失敗しました。');
        } finally {
            setIsSaving(false);
        }
    };

    // AIテスト実行ボタン押下時の処理
    // /test/execution を叩き、押した時間が返ってきたらその時間を表示、
    // 時間が無ければ「テスト開始」表示のまま次の画面へ進む
    const handleExecuteTest = async () => {
        setIsExecuting(true);
        try {
            const savedToken = document.cookie
                .split('; ')
                .find(row => row.startsWith('auth_token='))
                ?.split('=')[1];

            const response = await fetch(`${API_URL}/api/v1/test/execution`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${savedToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    project_uuid: projectUuid,
                    course_id: Number(classId)
                }),
            });

            const data = await response.json().catch(() => ({}));

            if (data?.time) {
                // 時間が返ってきた場合は、その時間を表示する
                setExecutionTime(new Date(data.time).toLocaleString('ja-JP'));
                return;
            }

            if (!response.ok) {
                alert(data?.error || 'テスト実行に失敗しました。');
                return;
            }

            // 時間が無い場合は「テスト開始」表示のまま次の画面へ
            setExecutionTime(null);
            onStartAiTest();
        } catch (err) {
            console.error(err);
            alert('テスト実行に失敗しました。');
        } finally {
            setIsExecuting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl overflow-hidden border-4 border-purple-100">

                {/* ヘッダー */}
                <div className="bg-purple-50 px-6 py-4 border-b-2 border-dashed border-purple-100 flex justify-between items-center">
                    <h3 className="text-xl font-bold text-purple-600 tracking-tight flex items-center gap-2">
                        🎯 テスト用ラベルとの紐付け
                    </h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 font-bold text-lg p-1">
                        ✖
                    </button>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="p-6 space-y-4 overflow-y-auto max-h-[50vh]">
                        <p className="text-xs font-bold text-slate-400 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                            💡 生徒のラベルに対応する、テスト用の正解ラベル（先生ラベル）を選んでください。
                        </p>

                        {isLoading ? (
                            <div className="py-10 text-center text-sm font-bold text-slate-400 animate-pulse">
                                ラベルデータを読み込み中...
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <div className="flex gap-4 px-3 text-xs font-black text-slate-400">
                                    <div className="w-1/2">👩‍💻 生徒のラベル</div>
                                    <div className="w-1/2">🤖 テスト用の正解ラベル（先生）</div>
                                </div>

                                {categories.map((cat) => (
                                    <div
                                        key={cat.category_index}
                                        className="flex items-center gap-4 p-3 bg-white border-2 border-slate-100 rounded-2xl hover:border-purple-200 transition-all shadow-sm"
                                    >
                                        <div className="w-1/2 flex items-center gap-2 truncate">
                                            <span className="text-base flex-shrink-0">🏷️</span>
                                            <span className="text-sm font-bold text-slate-700 truncate">
                                                {cat.title}
                                            </span>
                                        </div>

                                        <span className="text-slate-300 font-bold text-xs flex-shrink-0">▶</span>

                                        <div className="w-1/2">
                                            <select
                                                value={currentMapping[cat.category_index] || ''}
                                                onChange={(e) => handleSelectChange(cat.category_index, e.target.value)}
                                                className="w-full px-3 py-2 text-sm font-bold text-slate-800 bg-slate-50 border-2 border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-purple-400 transition-all cursor-pointer"
                                            >
                                                <option value="">-- 未紐付け（空白） --</option>
                                                {testLabels.map((testLabel) => (
                                                    <option key={testLabel} value={testLabel}>
                                                        {testLabel}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* 下部ボタンエリア 🚀 */}
                    <div className="flex justify-between items-center p-6 bg-slate-50 border-t border-slate-100">
                        {/* 左側：AIテスト開始ボタン（1度でも保存があれば活性化） */}
                        <div>
                            <button
                                type="button"
                                disabled={!hasSavedAtLeastOnce || isChanged || isExecuting}
                                onClick={handleExecuteTest}
                                className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 disabled:from-slate-200 disabled:to-slate-300 disabled:text-slate-400 text-white font-black px-5 py-2.5 rounded-full text-sm shadow-md hover:shadow-lg active:scale-95 transition-all"
                                title={isChanged ? "変更を保存したあとにテストができます" : "AIテストを実行します"}
                            >
                                {executionTime
                                    ? `⏱ ${executionTime} に実行中`
                                    : (isExecuting ? '実行中...' : '🚀 テスト開始')}
                            </button>
                        </div>

                        {/* 右側：キャンセル & 保存ボタン */}
                        <div className="flex gap-3">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-5 py-2.5 text-sm font-bold text-slate-500 rounded-full hover:bg-slate-100 transition-all"
                                disabled={isSaving}
                            >
                                閉じる
                            </button>
                            <button
                                type="submit"
                                // 💡 変更（isChanged）がなければボタンを押せない
                                disabled={!isChanged || isSaving}
                                className="bg-purple-500 hover:bg-purple-600 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold px-6 py-2.5 rounded-full shadow-md transition-all"
                            >
                                {isSaving ? '保存中...' : '紐付けを保存'}
                            </button>
                        </div>
                    </div>
                </form>

            </div>
        </div>
    );
}