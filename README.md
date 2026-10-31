# CaptGrab

## 　 Google chrome の拡張機能

- [紹介ページ](https://captgrab.shiftonton.net/) / [使い方ガイド](https://captgrab.shiftonton.net/guide.html) / [プライバシーポリシー](https://captgrab.shiftonton.net/privacy-policy.html)
- アイコン押下時にスクリーンショットを取得します。
- `chrome.debugger` を使用し、ビューポートを固定したままページ全体を撮影します。
- 撮影中はブラウザにデバッグ中である旨のバーが表示されます。
- `chrome://` などのデバッガを接続できないページは撮影できません。

## 環境構築

```node
pnpm install
```

## ビルド

```node
pnpm build
```

## 依存関係

- crxjs/vite-plugin
- types/chrome
- typescript
- vite

## ライセンス

[MIT License](LICENSE)
