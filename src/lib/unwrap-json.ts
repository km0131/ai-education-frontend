// 期待している形（モデル名 -> 数値 or 配列）かどうかを判定する
function looksShaped(values: unknown[]): boolean {
    return values.length > 0 && values.every((v) => Array.isArray(v) || typeof v === 'number');
}

// ラップされた値の中身を調べる際は、まだテスト未実行などで中身が空
// （例: { test: {} }）なだけの正当なケースも「展開すべき候補」として認める
function looksShapedOrEmpty(values: unknown[]): boolean {
    return values.length === 0 || looksShaped(values);
}

// バックエンドが { train: "<JSONの文字列>" } や { test: { モデル名: 値, ... } } のように
// レスポンスを1段階ラップして返してくる場合があるため、期待の形でなければ中身を展開する
export function unwrapJson<T>(raw: unknown): T {
    if (raw == null) return {} as T;
    if (typeof raw === 'string') {
        try {
            return unwrapJson<T>(JSON.parse(raw));
        } catch {
            return {} as T;
        }
    }
    if (typeof raw === 'object') {
        const values = Object.values(raw as Record<string, unknown>);
        if (looksShaped(values)) return raw as T;

        for (const v of values) {
            if (typeof v === 'string') {
                try {
                    const parsed = JSON.parse(v);
                    if (parsed && typeof parsed === 'object' && looksShapedOrEmpty(Object.values(parsed))) {
                        return parsed as T;
                    }
                } catch {
                    // 別の値で再挑戦する
                }
            } else if (v && typeof v === 'object' && looksShapedOrEmpty(Object.values(v as Record<string, unknown>))) {
                return v as T;
            }
        }
    }
    return raw as T;
}
