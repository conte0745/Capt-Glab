# CaptGrab

画面サイズを固定して、Web ページ全体を PNG で撮影する Chrome 拡張機能です。

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
- 画面は日本語、英語、スペイン語、ポルトガル語(ブラジル)、ドイツ語、フランス語、韓国語、中国語(繁体字)に対応しています。初期設定では Chrome の言語で表示し、設定画面で言語を変えられます。
- 有料機能(買い切り 500 円): 遅延読み込みの画像も写す、縮小せずに画像を分けて保存、複数のサイズで一度に撮る。購入の確認には [ExtensionPay](https://extensionpay.com) を使います。

## インストール

[Chrome ウェブストア](https://chromewebstore.google.com/detail/lanhcfgmjnbbalhiljdhcleahpineilm)から追加できます。

### ソースコードからビルドする場合

Node.js 26 系(`.nvmrc` 参照)、pnpm、Git が必要です。

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

### 翻訳

画面の文言は `public/_locales/<言語>/messages.json` にあります。日本語(`ja`)の文言を正とします。コードからは `src/i18n.ts` の `t()` で、HTML からは `data-i18n="キー"`(属性は `data-i18n-title` など)で使います。

言語を足すときの手順です。

1. `public/_locales/ja/messages.json` をコピーして、`public/_locales/<言語>/messages.json` を作ります。フォルダ名は Chrome の言語コード(`fr`、`pt_BR` など)です。
2. `message` だけを訳します。キーと `placeholders` は変えません。
3. 数で文が変わる文言(キーが `_other` で終わるもの)は、その言語の複数形の分類に合わせて `_one`、`_few`、`_many` などを足せます。分類は `Intl.PluralRules` に従います。
4. `src/i18n.ts` の `LOCALES` に言語コードを足します。
5. `pnpm test:unit` を実行します。訳し漏れ、置き換える値の違い、画面に残った日本語はテストで見つかります。

ツールバーのボタンの説明とショートカットの名前は、`manifest.json` から Chrome が表示するため、設定で選んだ言語ではなく Chrome の言語になります。

### テスト

| コマンド         | 内容                                                                     |
| ---------------- | ------------------------------------------------------------------------ |
| `pnpm test:unit` | Vitest で撮影処理、保存処理、設定画面をテストし、型もチェックします      |
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
manifest.json  拡張機能の定義(version はビルド時に package.json から設定します)
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
