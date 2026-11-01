# CaptGrab

画面サイズを固定して、Web ページ全体を 1 枚の PNG にする Chrome 拡張機能です。

[Chrome ウェブストア](https://chromewebstore.google.com/detail/lanhcfgmjnbbalhiljdhcleahpineilm) / [紹介ページ](https://captgrab.shiftonton.net/) / [使い方ガイド](https://captgrab.shiftonton.net/guide.html) / [プライバシーポリシー](https://captgrab.shiftonton.net/privacy-policy.html)

## 特徴

- ツールバーのアイコンを押すだけで、ページ全体を撮影できます。
- ビューポートを固定して撮影するため、`100vh` の要素が撮影時に伸びません。
- スクロールして画像をつなぎ合わせる方式ではないため、継ぎ目が出ません。
- 高 DPI ディスプレイでは、その解像度で保存します(とても長いページは縮小します)。
- 画像は `screen-0001.png` の形式の連番でダウンロードし、クリップボードにもコピーします。
- 設定画面で、撮影後の動作(保存、コピー、別タブ)、保存先のフォルダ、撮影するときの画面サイズ(ビューポート)、スクロール領域の撮り方を変更できます。
- 長いページは、画像の長辺が 16,000px に収まるよう縮小します。
- 画像を外部へ送信しません。

## インストール

[Chrome ウェブストア](https://chromewebstore.google.com/detail/lanhcfgmjnbbalhiljdhcleahpineilm)から追加できます。

### ソースコードからビルドする場合

Node.js(20.19 以上または 22.12 以上)、pnpm、Git が必要です。

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
2. アイコンの下に「撮影中…」と表示され、撮影が始まります。
3. 「保存してコピーしました」と表示されると完了です。表示は約 2 秒で閉じます。

ショートカットキーの初期設定は `Alt` + `Shift` + `S`(Mac は `Option` + `Shift` + `S`)です。別タブで開いた画像は、`Ctrl+S`(保存)、`Ctrl+Shift+S`(別名で保存)、`Ctrl+C`(コピー)で操作できます(Mac は `Command`)。設定画面は、撮影時に表示される歯車ボタンか、アイコンの右クリックメニューの「オプション」から開きます。

## 制限事項

- 撮影中は、Chrome がデバッグ中である旨のバーを表示します。バーは撮影後、数秒で消えます。
- 同じタブで続けて撮影すると、バーが消えるまで次の撮影を待ちます(前回の撮影から約 6 秒)。
- 「撮影中…」の表示中に他の場所をクリックすると、クリップボードにはコピーされません。ファイルの保存と別タブでの表示は行います。
- 保存先に指定できるのはダウンロードフォルダ内だけです(毎回選ぶ設定を除く)。
- `chrome://` など、デバッガを接続できないページは撮影できません。
- 本文やメニューだけがスクロールする画面は、撮影中だけ領域を広げて撮ります(本文は初期設定でオン、メニューはオフ)。サイトの作りによってはレイアウトが崩れたり、一覧が途中までになったりします。撮影が中断された場合は、30 秒以内に自動で元に戻します。
- 横にはみ出した部分は写りません。
- スクロールして初めて読み込まれる画像は、読み込み前だと写らないことがあります。

その他の対処法は[使い方ガイド](https://captgrab.shiftonton.net/guide.html)にまとめています。

## 開発

| コマンド       | 内容                                            |
| -------------- | ----------------------------------------------- |
| `pnpm dev`     | 開発サーバーを起動します                        |
| `pnpm build`   | 型チェックのあと、`dist/` にビルドします        |
| `pnpm preview` | ビルド結果をプレビューします                    |
| `pnpm zip`     | ビルドして `dist/` を圧縮し、`release/` に zip を出力します |
| `pnpm test`    | 単体テストと E2E テストを実行します             |

### テスト

| コマンド         | 内容                                                                     |
| ---------------- | ------------------------------------------------------------------------ |
| `pnpm test:unit` | Vitest で撮影処理、保存処理、設定画面をテストします                      |
| `pnpm test:e2e`  | ビルドした拡張機能を Playwright で Chrome に読み込み、撮影とサイトをテストします |

E2E テストの初回は、ブラウザのインストールが必要です。

```sh
pnpm exec playwright install chromium
```

### ディレクトリ構成

```text
src/
  background/  撮影と保存(chrome.debugger、chrome.downloads の操作)
  popup/       撮影の開始、結果の表示、クリップボードへのコピー
  options/     設定画面
  viewer/      別タブで画像を表示する画面
  settings.ts  設定の読み書きと入力チェック
  icons/       アイコンとローディング画像
docs/          紹介ページ、使い方ガイド、プライバシーポリシー
tests/
  unit/        単体テスト(Vitest)
  e2e/         E2E テスト(Playwright)
vite.config.ts manifest の定義
```

### 権限

| 権限             | 用途                                 |
| ---------------- | ------------------------------------ |
| `debugger`       | ビューポートの固定とページ全体の撮影 |
| `storage`        | 連番と設定の保存                     |
| `downloads`      | 指定したフォルダへの画像の保存       |
| `clipboardWrite` | 画像のクリップボードへのコピー       |

## リリース

バージョンは `package.json` の `version` だけで管理します。manifest の `version` と zip のファイル名には、この値が使われます。

1. `package.json` の `version` を更新します。
2. `pnpm zip` を実行します。ビルドも合わせて行われます。

3. `release/captgrab-<version>.zip` が生成されます。zip のルートに `manifest.json` が入ります。

## ライセンス

[MIT License](LICENSE)
