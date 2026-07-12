import { Suspense } from 'react';
import AiPlayClient from './AiPlayClient';

// id は動的セグメントではなくクエリパラメータ(?id=xxx)で受け取るため、
// このページ自体は通常の静的ページとして書き出される(generateStaticParamsは不要)。
// useSearchParams() を使うクライアントコンポーネントは Suspense 境界が必須。
export default function Page() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center">読み込み中...</div>}>
            <AiPlayClient />
        </Suspense>
    );
}
