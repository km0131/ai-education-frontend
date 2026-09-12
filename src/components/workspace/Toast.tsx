'use client';

import React, { useEffect, useState } from 'react';
import { Icon } from './Icon';

interface ToastItem {
    id: number;
    message: string;
    // 同じdedupeKeyのトーストが既に表示中なら、新規追加せず既存のものを
    // そのまま(再表示タイマーだけ延長して)使う - LSPクラッシュ通知等、
    // 同じ原因で短時間に何度も発火し得るイベントの重複表示を防ぐため
    // (例: 同じ拡張子の言語サーバーを共有する複数タブが同時に諦めた場合)。
    dedupeKey?: string;
    durationMs: number;
}

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit() {
    for (const listener of listeners) listener(items);
}

function dismissToast(id: number) {
    items = items.filter((item) => item.id !== id);
    emit();
}

// エディタ機能の一部(LSPの補完等)が一時的に使えなくなったことを、モーダルや
// エラー画面を割り込ませずに軽く知らせるための最小限のトースト通知。
// 「編集自体は普通に続けられる」性質の通知向け(致命的エラーはalert()等の
// 既存パターンのまま使う - FileExplorerPaneの作成/削除失敗等)。
export function pushToast(message: string, options?: { dedupeKey?: string; durationMs?: number }): void {
    const durationMs = options?.durationMs ?? 6000;
    if (options?.dedupeKey) {
        const existing = items.find((item) => item.dedupeKey === options.dedupeKey);
        if (existing) return;
    }
    const id = nextId++;
    items = [...items, { id, message, dedupeKey: options?.dedupeKey, durationMs }];
    emit();
    window.setTimeout(() => dismissToast(id), durationMs);
}

function subscribe(listener: Listener): () => void {
    listeners.add(listener);
    listener(items);
    return () => listeners.delete(listener);
}

// WorkspaceLayoutに1つだけマウントする表示先。個別のpushToast呼び出し側
// (useLspDocument.ts等)は表示位置やスタイルを意識する必要が無い。
export function ToastHost() {
    const [visible, setVisible] = useState<ToastItem[]>([]);

    useEffect(() => subscribe(setVisible), []);

    if (visible.length === 0) return null;

    return (
        <div className="fixed bottom-4 right-4 z-[10000] flex flex-col gap-2 max-w-sm">
            {visible.map((item) => (
                <div
                    key={item.id}
                    className="flex items-start gap-2 px-3 py-2 rounded-md shadow-lg bg-[#2d2d2d] border border-[#3c3c3c] text-[#cccccc] text-xs"
                >
                    <Icon name="warning" className="text-[#cca700] shrink-0 mt-0.5" />
                    <span className="flex-1 leading-snug">{item.message}</span>
                    <button
                        type="button"
                        onClick={() => dismissToast(item.id)}
                        title="閉じる"
                        className="shrink-0 text-[#8a8a8a] hover:text-[#cccccc] transition-colors"
                    >
                        <Icon name="close" />
                    </button>
                </div>
            ))}
        </div>
    );
}
