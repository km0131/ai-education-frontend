'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { securedFetch } from '@/src/lib/api';
import { GitCommit, GitCommitDiff } from './types';
import { HistoryList } from './HistoryList';
import { DiffViewer, DiffViewState } from './DiffViewer';
import { ConfirmModal, ConfirmModalState } from './ConfirmModal';
import { Icon } from './Icon';

interface HistoryPanelProps {
    classId: string;
    // onMutated/refreshSignal: WorkspaceLayoutのworkspace-refresh同期の一部
    // (Sidebar.tsx参照)。onMutatedは巻き戻し成功時に'git'として呼ぶ。
    onMutated?: (reason: 'git' | 'file' | 'publish') => void;
    refreshSignal?: number;
}

type CommitsState =
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; items: GitCommit[] };

// 「変更履歴」タブ本体。コミット一覧(HistoryList)・選択中コミットのDiff
// (DiffViewer)・巻き戻し(RevertButton、DiffViewer内)を束ねるコンテナで、
// データ取得とAPI呼び出しはすべてここに集約する。
export function HistoryPanel({ classId, onMutated, refreshSignal }: HistoryPanelProps) {
    const [commitsState, setCommitsState] = useState<CommitsState>({ status: 'loading' });
    const [selectedHash, setSelectedHash] = useState<string | null>(null);
    const [diffState, setDiffState] = useState<DiffViewState>({ status: 'idle' });
    const [confirmState, setConfirmState] = useState<ConfirmModalState | null>(null);
    const [isReverting, setIsReverting] = useState(false);
    const [revertResult, setRevertResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const loadHistory = useCallback(async () => {
        setCommitsState({ status: 'loading' });
        try {
            const params = new URLSearchParams({ course_id: classId });
            const res = await securedFetch(`/api/v2/sandbox/git/history?${params.toString()}`, { method: 'GET' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || '変更履歴の取得に失敗しました');
            setCommitsState({ status: 'ready', items: Array.isArray(data.commits) ? data.commits : [] });
        } catch (err) {
            setCommitsState({
                status: 'error',
                message: err instanceof Error ? err.message : '変更履歴の取得に失敗しました',
            });
        }
    }, [classId]);

    useEffect(() => {
        loadHistory();
    }, [loadHistory]);

    // refreshSignal: 相手側(講師/生徒)の操作によるworkspace-refresh受信時に
    // 履歴一覧を再取得する。初回マウント分は上のloadHistory効果と重複する
    // のでスキップする。
    const isFirstRefreshSignal = useRef(true);
    useEffect(() => {
        if (isFirstRefreshSignal.current) {
            isFirstRefreshSignal.current = false;
            return;
        }
        loadHistory();
    }, [refreshSignal, loadHistory]);

    const loadDiff = useCallback(
        async (hash: string, path?: string) => {
            setDiffState({ status: 'loading' });
            try {
                const params = new URLSearchParams({ course_id: classId });
                if (path) params.set('path', path);
                const res = await securedFetch(`/api/v2/sandbox/git/diff/${encodeURIComponent(hash)}?${params.toString()}`, {
                    method: 'GET',
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || '差分の取得に失敗しました');
                setDiffState({ status: 'ready', diff: data as GitCommitDiff });
            } catch (err) {
                setDiffState({
                    status: 'error',
                    message: err instanceof Error ? err.message : '差分の取得に失敗しました',
                });
            }
        },
        [classId],
    );

    const handleSelectCommit = useCallback(
        (hash: string) => {
            setSelectedHash(hash);
            setRevertResult(null);
            loadDiff(hash);
        },
        [loadDiff],
    );

    const handleSelectFile = useCallback(
        (path: string) => {
            if (!selectedHash) return;
            loadDiff(selectedHash, path);
        },
        [selectedHash, loadDiff],
    );

    // 「この状態に巻き戻す」。確認ダイアログで承認された後にAPIを呼び、成功
    // したら履歴一覧を再取得する(巻き戻し自体が新しいコミットとして追加
    // されるため、リストの先頭に増えているはず)。
    const handleRevertRequest = useCallback(() => {
        if (!selectedHash) return;
        setConfirmState({
            title: 'この状態に巻き戻す',
            message: '現在の作業内容が上書きされますがよろしいですか？',
            confirmLabel: '巻き戻す',
            danger: true,
            onConfirm: async () => {
                setIsReverting(true);
                setRevertResult(null);
                try {
                    const res = await securedFetch('/api/v2/sandbox/git/revert', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ course_id: Number(classId), commit_hash: selectedHash }),
                    });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) throw new Error(data.error || '巻き戻しに失敗しました');
                    setRevertResult({ type: 'success', text: '指定した状態に戻しました' });
                    await loadHistory();
                    onMutated?.('git');
                } catch (err) {
                    setRevertResult({
                        type: 'error',
                        text: err instanceof Error ? err.message : '巻き戻しに失敗しました',
                    });
                } finally {
                    setIsReverting(false);
                }
            },
        });
    }, [selectedHash, classId, loadHistory, onMutated]);

    return (
        <div className="flex h-full min-h-0 text-[#cccccc]">
            <div className="w-64 shrink-0 border-r border-[#3c3c3c] min-h-0 flex flex-col">
                <div className="px-3 py-2 text-[11px] font-bold tracking-wider text-[#bbbbbb] uppercase shrink-0 flex items-center justify-between">
                    <span>変更履歴</span>
                    <button title="更新" onClick={loadHistory} className="text-[#cccccc] hover:text-white">
                        <Icon name="refresh" />
                    </button>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto">
                    {commitsState.status === 'loading' && (
                        <div className="px-3 py-4 text-xs text-[#8a8a8a]">読み込み中...</div>
                    )}
                    {commitsState.status === 'error' && (
                        <div className="px-3 py-4 text-xs text-[#f44747] flex items-center gap-1.5">
                            <Icon name="warning" /> {commitsState.message}
                        </div>
                    )}
                    {commitsState.status === 'ready' && (
                        <HistoryList
                            commits={commitsState.items}
                            selectedHash={selectedHash}
                            onSelect={handleSelectCommit}
                        />
                    )}
                </div>
            </div>

            <div className="flex-1 min-h-0 flex flex-col">
                <DiffViewer
                    state={diffState}
                    onSelectFile={handleSelectFile}
                    onRevertRequest={handleRevertRequest}
                    isReverting={isReverting}
                    revertResult={revertResult}
                />
            </div>

            <ConfirmModal state={confirmState} onClose={() => setConfirmState(null)} />
        </div>
    );
}
