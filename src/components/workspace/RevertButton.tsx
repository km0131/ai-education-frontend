'use client';

import React from 'react';
import { Icon } from './Icon';

interface RevertButtonProps {
    onClick: () => void;
    isReverting: boolean;
}

// 「この状態に巻き戻す」ボタン本体。確認ダイアログの表示とAPI呼び出しは
// 親(HistoryPanel)が持つ - このボタンはクリックを伝えるだけの見た目担当。
export function RevertButton({ onClick, isReverting }: RevertButtonProps) {
    return (
        <button
            onClick={onClick}
            disabled={isReverting}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold text-white bg-[#a1260d] hover:bg-[#c42b0e] disabled:opacity-40 transition-colors"
        >
            <Icon name="discard" />
            {isReverting ? '巻き戻し中...' : 'この状態に巻き戻す (Revert)'}
        </button>
    );
}
