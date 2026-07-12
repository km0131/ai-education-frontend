import AiPlayClient from './AiPlayClient';

// output: 'export' (静的エクスポート)では動的ルートに generateStaticParams が必須で、
// 1件以上のパスを返さないと「missing generateStaticParams()」エラーになる。
// 実際の id ごとのデータ取得はすべてクライアント側で useParams() を使って行うため、
// ビルド時はプレースホルダー用の1件だけを生成する(実URLは配信側で全て同じ静的ファイルにフォールバックさせる想定)。
export async function generateStaticParams() {
    return [{ id: 'placeholder' }];
}

export default function Page() {
    return <AiPlayClient />;
}
