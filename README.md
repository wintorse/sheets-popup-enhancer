# Sheets Popup Enhancer

[English](README.en.md) | 日本語

Google スプレッドシートのコメントとセルの編集履歴の幅を広げ、セルの編集履歴をGitHub風に表示するブラウザ拡張機能です。

![編集履歴の変更前後をSplit形式で表示した画面](docs/images/edit-history.png)

![編集履歴の変更前後をUnified形式で表示した画面](docs/images/edit-history-unified.png)

![幅を広げたコメントの画面](docs/images/comments.png)

![拡張機能の設定画面](docs/images/settings.png)

<a href="https://chromewebstore.google.com/detail/oanlemabfmlfpoecknphldpdmiefnljg">
  <picture>
    <source srcset="https://i.imgur.com/XBIE9pk.png" media="(prefers-color-scheme: dark)">
    <img height="58" src="https://i.imgur.com/oGxig2F.png" alt="Chrome Web Store"></picture></a>
<a href="https://addons.mozilla.org/ja/firefox/addon/sheets-popup-enhancer/">
  <picture>
    <source srcset="https://i.imgur.com/ZluoP7T.png" media="(prefers-color-scheme: dark)">
    <img height="58" src="https://i.imgur.com/4PobQqE.png" alt="Firefox add-ons"></picture></a>
<br/><br/>

WXT・Svelte 5・TypeScriptを使用しています。

## Chromeに読み込む

```sh
cd sheets-popup-enhancer
pnpm install
pnpm build
```

1. Chromeで `chrome://extensions` を開き、デベロッパーモードを有効にします
2. 「パッケージ化されていない拡張機能を読み込む」から `apps/extension/.output/chrome-mv3` を選びます
3. Google スプレッドシートのタブをリロードします

## Firefoxに読み込む

```sh
cd sheets-popup-enhancer
pnpm install
pnpm build:firefox
```

1. Firefoxで `about:debugging#/runtime/this-firefox` を開きます
2. 「一時的なアドオンを読み込む」から `apps/extension/.output/firefox-mv3/manifest.json` を選びます
3. Google スプレッドシートのタブをリロードします

一時的に読み込んだ拡張機能はFirefoxを終了すると削除されます。

開発時はChrome向けに `pnpm dev`、Firefox向けに `pnpm dev:firefox` でWXTを起動できます。

## 機能

- コメントとセルの編集履歴の幅を変更
- GitHub 風の差分表示
- 差分の表示形式を Unified・Split から選択
- 「…」メニューから変更前・変更後の値をそれぞれコピー
- 設定画面でのカスタマイズ

## ディレクトリ構成

```text
apps/
  extension/             WXTのブラウザ拡張機能
    entrypoints/         content script と設定ポップアップ
    src/sheets/          スプレッドシート固有の履歴解釈
    src/ui/              スプレッドシート内に設置する Svelte コンポーネント
packages/
  diff-ui/               スプレッドシートに依存しない Svelte の差分表示
  resizable/             フレームワークに依存しないリサイズ操作
tests/browser/           ブラウザテスト
```

## script

```sh
pnpm format           # Oxfmtによるコード整形
pnpm lint             # Oxlintによるコード検査
pnpm check            # lint・整形チェック・TypeScript / Svelteの型チェック
pnpm test             # 履歴解釈・diff・リサイズの単体テスト
pnpm test:e2e         # 拡張機能のビルドとChromeでの操作テスト
pnpm test:e2e:firefox # Firefox向けビルドとFirefoxでの操作テスト
pnpm zip              # 拡張機能の配布用ZIP作成
pnpm zip:firefox      # Firefox向けのZIPとソースコードのZIPの作成
```

※SvelteのテンプレートはOxlintの検査対象外

Chromeのブラウザテストには端末にインストールされたGoogle Chromeを使います。Firefoxのテストには事前に `pnpm exec playwright install firefox` が必要です。

## 制約

本拡張機能はGoogle スプレッドシートのDOM構造や各言語の文言に依存しているため、動作しないロケール（ブラウザや端末の言語設定）があるほか、スプレッドシート側の仕様変更により動作しなくなる可能性があります。

## データの扱い

[プライバシーポリシー](PRIVACY.md)をご覧ください。

## ライセンス

[MITライセンス](LICENSE)です。依存ライブラリなどのライセンスは [THIRD_PARTY_LICENSES.txt](apps/extension/public/THIRD_PARTY_LICENSES.txt) にまとめており、拡張機能にも同梱しています。

## クレジット

拡張機能の名前と設定パネルのUIは、[Sheets Row Highlighter](https://github.com/matsu7089/sheets-row-highlighter) を参考にさせていただきました。
