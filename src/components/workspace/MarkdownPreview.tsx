'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import 'github-markdown-css/github-markdown-dark.css';

interface MarkdownPreviewProps {
    content: string;
}

// .mdファイルの「プレビュー」モード表示。ワークスペース全体がVS Code風の
// ダークテーマ固定(ライト/ダーク切り替え機能自体が無い)なので、
// github-markdown-cssもダーク版(github-markdown-dark.css)を使う。
export function MarkdownPreview({ content }: MarkdownPreviewProps) {
    return (
        <div className="h-full min-h-0 overflow-y-auto bg-[#1e1e1e] px-6 py-4">
            <div className="markdown-body max-w-3xl mx-auto !bg-transparent">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
        </div>
    );
}
