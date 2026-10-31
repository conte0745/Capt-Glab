# CaptGrab

見えているレイアウトのまま、Web ページ全体を 1 枚の PNG にする Chrome 拡張機能です。

[紹介ページ](https://captgrab.shiftonton.net/) / [使い方ガイド](https://captgrab.shiftonton.net/guide.html) / [プライバシーポリシー](https://captgrab.shiftonton.net/privacy-policy.html)

## 特徴

- ツールバーのアイコンを押すだけで、ページ全体を撮影できます。
- ビューポートを固定して撮影するため、`100vh` の要素が伸びてレイアウトが崩れることがありません。
- スクロールして画像をつなぎ合わせる方式ではないため、継ぎ目が出ません。
- 高 DPI ディスプレイでは、その解像度のまま保存します。
- 画像は `screen-0001.png` の形式の連番でダウンロードし、クリップボードにもコピーします。
- 画像を外部へ送信しません。

## インストール

ソースコードからビルドして読み込みます。Node.js、pnpm、Git が必要です。

```sh
git clone https://github.com/conte0745/Capt-Glab.git
cd Capt-Glab
pnpm install
pnpm build
```

1. Chrome で `chrome://extensions` を開きます。
2. 右上の「デベロッパー モード」をオンにします。
3. 「パッケージ化されていない拡張機能を読み込む」から、生成された `dist` フォルダを選びます。

## 使い方

1. 撮りたいページをタブに表示し、ツールバーの CaptGrab のアイコンを押します。
2. 小さなウィンドウが開き、撮影が始まります。
3. 「画像を保存しました」と表示されると完了です。ウィンドウは約 2 秒で閉じます。

連番をリセットするには、アイコンを右クリックして「オプション」を開き、「カウントをリセット」を押します。

## 制限事項

- 撮影中は、Chrome がデバッグ中である旨のバーを表示します。バーは撮影後、数秒で消えます。
- 同じタブで続けて撮影すると、バーが消えるまで次の撮影を待ちます(前回の撮影から約 6 秒)。
- `chrome://` など、デバッガを接続できないページは撮影できません。
- ブラウザのズームが 100% 以外だと、正しく写らないことがあります。
- 横にはみ出した部分は写りません。
- スクロールして初めて読み込まれる画像は、読み込み前だと写らないことがあります。

その他の対処法は[使い方ガイド](https://captgrab.shiftonton.net/guide.html)にまとめています。

## 開発

| コマンド       | 内容                                            |
| -------------- | ----------------------------------------------- |
| `pnpm dev`     | 開発サーバーを起動します                        |
| `pnpm build`   | 型チェックのあと、`dist/` にビルドします        |
| `pnpm preview` | ビルド結果をプレビューします                    |
| `pnpm zip`     | `dist/` を圧縮し、`release/` に zip を出力します |

### ディレクトリ構成

```text
src/
  background/  撮影処理(chrome.debugger の操作)
  popup/       撮影の開始、画像の保存とコピー
  options/     連番のリセット画面
  icons/       アイコンとローディング画像
docs/          紹介ページ、使い方ガイド、プライバシーポリシー
vite.config.ts manifest の定義
```

### 権限

| 権限             | 用途                                 |
| ---------------- | ------------------------------------ |
| `debugger`       | ビューポートの固定とページ全体の撮影 |
| `storage`        | 連番の保存                           |
| `clipboardWrite` | 画像のクリップボードへのコピー       |

## リリース

バージョンは `package.json` の `version` だけで管理します。manifest の `version` と zip のファイル名には、この値が使われます。

1. `package.json` の `version` を更新します。
2. ビルドして圧縮します。`pnpm zip` はビルドを行わないため、先に `pnpm build` が必要です。

   ```sh
   pnpm build
   pnpm zip
   ```

3. `release/captgrab-<version>.zip` が生成されます。zip のルートに `manifest.json` が入ります。

## ライセンス

[MIT License](LICENSE)
