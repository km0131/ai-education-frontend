'use client';

import React, { useState } from 'react';
import { Icon } from './Icon';
import { ConfirmModal, ConfirmModalState } from './ConfirmModal';
import { ActiveFile } from './types';
import { securedFetch } from '@/src/lib/api';

interface ChatMessage {
    id: number;
    role: 'assistant' | 'user';
    text: string;
}

interface AiChatPaneProps {
    classId: string;
    activeFile: ActiveFile | null;
    // 適用したファイルが今エディタで開いているものと同じ場合、エディタの
    // バッファ(content/savedContent)を書き込んだ内容に合わせるためのコール
    // バック(WorkspaceLayoutが実装する - 適用後にエディタが古い内容の
    // ままになったり、「未保存の変更あり」表示が誤って残るのを防ぐ)。
    onFileApplied?: (path: string, content: string) => void;
}

let nextId = 1;

const INITIAL_MESSAGES: ChatMessage[] = [
    {
        id: nextId++,
        role: 'assistant',
        text: 'こんにちは！コードの書き方やエラーについて質問してください（※現在AI機能は準備中です）',
    },
];

// AIの返信文中の```lang:path\n...```というフェンス付きコードブロックを
// 「適用可能な提案」として扱う。pathがある場合のみ適用ボタンを出す
// (単なるサンプルコード提示にはpathを付けない想定)。
interface TextSegment {
    type: 'text';
    content: string;
}
interface CodeSegment {
    type: 'code';
    language: string;
    path: string | null;
    title: string;
    content: string;
}
type MessageSegment = TextSegment | CodeSegment;

