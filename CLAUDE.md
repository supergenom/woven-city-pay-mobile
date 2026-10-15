# My Woven City Payment（スマホ専用版）

PC やラズパイを使わず、**スマホのブラウザだけ**で Gmail の「【Woven City Pay】」メールを読み取り、家計簿（カレンダー）として表示する版。
既存のラズパイ版／Windows 版（`/home/supergenom/workspace/WovenCityPay`）の姉妹プロジェクト。**既存側のファイルは変更しないこと**（参照・コピー元としてのみ使う）。

## 方式（2026-10-15 ユーザー決定：案A）

- 静的な Web アプリ（PWA）。サーバーなし。ホスティングは GitHub Pages を想定
- 利用者が Google でログイン → **ブラウザから直接 Gmail API** を呼んでメールを読む
  - Google Identity Services（GIS）のトークンモデル、スコープ `https://www.googleapis.com/auth/gmail.readonly`
  - 検索クエリ例: `subject:"Woven City Pay"`（件名が「【Woven City Pay】」で始まるかはクライアントで再確認）
- 取引データはスマホの中だけ（IndexedDB/localStorage）。外部に送らない
- 不採用案: Google Apps Script（利用者の設定が難しい）、メール転送＋自前サーバー（他人の支払いデータを預かる責任）

## Google のルール上の制約（利用者に伝えること）

- `gmail.readonly` は制限付きスコープ。Google の審査（＋外部セキュリティ評価）なしの「テスト中」扱いでは、**事前登録したテストユーザー最大100人**のみ利用可
- ログイン時に「Google はこのアプリを確認していません」と警告が出る
- アクセストークンは約1時間。期限切れ時は再ログインを促す
- 準備として、ユーザーが Google Cloud プロジェクト・OAuth 同意画面・OAuth クライアント ID（ウェブアプリ、承認済みの JavaScript 生成元に Pages の URL と開発用 localhost）を作る必要がある → 画面操作を案内する

## 既存版から引き継ぐ仕様（詳細は `../WovenCityPay/CLAUDE.md` の「仕様・決定事項」）

- 画面: タイトル「My Woven City Payment」白文字、黒背景。月曜始まりカレンダー（支払いはストア別色分け、チャージは白文字 `+¥`）、支払いタップで詳細、一覧表示（全／月／週／ストア別・折りたたみ）、CSV出力、⚙ 設定（ストア名のまとめ）
- 流用元: `../WovenCityPay/static/`（index.html, app.js, style.css, manifest, アイコン）
- メール解析ルール: `../WovenCityPay/server.py`（`parse_message`, `classify`, 各正規表現）を JavaScript に移植。テストケースは `../WovenCityPay/tests/test_server.py`
  - 支払い: 件名「ご利用のお知らせ」「お支払い完了のお知らせ」「カード決済完了のお知らせ」／チャージ: 「チャージ完了のお知らせ」
  - 取り込まない: 「残高送付完了」「残高受け取り」、登録完了、各種お知らせ
  - 本文の項目: 取引日時／ストア名／利用金額、チャージ日時／チャージ金額（全角は NFKC 正規化）
- 既存版のサーバー側の処理（IMAP、アプリパスワード、DPAPI、PC モード、CSRF/Host 対策、インストーラ）は不要

## 作業計画

1. Google Cloud の準備をユーザーに案内（プロジェクト作成、Gmail API 有効化、OAuth 同意画面＝外部・テスト中、テストユーザー追加、クライアント ID 発行）
2. 解析ロジックを JS に移植し、Node でテスト（既存のテストケースを移植）
3. 画面を移植し、Gmail API での取得・差分取得（取得済みメッセージ ID を保存）・ローカル保存を実装
4. GitHub リポジトリ作成 → GitHub Pages で公開 → ユーザーのスマホで確認
5. 利用者向け説明書（docs/）

## 構成

- 静的ファイルのみ（ビルドなし・ライブラリ不使用）。読み込み順: GIS → `config.js` → `parser.js` → `store.js` → `gmail.js` → `app.js`
  - `config.js` … `GOOGLE_CLIENT_ID`（公開可。シークレットは置かない）
  - `parser.js` … `server.py` の解析を移植。Gmail API `format=full` の payload から本文抽出（base64url＋`TextDecoder`、text/plain 優先、添付除外）。ブラウザ／Node 両対応
  - `store.js` … localStorage（キー `wcp.transactions` / `account` / `updatedAt` / `storeGroups`）。`?demo` ではメモリのみ
  - `gmail.js` … GIS トークンモデル。トークンはメモリのみ。`authorize()` はクリック処理内で await より前に呼ぶ（ポップアップ対策）。`messages.list` → 未取得 ID のみ `messages.get` を5並列
  - `app.js` … 既存 `static/app.js` の移植（表示部分はほぼそのまま）。ストア名のまとめはクライアント側で適用（`store_raw` に元の名前）
  - `sw.js` … network-first のオフライン用キャッシュ（同一オリジンのみ）。`index.html` に CSP（Google の GIS / Gmail API のみ許可）
- 取引 ID = Gmail メッセージ ID。取り込み済み判定は保存済み取引の ID（読めなかったメールは記録しない＝既存方針）
- 別アカウントでログインしたら取引データを消去（ストア名のまとめは残す）。途中で失敗しても読めた分は保存
- `?demo` … サンプルデータ（クライアント ID なしで画面確認用）
- テスト: `node --test 'tests/*.test.js'`。ローカル確認: `python3 -m http.server 8000` → `http://localhost:8000/?demo`
- 説明書: `docs/SETUP_GOOGLE.md`（管理者: Google Cloud の準備）、`docs/USER_GUIDE.md`（利用者）
- バージョン: `app.js` の `APP_VERSION`。ファイル構成を変えたら `sw.js` の `FILES` と `CACHE` 名も更新

## 決定事項

- GitHub リポジトリ `supergenom/woven-city-pay-mobile`（public）、GitHub Pages（main ブランチのルート）→ https://supergenom.github.io/woven-city-pay-mobile/

## 履歴

- 2026-10-15 v0.1.0 初版作成（解析移植＋テスト、画面移植、Gmail API 取得、デモ、PWA、説明書）。Google Cloud の準備はユーザー作業待ち（クライアント ID 未設定）
