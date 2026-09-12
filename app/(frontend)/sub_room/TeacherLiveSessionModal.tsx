'use client';

import React from 'react';
import { WorkspaceLayout } from '@/src/components/workspace/WorkspaceLayout';

interface TeacherLiveSessionModalProps {
    isOpen: boolean;
    onClose: () => void;
    classId: string;
    studentUserId: string;
    studentName: string;
}

// 講師による生徒サポート画面(Git操作・Web公開管理を含むフル機能版、
// タスク指示書「講師（先生）サポート機能への Git 操作・Web公開管理の統合
// および制御強化」参照)。生徒本人のワークスペース(WorkspaceLayout.tsx)を
// そのまま再利用し、teacherContextだけを渡す - ファイルツリー・複数タブ
// エディタ・LSP補完・ソース管理(Git)パネル・変更履歴パネル・公開パネルは
// 生徒側と全く同じコードパスを通る(WorkspaceLayout.tsxのteacherContext
// コメント参照)。以前はここに専用の単一ファイルEditor+ターミナルのみの
// 簡易ビューを実装していたが、Git/公開機能を講師画面へ統合するにあたり、
// 車輪の再発明を避けるためWorkspaceLayoutへ完全に移行した。
export function TeacherLiveSessionModal({
    isOpen,
    onClose,
    classId,
    studentUserId,
    studentName,
}: TeacherLiveSessionModalProps) {
    return (
        <WorkspaceLayout
            isOpen={isOpen}
            onClose={onClose}
            classId={classId}
            title={`🔴 講師サポート中: ${studentName || '生徒'}`}
            teacherContext={{ asUserId: studentUserId, studentName }}
        />
    );
}
