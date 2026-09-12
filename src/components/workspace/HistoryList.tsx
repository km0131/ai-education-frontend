'use client';

import React from 'react';
import { GitCommit } from './types';
import { Icon } from './Icon';

interface HistoryListProps {
    commits: GitCommit[];
    selectedHash: string | null;
    onSelect: (hash: string) => void;
}

// コミット履歴をタイムライン風に並べる一覧。クリックしたコミットのDiffを
// 右側(DiffViewer)に開く - 選択の実行と状態管理はHistoryPanelが持つ。
export function HistoryList({ commits, selectedHash, onSelect }: HistoryListProps) {
    if (commits.length === 0) {
        return <div className="px-3 py-4 text-xs text-[#8a8a8a]">まだ保存(コミット)された変更がありません</div>;
    }

    return (
        <div className="py-1">
            {commits.map((commit, index) => (
                <button
                    key={commit.hash}
                    onClick={() => onSelect(commit.hash)}
                    className={`w-full text-left px-3 py-2 border-l-2 transition-colors ${
                        commit.hash === selectedHash
                            ? 'bg-[#37373d] border-l-[#007acc]'
                            : 'border-l-transparent hover:bg-[#2a2d2e]'
                    }`}
                >
                    <div className="flex items-center gap-1.5 text-[11px] text-[#8a8a8a]">
                        <Icon name="git-commit" />
                        <span className="font-mono">{commit.hash}</span>
                        {index === 0 && (
                            <span className="px-1 rounded bg-[#0e639c]/50 text-[10px] text-[#e8f1f8]">最新</span>
                        )}
                    </div>
                    <div className="text-xs text-[#cccccc] truncate mt-0.5">{commit.message}</div>
                    <div className="text-[10px] text-[#8a8a8a] truncate mt-0.5">
                        {commit.author} ・ {commit.date}
                    </div>
                </button>
            ))}
        </div>
    );
}
