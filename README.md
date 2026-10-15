# My Woven City Payment（スマホ版）

Gmail の「【Woven City Pay】」お知らせメールを読み取り、支払いとチャージをカレンダー形式で表示する非公式の家計簿 PWA。
サーバーなしの静的サイトで、ブラウザから直接 Gmail API（読み取り専用）を呼びます。取引データは端末内（localStorage）だけに保存します。

- 公開 URL: https://supergenom.github.io/woven-city-pay-mobile/
- デモ（Gmail 不要）: https://supergenom.github.io/woven-city-pay-mobile/?demo
- 使い方: [docs/USER_GUIDE.md](docs/USER_GUIDE.md)
- Google Cloud の準備（管理者向け）: [docs/SETUP_GOOGLE.md](docs/SETUP_GOOGLE.md)

## 開発

```sh
python3 -m http.server 8000   # http://localhost:8000/?demo
node --test 'tests/*.test.js'  # メール解析のテスト
```

Woven City Pay の公式アプリではありません。
