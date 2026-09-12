'use client';

import React, { useCallback } from 'react';

interface ResizeHandleProps {
    // 'x': 左右にドラッグして幅を変える境界線 / 'y': 上下にドラッグして高さを変える境界線
    axis: 'x' | 'y';
    onResize: (delta: number) => void;
}

// VS Code風の各ペイン境界線。ドラッグ中はwindow全体でmousemove/mouseupを監視し、
// パネル外までカーソルが出てもリサイズが途切れないようにする。
export function ResizeHandle({ axis, onResize }: ResizeHandleProps) {
    const handleMouseDown = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            let lastPos = axis === 'x' ? e.clientX : e.clientY;

            const handleMove = (ev: MouseEvent) => {
                const pos = axis === 'x' ? ev.clientX : ev.clientY;
                const delta = pos - lastPos;
                lastPos = pos;
                if (delta !== 0) onResize(delta);
            };
            const handleUp = () => {
                window.removeEventListener('mousemove', handleMove);
                window.removeEventListener('mouseup', handleUp);
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            };

            window.addEventListener('mousemove', handleMove);
            window.addEventListener('mouseup', handleUp);
            document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
            document.body.style.userSelect = 'none';
        },
        [axis, onResize],
    );

    return (
        <div
            onMouseDown={handleMouseDown}
            className={
                axis === 'x'
                    ? 'w-1 shrink-0 cursor-col-resize bg-[#3c3c3c] hover:bg-[#007acc] active:bg-[#007acc] transition-colors'
                    : 'h-1 shrink-0 cursor-row-resize bg-[#3c3c3c] hover:bg-[#007acc] active:bg-[#007acc] transition-colors'
            }
        />
    );
}
