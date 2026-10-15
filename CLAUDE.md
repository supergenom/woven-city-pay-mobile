# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# My Woven City Payment（スマホ専用版）

PC やラズパイを使わず、**スマホのブラウザだけ**で Gmail の「【Woven City Pay】」メールを読み取り、家計簿（カレンダー）として表示する静的 PWA。
既存のラズパイ版／Windows 版（`/home/supergenom/workspace/WovenCityPay`）の姉妹プロジェクト。**既存側のファイルは変更しないこと**（参照・コピー元としてのみ使う）。

- 公開: https://supergenom.github.io/woven-city-pay-mobile/（デモ: `?demo`）
- リポジトリ: `supergenom/woven-city-pay-mobile`（public、GitHub Pages は main ブランチのルート）

## コマンド

ビルド・リンター・依存パッケージはなし（素の HTML/CSS/JS）。

```sh
node --test 'tests/*.test.js'                                       # 解析テスト全部（引数はクォートしたグロブ。ディレクトリ指定は不可）
node --test --test-name-pattern="charge" tests/parser.test.js       # 1件だけ
python3 -m http.server 8000                                         # http://localhost:8000/?demo
```

- `http://localhost:8000` は OAuth の承認済み生成元に登録済み → ローカルでも本物の Google ログインが可能
- デプロイ = main に push するだけ。Pages への反映は約1分（`curl https://supergenom.github.io/woven-city-pay-mobile/<file>` で確認）
- このラズパイには `chromium` があり、ヘッドレスのスクリーンショット（`--screenshot --window-size=390,900`）や DevTools プロトコルでの画面操作確認に使える

## 方式（2026-10-15 ユーザー決定：案A）

- サーバーなし。利用者が Google でログイン → **ブラウザから直接 Gmail API**（GIS トークンモデル、スコープ `gmail.readonly`）
- 取引データは端末の localStorage だけ。外部に送らない
- 不採用案: Google Apps Script（利用者の設定が難しい）、メール転送＋自前サーバー（他人の支払いデータを預かる責任）

## 構成（複数ファイルにまたがる要点）

- 読み込み順: GIS → `config.js`（`GOOGLE_CLIENT_ID`、公開可） → `parser.js` → `store.js` → `gmail.js` → `app.js`。モジュールではなくグローバル（`WCPParser` / `Store` / `Gmail`）
- `parser.js` … `server.py` の `parse_message` / `classify` / 正規表現の移植。Gmail API `format=full` の payload から本文を抽出（base64url ＋ `TextDecoder`、text/plain 優先、添付除外）。ブラウザ／Node 両対応（テストは `require` で読む）
- `gmail.js` … トークンはメモリのみ（約1時間）。**`authorize()` はクリック処理の中で await より前に呼ぶ**（ポップアップがブロックされないように）。`messages.list` → 未取得 ID だけ `messages.get` を5並列
  - 利用上限 15,000 単位/分/ユーザー（get は5単位）。`throttle()` でリクエスト開始間隔 60ms 以上、上限の 403/429 は待って最大4回再試行。並列数や間隔を変えるときはこの上限を考慮
- `store.js` … キー `wcp.transactions` / `account` / `updatedAt` / `storeGroups`。`?demo` ではメモリだけを使い、実データには触れない
- `app.js` … 既存 `static/app.js` の移植（表示部分はほぼそのまま）。サーバー API の代わりに Store / Gmail を呼ぶ。ストア名のまとめは表示時に適用（元の名前は `store_raw`）
- 取り込み済みの判定 = 保存済み取引の ID（= Gmail メッセージ ID）。取引として読めなかったメールは記録しない → 解析ルールを直せば次の「更新」で自動的に読み直される。**ただし保存済み取引は読み直さない**（既に取り込んだ取引の解析結果を変える修正では、データ消去 → 再取得が必要）
- 別アカウントでログインしたら取引データを消去（ストア名のまとめは残す）。取り込みが途中で失敗しても、読めた分は保存
- `index.html` の CSP で外部接続先を Google（GIS、gmail.googleapis.com、oauth2.googleapis.com）に限定 → 外部リソースを足すときは CSP も更新
- `sw.js` は network-first。ファイルを追加・改名したら `FILES` と `CACHE` 名も更新
- バージョン: `app.js` の `APP_VERSION`
- 説明書: `docs/SETUP_GOOGLE.md`（管理者向け: Google Cloud の準備）、`docs/USER_GUIDE.md`（利用者向け）

## Google のルール上の制約（利用者に伝えること）

- `gmail.readonly` は制限付きスコープ。審査なしの「テスト中」のままでは、**Google Cloud に登録したテストユーザー（最大100人）** しか使えない。利用者を増やすときは「対象 → テストユーザー」に追加
- ログイン時に「Google はこのアプリを確認していません」と警告が出る
- アクセストークンは約1時間。切れたら「更新」で再ログイン

## 既存版から引き継ぐ仕様（詳細は `../WovenCityPay/CLAUDE.md` の「仕様・決定事項」）

- 画面: タイトル「My Woven City Payment」白文字、黒背景。月曜始まりカレンダー（支払いはストア別に色分け、チャージは白文字 `+¥`）、支払いタップで詳細、一覧表示（全／月／週／ストア別・折りたたみ）、CSV出力、⚙ 設定（ストア名のまとめ）
- メール解析ルールの元は `../WovenCityPay/server.py`、テストケースの元は `../WovenCityPay/tests/test_server.py`
  - 支払い: 件名「ご利用のお知らせ」「お支払い完了のお知らせ」「カード決済完了のお知らせ」／チャージ: 「チャージ完了のお知らせ」
  - 取り込まない: 「残高送付完了」「残高受け取り」、登録完了、各種お知らせ
  - 本文の項目: 取引日時／ストア名／利用金額、チャージ日時／チャージ金額（全角は NFKC 正規化）
- 違い: スマホ版は Gmail 全体を検索する（ラズパイ版は受信トレイのみ）ため、アーカイブ済みのメールも取り込む

## 履歴

- 2026-10-15 v0.1.0 初版作成（解析の移植＋テスト、画面の移植、Gmail API での取得、デモ、PWA、説明書）。Google Cloud の準備完了、クライアント ID を config.js に設定
- 2026-10-15 v0.1.1 実機の初回取り込みで Gmail API の利用上限に達し 403 → リクエスト間隔の制限と、上限エラー時の待機・再試行を追加
- 2026-10-15 ユーザーがスマホ実機で Google ログイン → 全件の取り込みを確認（OK）。未確認: ラズパイ版（179件）との件数一致、2回目の更新で新規0件、ホーム画面から起動したときのログイン（特に iPhone）
