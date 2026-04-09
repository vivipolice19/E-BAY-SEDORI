# せどりツール - eBay仕入れリサーチツール

## 概要
eBayで売れ筋商品を検索し、メルカリ・ヤフオクなどから仕入れ価格を調査して利益計算を行うセドリ（転売）リサーチツール。結果はGoogleスプレッドシートへ同期可能。

## アーキテクチャ
- **フロントエンド**: React + TypeScript + TailwindCSS + shadcn/ui + Wouter (routing)
- **バックエンド**: Node.js + Express + TypeScript
- **外部API**: eBay Browse API (OAuth) + Finding API (フォールバック), Google Sheets API v4
- **ストレージ**: インメモリ（MemStorage）

## 主要ファイル
- `shared/schema.ts` - データモデル・型定義
- `server/routes.ts` - APIルート
- `server/storage.ts` - データ永続化レイヤー
- `server/ebayClient.ts` - eBay Finding API クライアント
- `server/googleSheets.ts` - Google Sheets API クライアント（Replitコネクター使用）
- `client/src/App.tsx` - ルーティング・レイアウト
- `client/src/pages/` - 各ページコンポーネント
- `client/src/components/app-sidebar.tsx` - サイドバーナビゲーション

## ページ構成
- `/` - ダッシュボード（統計・クイックアクセス）
- `/search` - eBay商品検索（フィルタリング・保存機能）
- `/research` - 仕入れ価格調査（メルカリ/ヤフオク/Amazon等リンク生成・利益計算）
- `/watchlist` - 保存リスト（フィルタ・ソート・Sheets同期）
- `/listing` - 出品管理（8機能：説明文生成/価格提案/ライバルチェック/テンプレート/ステータス/利益実績/Item Specifics/画像リサイズ）
- `/calculator` - 利益計算機（逆算機能付き）
- `/sheets` - Googleスプレッドシート同期管理
- `/settings` - 設定（スプレッドシートID・為替・手数料）

## API エンドポイント
- `GET /api/ebay/search` - eBay商品検索
- `GET /api/ebay/categories` - カテゴリ一覧
- `GET /api/ebay/competitors` - ライバル出品調査（価格帯・出品数）
- `GET /api/ebay/item-specifics/:itemId` - eBay Browse APIからItem Specifics自動取得
- `GET /api/price-links/:keyword` - 仕入れサイト検索リンク生成
- `GET /api/source-prices/:keyword` - Playwright経由でメルカリ・ヤフオクの価格を自動取得（5分キャッシュ）
- `POST /api/translate` - MyMemory API経由で英語→日本語自動翻訳（型番保持）
- `GET/POST/PATCH/DELETE /api/products` - 保存商品CRUD（出品管理フィールド対応）
- `POST /api/generate-description` - テンプレートから英語説明文自動生成（{title}/{condition}/{specifics}変数）
- `GET/POST/PUT/DELETE /api/templates` - 出品テンプレートCRUD（デフォルト3件は削除不可）
- `POST /api/sheets/sync/:productId` - 個別商品Sheets同期
- `POST /api/sheets/sync-all` - 全未同期商品一括同期
- `GET /api/sheets/info` - スプレッドシート情報取得
- `GET/PUT /api/settings` - 設定管理（発送代行費設定含む）
- `POST /api/forwarding-cost` - 発送代行費試算（重量gから合計計算）

## 環境変数
- `EBAY_APP_ID` - eBay Application ID (Finding API用)
- `SPREADSHEET_ID` - GoogleスプレッドシートID
- Google Sheets: Replitコネクター経由（OAuth）

## 発送代行費計算
設定値: 国内送料(デフォルト¥800) + 代行手数料(¥500) + 国際送料(基本¥2000 + 重量×¥3/g)
eBay Item Specificsから重量を自動抽出（Item Weight/Package Weight等の項目を参照）
カテゴリデフォルト: Camera=450g, Audio=350g, Electronics=400g, Watch=150g

## スプレッドシート管理
- 「セドリリスト」: 20列（A:T）- 全商品台帳、行単位で更新（sheetRowIndexで追跡）
  商品名/eBay価格$/¥/仕入値/利益/利益率/カテゴリ/状態/販売数/eBayURL/仕入先/仕入先URL/仕入先画像URL/メモ/登録日/ステータス/発送代行費/出品価格/実売価格/実利益
- 「Mercari-eBay 在庫管理」: ステータス→「出品中」変更時にA〜E列を自動追記（F〜H列は在庫同調ツール管轄）

## 主要機能
- **自動翻訳**: eBay英語タイトルを仕入先キーワード検索前に日本語に自動翻訳（型番は保持）
- **仕入先画像URL複数保存**: 仕入先商品選択時に全画像URL（最大20枚）を配列で保存・スプレッドシートに改行区切りで同期。メルカリ商品ページはギャラリー全画像を取得
- **売れるまでの日数表示**: 落札済みURL検索時、出品→売却までの平均日数を表示
- **売れ筋リサーチ**: eBayカテゴリ別人気商品を自動収集（BEST_MATCH/NEWLY_LISTED等ローテーション）