const FENCE_RE = /```([^\n`]*)\n([\s\S]*?)```/g;

// コミットメッセージ「AI提案: ○○」の○○部分。コードブロック直前の説明文の
// 最後の行を短く使う - それが無ければパスから機械的に組み立てる。
function deriveTitle(precedingText: string, path: string | null): string {
    const lines = precedingText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    const last = lines[lines.length - 1];
    if (last) return last.length > 40 ? `${last.slice(0, 40)}…` : last;
    return path ? `${path} を更新` : 'コードを適用';
}

function parseMessageSegments(text: string): MessageSegment[] {
    const segments: MessageSegment[] = [];
    let lastIndex = 0;
    FENCE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = FENCE_RE.exec(text))) {
        const [full, info, code] = match;
        const precedingText = text.slice(lastIndex, match.index);
        if (precedingText.trim()) segments.push({ type: 'text', content: precedingText });

        const trimmedInfo = info.trim();
        const colonIdx = trimmedInfo.indexOf(':');
        const language = (colonIdx >= 0 ? trimmedInfo.slice(0, colonIdx) : trimmedInfo) || 'plaintext';
        const path = colonIdx >= 0 ? trimmedInfo.slice(colonIdx + 1).trim() || null : null;

        segments.push({
            type: 'code',
            language,
            path,
            title: deriveTitle(precedingText, path),
            content: code.replace(/\n$/, ''),
        });

        lastIndex = match.index + full.length;
    }
    const rest = text.slice(lastIndex);
    if (rest.trim() || segments.length === 0) segments.push({ type: 'text', content: rest });
    return segments;
}

// 言語ごとの行コメント記号。バックエンドのAI機能自体は未実装なので、デモ
// 提案は「今開いているファイルの先頭に説明コメントを1行足す」だけの安全な
// 変更にとどめる - コメント構文を知らない言語(json等)ではデモ自体を出さない。
function lineCommentPrefix(language: string): string | null {
    switch (language) {
        case 'python':
        case 'shell':
            return '#';
        case 'javascript':
        case 'typescript':
            return '//';
        default:
            return null;
    }
}

// バックエンド未実装のため見た目のみのダミー応答。実際の推論は行わないが、
// 「AI提案の適用→自動コミット」の一連の流れ自体は本物(実際にファイルへ
// 書き込み、実際にgit commitする)なので、今開いているファイルがある時だけ
// フェンス付きコードブロックで具体的な提案を返す(適用ボタンを試せるように)。
function buildDemoReply(activeFile: ActiveFile | null): string {
    const prefix = activeFile ? lineCommentPrefix(activeFile.language) : null;
    if (!activeFile || !prefix) {
        return 'ごめんなさい、AIアシスタント機能は現在準備中です。もうしばらくお待ちください🙏';
    }
    const suggestion = `${prefix} AI提案: ファイルの先頭に説明コメントを追加しました\n${activeFile.content}`;
    return [
        'ごめんなさい、AIアシスタント機能は現在準備中です。もうしばらくお待ちください🙏',
        `（デモ）今開いている ${activeFile.name} の先頭に説明コメントを追加する提案です。「適用」を押すと実際にファイルへ書き込み、自動でコミットされます:`,
        '```' + `${activeFile.language}:${activeFile.path}` + '\n' + suggestion + '\n```',
    ].join('\n\n');
}

type ApplyStatus =
    | { state: 'applying' }
    | { state: 'applied' }
    | { state: 'applied-nochange' }
    | { state: 'error'; message: string };

function CodeSuggestionBlock({
    segment,
    status,
    onApplyClick,
}: {
    segment: CodeSegment;
    status: ApplyStatus | undefined;
    onApplyClick: () => void;
}) {
    return (
        <div className="rounded-md border border-[#3c3c3c] overflow-hidden bg-[#1e1e1e]">
            <div className="flex items-center justify-between gap-2 px-2 py-1 bg-[#2d2d2d] border-b border-[#3c3c3c]">
                <span className="flex items-center gap-1 text-[10px] text-[#8a8a8a] truncate min-w-0">
                    <Icon name="file-code" />
                    <span className="truncate">{segment.path ?? segment.language}</span>
                </span>
                {segment.path && (
                    <button
                        onClick={onApplyClick}
                        disabled={status?.state === 'applying'}
                        title={`適用してコミット: AI提案: ${segment.title}`}
                        className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold text-white bg-[#0e639c] hover:bg-[#1177bb] disabled:opacity-40 transition-colors"
                    >
                        <Icon name="check" />
                        {status?.state === 'applying' ? '適用中...' : '適用'}
                    </button>
                )}
            </div>
            <pre className="px-2.5 py-2 text-[11px] leading-relaxed overflow-x-auto text-[#d4d4d4]">
                <code>{segment.content}</code>
            </pre>
            {status?.state === 'applied' && (
                <div className="px-2.5 pb-2 flex items-center gap-1 text-[10px] text-[#6a9955]">
                    <Icon name="check" /> 適用してコミットしました(AI提案: {segment.title})
                </div>
            )}
            {status?.state === 'applied-nochange' && (
                <div className="px-2.5 pb-2 flex items-center gap-1 text-[10px] text-[#8a8a8a]">
                    <Icon name="check" /> 適用しました(内容に変更がなかったためコミットは省略されました)
                </div>
            )}
            {status?.state === 'error' && (
                <div className="px-2.5 pb-2 flex items-center gap-1 text-[10px] text-[#f44747]">
                    <Icon name="warning" /> {status.message}
                </div>
            )}
        </div>
    );
}

export function AiChatPane({ classId, activeFile, onFileApplied }: AiChatPaneProps) {
    const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
    const [input, setInput] = useState('');
    const [applyState, setApplyState] = useState<Record<string, ApplyStatus>>({});
    const [confirmState, setConfirmState] = useState<ConfirmModalState | null>(null);

    const handleSend = () => {
        const text = input.trim();
        if (!text) return;

        setMessages((prev) => [...prev, { id: nextId++, role: 'user', text }]);
        setInput('');

        window.setTimeout(() => {
            setMessages((prev) => [...prev, { id: nextId++, role: 'assistant', text: buildDemoReply(activeFile) }]);
        }, 300);
    };

    // 提案の適用: 1) ファイルへ書き込み 2) 「AI提案: <title>」でコミット。
    // 2つの既存API(PATCH .../file, POST .../commit)を組み合わせるだけで、
    // 新しいバックエンドAPIは不要。
    const applySuggestion = async (key: string, segment: CodeSegment) => {
        if (!segment.path) return;
        setApplyState((prev) => ({ ...prev, [key]: { state: 'applying' } }));
        try {
            const writeRes = await securedFetch('/api/v2/program/container/file', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ course_id: Number(classId), path: segment.path, content: segment.content }),
            });
            const writeData = await writeRes.json().catch(() => ({}));
            if (!writeRes.ok) throw new Error(writeData.error || 'ファイルへの適用に失敗しました');

            const commitRes = await securedFetch('/api/v2/program/container/commit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ course_id: Number(classId), message: `AI提案: ${segment.title}` }),
            });
            const commitData = await commitRes.json().catch(() => ({}));
            // 409 = ErrNothingToCommit(書き込み内容が既存コミットと同一) -
            // 適用自体は成功しているので、エラーではなく「変更なし」として扱う。
            if (!commitRes.ok && commitRes.status !== 409) {
                throw new Error(commitData.error || 'コミットに失敗しました');
            }

            onFileApplied?.(segment.path, segment.content);
            setApplyState((prev) => ({
                ...prev,
                [key]: { state: commitRes.status === 409 ? 'applied-nochange' : 'applied' },
            }));
        } catch (err) {
            setApplyState((prev) => ({
                ...prev,
                [key]: { state: 'error', message: err instanceof Error ? err.message : '適用に失敗しました' },
            }));
        }
    };

    const handleApplyClick = (key: string, segment: CodeSegment) => {
        if (!segment.path) return;
        setConfirmState({
            title: 'AI提案を適用',
            message: `${segment.path} の内容を提案内容で上書きし、"AI提案: ${segment.title}" として自動でコミットします。よろしいですか？`,
            confirmLabel: '適用してコミット',
            onConfirm: () => {
                void applySuggestion(key, segment);
            },
        });
    };

    return (
        <div className="flex flex-col h-full min-h-0 bg-[#252526] border-l border-[#3c3c3c]">
            <div className="px-4 py-3 border-b border-[#3c3c3c] shrink-0">
                <h3 className="text-sm font-bold text-[#ffffff] flex items-center gap-1.5">
                    <Icon name="robot" />
                    AI Education Assistant
                </h3>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
                {messages.map((message) => (
                    <div
                        key={message.id}
                        className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                        <div
                            className={`max-w-[85%] min-w-0 rounded-lg px-3 py-2 text-xs leading-relaxed flex flex-col gap-1.5 ${
                                message.role === 'user'
                                    ? 'bg-[#007acc] text-white'
                                    : 'bg-[#3c3c3c] text-[#cccccc]'
                            }`}
                        >
                            {parseMessageSegments(message.text).map((segment, i) => {
                                const key = `${message.id}-${i}`;
                                return segment.type === 'text' ? (
                                    <span key={key} className="whitespace-pre-wrap">
                                        {segment.content}
                                    </span>
                                ) : (
                                    <CodeSuggestionBlock
                                        key={key}
                                        segment={segment}
                                        status={applyState[key]}
                                        onApplyClick={() => handleApplyClick(key, segment)}
                                    />
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>

            <div className="p-2.5 border-t border-[#3c3c3c] shrink-0">
                <div className="flex items-center gap-2">
                    <input
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSend();
                        }}
                        placeholder="質問を入力（準備中）"
                        className="flex-1 rounded-md bg-[#3c3c3c] text-[#ffffff] text-xs px-3 py-2 placeholder:text-[#8a8a8a] border border-[#3c3c3c] focus:outline-none focus:border-[#007acc]"
                    />
                    <button
                        onClick={handleSend}
                        className="px-3 py-2 rounded-md bg-[#007acc] hover:bg-[#0e8fdb] text-white text-xs font-bold transition-colors shrink-0"
                    >
                        送信
                    </button>
                </div>
            </div>

            <ConfirmModal state={confirmState} onClose={() => setConfirmState(null)} />
        </div>
    );
}
