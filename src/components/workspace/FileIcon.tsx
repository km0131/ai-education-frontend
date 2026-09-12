import React from 'react';
import {
    SETI_DEFAULT_ICON_ID,
    SETI_EXTENSION_TO_ICON_VIA_LANGUAGE,
    SETI_EXTRA_FILE_NAMES,
    SETI_FILE_EXTENSIONS,
    SETI_FILE_NAMES,
    SETI_ICON_DEFINITIONS,
} from './setiIconData';

// resolveSetiIconId は VS Code本体(vs/workbench/services/themes配下)の
// ファイルアイコン解決順序を簡略再現したもの:
//   1. ファイル名そのもの(小文字)の完全一致(SETI_FILE_NAMES)
//   2. 本アプリで補った特別なファイル名(SETI_EXTRA_FILE_NAMES、
//      Dockerfile/.gitignore等 - Seti自体のJSONにはVS Code本体の言語拡張機能
//      側のファイル名パターン経由でしか現れないもの)
//   3. ".env"/".env.*"(dotenv言語、同じ理由で特別扱いされている)
//   4. 拡張子の一致 - 複合拡張子("foo.spec.ts"の"spec.ts")を長い方から
//      順に試し、見つからなければ単一の拡張子(SETI_FILE_EXTENSIONS)
//   5. 4で見つからない場合、メジャーな拡張子の補完テーブル
//      (SETI_EXTENSION_TO_ICON_VIA_LANGUAGE、setiIconData.tsのコメント参照)
//   6. 既定アイコン(SETI_DEFAULT_ICON_ID)
function resolveSetiIconId(fileName: string): string {
    const lower = fileName.toLowerCase();

    if (SETI_FILE_NAMES[lower]) return SETI_FILE_NAMES[lower];
    if (SETI_EXTRA_FILE_NAMES[lower]) return SETI_EXTRA_FILE_NAMES[lower];
    if (lower === '.env' || lower.startsWith('.env.')) return '_config';

    const dotIndex = lower.indexOf('.');
    if (dotIndex !== -1) {
        const rest = lower.slice(dotIndex + 1);
        const segments = rest.split('.');
        for (let i = 0; i < segments.length; i++) {
            const ext = segments.slice(i).join('.');
            if (SETI_FILE_EXTENSIONS[ext]) return SETI_FILE_EXTENSIONS[ext];
        }
        for (let i = 0; i < segments.length; i++) {
            const ext = segments.slice(i).join('.');
            if (SETI_EXTENSION_TO_ICON_VIA_LANGUAGE[ext]) return SETI_EXTENSION_TO_ICON_VIA_LANGUAGE[ext];
        }
    }

    return SETI_DEFAULT_ICON_ID;
}

// fileIconGlyph: ファイル名からSetiのグリフ文字+色を引く。EditorPane/
// FileExplorerPane以外(HistoryPanelのDiffViewer等)からも使えるよう、
// コンポーネントとは別に関数としても公開する。
export function fileIconGlyph(fileName: string): { char: string; color: string } {
    const id = resolveSetiIconId(fileName);
    return SETI_ICON_DEFINITIONS[id] ?? SETI_ICON_DEFINITIONS[SETI_DEFAULT_ICON_ID];
}

interface FileIconProps {
    name: string;
    className?: string;
}

// VS Codeを新規インストールした直後の既定のファイルアイコンテーマ「Seti」を
// そのまま表示するアイコン(FileExplorerPaneのツリー/EditorPaneのタブで
// 使用)。ディレクトリの開閉やシェブロン等、ファイルの種類を表さないUI用
// アイコンは引き続きIcon.tsx(codicon)を使う - こちらはあくまで「ファイルの
// 種類」を表す部分専用。
export function FileIcon({ name, className = '' }: FileIconProps) {
    const { char, color } = fileIconGlyph(name);
    return (
        <span className={`seti-file-icon ${className}`} style={{ color }} aria-hidden="true">
            {char}
        </span>
    );
}
