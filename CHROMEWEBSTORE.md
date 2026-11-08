# Chrome Web Store Listing — Sheets Popup Enhancer

- Last Updated: 2026-11-08

## Store Listing

- Extension Name: Sheets Popup Enhancer
- Short Description: Google スプレッドシートのコメントとセルの編集履歴の幅を広げ、セルの編集履歴をGitHub風に表示します。
- Detailed Description: Google スプレッドシートのコメントとセルの編集履歴を、読みやすい幅に調整できます。対応する編集履歴では、変更前と変更後の値を比較し、変更した箇所を強調します。差分の表示形式はUnified・Splitに切り替えられ、変更前後の値をそれぞれコピーできます。長文は色分けや行番号を付けずに表示します。デフォルトの幅・文字サイズ・表示形式は設定から変更でき、設定は端末に保存されます。
- Category: Productivity
- Single Purpose: Google スプレッドシートのコメントとセル編集履歴を読みやすく表示する。
- Primary Language: Japanese

## Permissions Justification

| Permission / scope | Type | Justification |
| --- | --- | --- |
| storage | permissions | ポップアップの初期幅、文字サイズ、diffの有効状態と表示形式を端末内に保存するため |
| https://docs.google.com/spreadsheets/* | content_scripts.matches | Google スプレッドシート内のコメントと編集履歴の表示を変更し、画面上の履歴から変更前後の値を比較するため |
| content-scripts/sheets.css | web_accessible_resources | ページに追加する差分表示とリサイズ操作のスタイルを、同梱リソースから読み込むため |

`host_permissions` の追加指定はありません。

## Privacy & Data Use

- プライバシーポリシー: [PRIVACY.md](PRIVACY.md)（公開先のURLをデベロッパーダッシュボードに登録）
- サーバーへのデータ収集・送信はありません。
- 表示中のセル編集履歴は、差分表示のため端末内で処理します。内容は保存しません。
- コピー操作を選択した場合、指定された値を端末のクリップボードに書き込みます。
- 保存するのは幅、文字サイズ、表示形式、diffの有効状態のみです。`chrome.storage.local`を使います。
- 分析・広告・外部スクリプトはありません。
- データを販売せず、機能に無関係な目的や信用評価には利用しません。

## Version History

- 1.0.0（開発中）: 差分本文は等幅フォントで表示し、メニュー・エラー表示のフォント指定は Sheets のコメントと揃えました。

## Screenshot Updates

- ストア掲載用の差分表示のスクリーンショットは、フォント変更後の表示で更新してください。
