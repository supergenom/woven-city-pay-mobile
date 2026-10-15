# Google Cloud の準備（管理者向け・最初に1回だけ）

このアプリはブラウザから直接 Gmail API を呼ぶため、Google Cloud で「OAuth クライアント ID」を作る必要があります。
作業は PC のブラウザで行うのがおすすめです（スマホでもできます）。費用はかかりません。

公開先 URL: `https://supergenom.github.io/woven-city-pay-mobile/`

## 1. プロジェクトを作る

1. https://console.cloud.google.com/ を開き、Google アカウントでログイン（初回は利用規約に同意）
2. 画面上部のプロジェクト選択 →「新しいプロジェクト」
3. プロジェクト名: `My Woven City Payment`（任意）→「作成」
4. 作成されたプロジェクトが選択されていることを画面上部で確認

## 2. Gmail API を有効にする

1. https://console.cloud.google.com/apis/library/gmail.googleapis.com を開く
2. 「有効にする」を押す

## 3. OAuth 同意画面（Google Auth Platform）

1. https://console.cloud.google.com/auth/overview を開き「開始」
2. **アプリ情報**: アプリ名 `My Woven City Payment`、ユーザーサポートメール = 自分のアドレス
3. **対象**: 「**外部**」を選ぶ
4. **連絡先情報**: 自分のアドレス
5. 同意して「作成」

### データアクセス（スコープ）

1. 左メニュー「データアクセス」→「スコープを追加または削除」
2. フィルタに `gmail.readonly` と入力 → `.../auth/gmail.readonly`（メールの表示）にチェック →「更新」→「保存」

### 対象（テストユーザー）

1. 左メニュー「対象」→ 公開ステータスが「**テスト中**」であることを確認（「アプリを公開」は押さない）
2. 「テストユーザー」→「Add users」で、このアプリを使う人の Gmail アドレスを追加（自分も含む、最大100人）

> `gmail.readonly` は Google の「制限付きスコープ」です。審査を受けない「テスト中」のままでは、
> ここに登録した人しかログインできません。ログイン時には「Google はこのアプリを確認していません」と表示されます。

## 4. OAuth クライアント ID を作る

1. 左メニュー「クライアント」→「クライアントを作成」
2. アプリケーションの種類: 「**ウェブ アプリケーション**」、名前: `woven-city-pay-mobile`（任意）
3. 「承認済みの JavaScript 生成元」に次の2つを追加
   - `https://supergenom.github.io`
   - `http://localhost:8000`（開発用）
4. 「承認済みのリダイレクト URI」は空のままでよい
5. 「作成」→ 表示された **クライアント ID**（`xxxxxxxx.apps.googleusercontent.com`）を控える
   - クライアント シークレットは使いません。どこにも貼らないでください

## 5. アプリに設定する

`config.js` の `GOOGLE_CLIENT_ID` にクライアント ID を書いて GitHub に push します。
クライアント ID は公開されても問題ありません（上の生成元以外のサイトからは使えません）。

## 利用者を増やすとき

「対象 → テストユーザー」にその人の Gmail アドレスを追加し、利用者向けの説明（[USER_GUIDE.md](USER_GUIDE.md)）を渡してください。
