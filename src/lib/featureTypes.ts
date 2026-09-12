// feature_types.key の値。バックエンド(internal/model/db_models.go の
// FeatureTypeKeyImageClassification/FeatureTypeKeyWebDev)と対応させる定数。
// マジックストリングの重複を避けるため、キー文字列で判定する箇所は
// 必ずこの定数を経由すること。
export const FEATURE_TYPE_IMAGE_CLASSIFICATION = 'image_classification';
export const FEATURE_TYPE_WEB_DEV = 'web_dev';

export interface FeatureType {
    id: number;
    key: string;
    name: string;
}
