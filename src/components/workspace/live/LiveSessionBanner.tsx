'use client';

import React from 'react';

interface LiveSessionBannerProps {
    teacherName: string;
}

// 講師による生徒セッションのリアルタイム監視・共同操作(ライブセッション
// 同期)。講師が参加・操作を開始した際、生徒画面上部に表示する通知バナー。
export function LiveSessionBanner({ teacherName }: LiveSessionBannerProps) {
    return (
        <div className="shrink-0 px-4 py-2 bg-amber-500/90 text-[#1e1e1e] text-xs font-bold flex items-center gap-2">
            <span>👨‍🏫</span>
            <span>{teacherName ? `${teacherName}先生がサポート中です` : '先生がサポート中です'}</span>
        </div>
    );
}
