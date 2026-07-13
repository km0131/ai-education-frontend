'use client';

import React, { useMemo } from 'react';
import { FixedSizeGrid, GridChildComponentProps } from 'react-window';
import { useElementWidth } from '@/src/hooks/useElementWidth';

export interface PhotoItem<TId extends string | number = string | number> {
    id: TId;
    url: string;
    alt: string;
    /** 画像の下に表示する短いキャプション(例: 鮮明度の数値)。指定時は行高にcaptionHeight分を上乗せする */
    caption?: string;
}

// Tailwindのデフォルトブレークポイントに合わせた列数指定。
// (grid-cols-2 sm:grid-cols-4 md:grid-cols-5 のようなクラスをJS側の数値として渡す)
export interface ColumnBreakpoints {
    base: number;
    sm?: number;
    md?: number;
    lg?: number;
    xl?: number;
}

const BREAKPOINTS_PX = { sm: 640, md: 768, lg: 1024, xl: 1280 } as const;

function getColumnCount(width: number, columns: ColumnBreakpoints): number {
    if (columns.xl && width >= BREAKPOINTS_PX.xl) return columns.xl;
    if (columns.lg && width >= BREAKPOINTS_PX.lg) return columns.lg;
    if (columns.md && width >= BREAKPOINTS_PX.md) return columns.md;
    if (columns.sm && width >= BREAKPOINTS_PX.sm) return columns.sm;
    return columns.base;
}

// itemDataはFixedSizeGridに渡す際に string|number の共通形へキャストするため、
// セル側もそれに合わせた固定の型で定義する(呼び出し側の実際のID型はVirtualizedPhotoGrid<TId>のジェネリクスで保たれる)。
type CellData<TId extends string | number = string | number> = {
    items: PhotoItem<TId>[];
    columnCount: number;
    gap: number;
    captionHeight: number;
    onDelete?: (id: TId) => void;
    fallbackImageUrl: string;
};

const PhotoCell = React.memo(function PhotoCell({
    columnIndex,
    rowIndex,
    style,
    data,
}: GridChildComponentProps<CellData>) {
    const { items, columnCount, gap, captionHeight, onDelete, fallbackImageUrl } = data;
    const index = rowIndex * columnCount + columnIndex;
    const item = items[index];
    if (!item) return null;

    return (
        <div style={{ ...style, padding: gap / 2 }}>
            <div className="relative group rounded-lg overflow-hidden bg-gray-50 border border-gray-100 shadow-sm w-full h-full flex flex-col">
                <div className="relative flex-1 overflow-hidden rounded-lg">
                    <img
                        src={item.url}
                        alt={item.alt}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                        onError={(e) => {
                            (e.target as HTMLImageElement).src = fallbackImageUrl;
                        }}
                    />
                    {onDelete && (
                        <button
                            onClick={() => onDelete(item.id)}
                            className="absolute top-1.5 right-1.5 p-1.5 bg-red-500/90 hover:bg-red-600 text-white rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-150 shadow-md"
                            title="画像を削除"
                        >
                            ×
                        </button>
                    )}
                </div>
                {captionHeight > 0 && (
                    <div
                        className="text-center text-[11px] font-bold text-gray-500 flex items-center justify-center flex-shrink-0"
                        style={{ height: captionHeight }}
                    >
                        {item.caption}
                    </div>
                )}
            </div>
        </div>
    );
});

interface VirtualizedPhotoGridProps<TId extends string | number> {
    items: PhotoItem<TId>[];
    columns: ColumnBreakpoints;
    /** グリッドの隙間(px)。Tailwindの gap-3/gap-4 相当(それぞれ12px/16px) */
    gap?: number;
    /** スクロール無しで一度に見せる最大行数。これを超える行数がある場合のみ内部スクロールになる */
    maxVisibleRows?: number;
    /** 画像の下にキャプション(item.caption)を表示する場合の高さ(px)。0の場合はキャプション無し(画像は正方形) */
    captionHeight?: number;
    onDelete?: (id: TId) => void;
    fallbackImageUrl?: string;
    emptyMessage?: string;
}

// react-window の FixedSizeGrid で画像一覧を仮想化して描画する共通コンポーネント。
// 列数はTailwindのブレークポイントに合わせてJS側で計算し(既存CSSのgrid-colsを再現)、
// 行数がmaxVisibleRowsを超える場合だけ内部スクロールになる(少数の画像では従来通り自然な高さで表示される)。
export default function VirtualizedPhotoGrid<TId extends string | number = string | number>({
    items,
    columns,
    gap = 16,
    maxVisibleRows = 4,
    captionHeight = 0,
    onDelete,
    fallbackImageUrl = 'https://placehold.co/150?text=No+Image',
    emptyMessage = '画像が登録されていません。',
}: VirtualizedPhotoGridProps<TId>) {
    const [containerRef, width] = useElementWidth<HTMLDivElement>();

    const layout = useMemo(() => {
        if (width === 0) return null;
        const columnCount = Math.max(1, getColumnCount(width, columns));
        const cellWidth = width / columnCount;
        const cellHeight = cellWidth + captionHeight;
        const rowCount = Math.ceil(items.length / columnCount);
        const visibleRows = Math.min(rowCount, maxVisibleRows);
        const height = visibleRows * cellHeight;
        return { columnCount, cellWidth, cellHeight, rowCount, height };
    }, [width, columns, items.length, maxVisibleRows, captionHeight]);

    if (items.length === 0) {
        return (
            <div className="col-span-full py-8 text-center text-xs text-gray-400 italic">
                {emptyMessage}
            </div>
        );
    }

    const cellData: CellData<TId> = useMemo(
        () => ({
            items,
            columnCount: layout?.columnCount ?? 1,
            gap,
            captionHeight,
            onDelete,
            fallbackImageUrl,
        }),
        [items, layout?.columnCount, gap, captionHeight, onDelete, fallbackImageUrl]
    );

    return (
        <div ref={containerRef} style={{ width: '100%' }}>
            {layout && (
                <FixedSizeGrid
                    columnCount={layout.columnCount}
                    columnWidth={layout.cellWidth}
                    rowCount={layout.rowCount}
                    rowHeight={layout.cellHeight}
                    width={width}
                    height={layout.height}
                    itemData={cellData as unknown as CellData}
                >
                    {PhotoCell}
                </FixedSizeGrid>
            )}
        </div>
    );
}
