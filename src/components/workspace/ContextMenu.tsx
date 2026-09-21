'use client';

import React, { useEffect, useLayoutEffect, useRef } from 'react';

export interface ContextMenuItem {
    label: string;
    onClick: () => void;
    danger?: boolean;
}

export interface ContextMenuState {
    x: number;
    y: number;
    items: ContextMenuItem[];
}

interface ContextMenuProps {
    state: ContextMenuState | null;
    onClose: () => void;
}

// VS Code風の右クリックメニュー。ファイルツリーの各行/背景から呼び出される
// (FileExplorerPane.tsx)。外側クリック・スクロール・Escapeで閉じる。
export function ContextMenu({ state, onClose }: ContextMenuProps) {
    const ref = useRef<HTMLDivElement>(null);

    // 描画直後(ペイント前)に実サイズを測り、画面端でメニューがはみ出す場合だけ
    // 位置を補正する。stateは開くたびに新しいオブジェクトなので、依存配列
    // [state]でメニューを開くたび(座標が同じでも)必ず再計算される。
    useLayoutEffect(() => {
        if (!state || !ref.current) return;
        const el = ref.current;
        el.style.left = `${state.x}px`;
        el.style.top = `${state.y}px`;

        const rect = el.getBoundingClientRect();
        let x = state.x;
        let y = state.y;
        if (x + rect.width > window.innerWidth) x = Math.max(0, window.innerWidth - rect.width - 4);
        if (y + rect.height > window.innerHeight) y = Math.max(0, window.innerHeight - rect.height - 4);
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
    }, [state]);

    useEffect(() => {
        if (!state) return;
        const handlePointerDown = (e: PointerEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        const handleDismiss = () => onClose();

        window.addEventListener('pointerdown', handlePointerDown, true);
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('scroll', handleDismiss, true);
        window.addEventListener('resize', handleDismiss);
        window.addEventListener('blur', handleDismiss);
        return () => {
            window.removeEventListener('pointerdown', handlePointerDown, true);
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('scroll', handleDismiss, true);
            window.removeEventListener('resize', handleDismiss);
            window.removeEventListener('blur', handleDismiss);
        };
    }, [state, onClose]);

    if (!state) return null;

    return (
        <div
            ref={ref}
            role="menu"
            style={{ position: 'fixed', top: state.y, left: state.x, zIndex: 10000 }}
            className="min-w-[170px] py-1 rounded-md bg-[#252526] border border-[#3c3c3c] shadow-2xl text-sm"
        >
            {state.items.map((item, i) => (
                <button
                    key={i}
                    role="menuitem"
                    onClick={() => {
                        onClose();
                        item.onClick();
                    }}
                    className={`w-full text-left px-3 py-1.5 transition-colors hover:bg-[#04395e] ${
                        item.danger ? 'text-[#f48771]' : 'text-[#cccccc]'
                    }`}
                >
                    {item.label}
                </button>
            ))}
        </div>
    );
}
