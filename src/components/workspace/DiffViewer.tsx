'use client';

import React from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { GitCommitDiff, GitDiffFileStatus, languageFromFileName } from './types';
import { Icon } from './Icon';
import { RevertButton } from './RevertButton';

export type DiffViewState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; diff: GitCommitDiff };

interface DiffViewerProps {
    state: DiffViewState;
    onSelectFile: (path: string) => void;
    onRevertRequest: () => void;
    isReverting: boolean;
    revertResult: { type: 'success' | 'error'; text: string } | null;
}

const STATUS_LABEL: Record<GitDiffFileStatus, string> = {
    added: 'A',
    modified: 'M',
    deleted: 'D',
    renamed: 'R',
    copied: 'C',
};

const STATUS_COLOR: Record<GitDiffFileStatus, string> = {
    added: 'text-[#6a9955]',
    modified: 'text-[#e2c08d]',
    deleted: 'text-[#f44747]',
    renamed: 'text-[#569cd6]',
    copied: 'text-[#569cd6]',
};

// 選択中コミットのDiffをMonacoのDiffEditorで表示する。Diffの取得元は
// GitCommitDiff.original/modified(バックエンドが変更前後の全文をそのまま
// 返す)なので、unified diffテキストをここでパースする必要はない。
export function DiffViewer({ state, onSelectFile, onRevertRequest, isReverting, revertResult }: DiffViewerProps) {
    if (state.status === 'idle') {
        return (
            <div className="flex-1 flex items-center justify-center text-sm text-[#8a8a8a]">
                左の一覧からコミットを選択してください
            </div>
        );
    }
    if (state.status === 'loading') {
        return (
            <div className="flex-1 flex items-center justify-center text-sm text-[#8a8a8a]">
                差分を読み込んでいます...
            </div>
        );
    }
    if (state.status === 'error') {
        return (
            <div className="flex-1 flex items-center justify-center gap-2 text-sm text-[#f44747] font-bold">
                <Icon name="warning" /> {state.message}
            </div>
        );
    }

    const { diff } = state;

    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="px-4 py-3 border-b border-[#3c3c3c] shrink-0 flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <div className="text-sm font-bold text-white truncate">{diff.commit.message}</div>
                    <div className="text-[11px] text-[#8a8a8a] mt-0.5">
                        <span className="font-mono">{diff.commit.hash}</span> ・ {diff.commit.author} ・ {diff.commit.date}
                    </div>
                </div>
                <RevertButton onClick={onRevertRequest} isReverting={isReverting} />
            </div>

            {revertResult && (
                <div
                    className={`px-4 py-2 text-xs font-bold border-b border-[#3c3c3c] shrink-0 flex items-center gap-1.5 ${
                        revertResult.type === 'success' ? 'text-[#6a9955]' : 'text-[#f44747]'
                    }`}
                >
                    <Icon name={revertResult.type === 'success' ? 'check' : 'warning'} /> {revertResult.text}
                </div>
            )}

            {diff.files.length > 1 && (
                <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[#3c3c3c] shrink-0 overflow-x-auto">
                    {diff.files.map((file) => (
                        <button
                            key={file.path}
                            onClick={() => onSelectFile(file.path)}
                            title={file.path}
                            className={`shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors ${
                                file.path === diff.selected_path
                                    ? 'bg-[#37373d] text-white'
                                    : 'text-[#cccccc] hover:bg-[#2a2d2e]'
                            }`}
                        >
                            <span className={`font-mono font-bold ${STATUS_COLOR[file.status]}`}>
                                {STATUS_LABEL[file.status]}
                            </span>
                            <span className="truncate max-w-[160px]">{file.path}</span>
                        </button>
                    ))}
                </div>
            )}

            <div className="flex-1 min-h-0">
                {diff.selected_path ? (
                    <DiffEditor
                        key={`${diff.commit.hash}:${diff.selected_path}`}
                        height="100%"
                        language={languageFromFileName(diff.selected_path)}
                        original={diff.original}
                        modified={diff.modified}
                        theme="vs-dark"
                        options={{
                            readOnly: true,
                            renderSideBySide: true,
                            minimap: { enabled: false },
                            fontSize: 13,
                            scrollBeyondLastLine: false,
                        }}
                    />
                ) : (
                    <div className="h-full flex items-center justify-center text-sm text-[#8a8a8a]">
                        このコミットには変更されたファイルがありません
                    </div>
                )}
            </div>
        </div>
    );
}
