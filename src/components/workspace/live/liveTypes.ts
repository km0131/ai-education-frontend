// 講師による生徒セッションのリアルタイム監視・共同操作(ライブセッション
// 同期、Pair Programming / Live Share形式)。バックエンド(JoinEditorHub、
// internal/service/live_session_hub.go)はこれらのメッセージの中身を一切
// 解釈せず、送信者以外の全接続へそのまま中継するだけ - OT/CRDTのような
// 競合解決は行わない、2人ペア前提の単純な設計。

export interface LiveEditorRange {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
}

export interface LiveEditorChangeMessage {
    type: 'editor-change';
    path: string;
    changes: { range: LiveEditorRange; text: string }[];
}

// editor-open: 講師・生徒どちらかがファイルツリーから別のファイルを開いた/
// 切り替えた時に送る「画面追従」の合図(WorkspaceLayout.handleSelectFile
// 参照)。中身(content)はあえて含めない - 受け手は自分自身の権限で
// securedFetch(as_userクエリ、src/lib/api.ts参照)経由でファイルを取得する
// ため、常に最新かつ受け手側の認可チェックを通った内容になる。受け手は
// (1)そのパスのタブがまだ無ければ開き、(2)アクティブなタブをそのパスへ
// 切り替える - こうして「相手が今見ているファイル」に画面が追従する
// (双方向: どちらが送ってももう片方が追従する)。
export interface LiveEditorOpenMessage {
    type: 'editor-open';
    path: string;
    name: string;
}

export interface LiveEditorCursorMessage {
    type: 'editor-cursor';
    path: string;
    position: { lineNumber: number; column: number } | null; // nullはフォーカスが外れた/選択解除
    name: string;
}

export interface LivePresenceMessage {
    type: 'presence';
    teacher_joined: boolean;
    name?: string;
}

// workspace-refresh: 講師/生徒どちらか一方がGit操作・ファイル作成/移動/
// 削除・Web公開状態の変更を行った時に送る(WorkspaceLayout参照)。
// editor-change/-cursorとは違い中身の同期は行わず、「関連する状態を
// サーバーへ問い合わせ直せ」という合図のみを送る - ファイルツリーや
// コミット履歴、公開URL/残り時間はいずれもエディタのモデル操作では
// 表現できない(単なるサーバー側の状態)ため、この方式にしている。
export interface LiveWorkspaceRefreshMessage {
    type: 'workspace-refresh';
    reason: 'git' | 'file' | 'publish';
}

export type LiveMessage =
    | LiveEditorChangeMessage
    | LiveEditorOpenMessage
    | LiveEditorCursorMessage
    | LivePresenceMessage
    | LiveWorkspaceRefreshMessage;
