import React from 'react';

interface IconProps {
    name: string;
    className?: string;
    title?: string;
}

// VS Code公式アイコンセット(Codicons, @vscode/codicons)のラッパー。
// `name`はハイフン区切りのcodicon名(例: "folder-opened")をそのまま渡す。
export function Icon({ name, className = '', title }: IconProps) {
    return <i className={`codicon codicon-${name} ${className}`} title={title} aria-hidden={title ? undefined : true} />;
}
