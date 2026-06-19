
# AI Education Frontend

## 概要

AI Education システムのフロントエンドです。

Bun + Hono + TypeScript を利用して構築されており、ユーザー向けの画面表示と API 通信を担当します。

---

## 技術スタック

### Runtime

* Bun

### Framework

* Hono

### Language

* TypeScript

### Styling

* Tailwind CSS

---

## ディレクトリ構成

```text
frontend/
├─ Dockerfile
├─ package.json
└─ src/
   └─ index.ts
```

---

## 起動方法

- ローカル（docker-compose）起動例：リポジトリ直下で実行する。

```
docker compose up --build
podman-compose up --build
```

- コンテナの停止
```
podman-compose down
```


- コンテナの削除
```
sudo docker-compose down
```


---

## 環境変数

```env
NEXT_PUBLIC_API_URL=
```

例

```env
NEXT_PUBLIC_API_URL=http://localhost:8080
```

---

## API接続

フロントエンドは環境変数

```env
NEXT_PUBLIC_API_URL
```

を利用してバックエンドへ接続します。

例:

```typescript
fetch(`${process.env.NEXT_PUBLIC_API_URL}/login`)
```

---

## 開発用スクリプト

```bash
bun run dev
```

開発サーバー起動

```bash
bun run build
```

本番ビルド

```bash
bun run lint
```

コードチェック

---

## 画面構成

### 認証

* ログイン画面
* サインアップ画面

### 学習機能

* AI教材閲覧
* 学習履歴表示
* 資格管理

---

## バックエンド接続先

### 開発環境

http://localhost:8080

### 本番環境

https://ai-api.kiiswebai.com/

---

## 本番環境

### Frontend

https://ai.kiiswebai.com/
