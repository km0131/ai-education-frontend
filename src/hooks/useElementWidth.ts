'use client';

import { useEffect, useRef, useState } from 'react';

// 要素の実測幅(px)をResizeObserverで追従する。
// react-window は列幅/行高をpx指定する必要があるため、
// Tailwindのレスポンシブグリッド(grid-cols-*)相当の挙動をJS側で再現するのに使う。
export function useElementWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
    const ref = useRef<T | null>(null);
    const [width, setWidth] = useState(0);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        setWidth(el.getBoundingClientRect().width);

        const observer = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (entry) {
                setWidth(entry.contentRect.width);
            }
        });
        observer.observe(el);

        return () => observer.disconnect();
    }, []);

    return [ref, width];
}
