# 🔍 AI文章チェッカー

テキストを貼り付けるだけで、AIが書いたかどうかを判定するWebサービスです。

## セットアップ手順

### 1. 依存パッケージをインストール
```bash
npm install
```

### 2. HuggingFace APIキーを取得
1. https://huggingface.co にアクセスしてアカウントを作成
2. Settings → Access Tokens → New Token でAPIキーを取得

### 3. 環境変数を設定
`.env.local.example` をコピーして `.env.local` を作成し、APIキーを貼り付けてください。

```bash
cp .env.local.example .env.local
# .env.local を開いて HF_API_KEY を設定
```

### 4. 開発サーバーを起動
```bash
npm run dev
```

ブラウザで http://localhost:3000 を開いてください。

## デプロイ（Vercel）

1. GitHubにリポジトリを作成してpush
2. https://vercel.com でリポジトリをインポート
3. Environment Variables に `HF_API_KEY` を設定
4. Deploy！

## 技術スタック

- **フロントエンド**: Next.js + Tailwind CSS
- **バックエンド**: Next.js API Routes
- **検出モデル**: HuggingFace `roberta-base-openai-detector`
- **デプロイ**: Vercel
