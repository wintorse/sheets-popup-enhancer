# Google スプレッドシートのセル編集履歴

Google スプレッドシートのセルの編集履歴には、単に変更前後の全文を示す形式もあるが、変更前の全文と、置換・追加・削除した部分のみを表示する形式もある。ただし後者はセルの最新の編集履歴限定の機能である。

そしてこの部分変更の表示は言語によってはマークアップや翻訳が不適切であり、[2019年の機能追加](https://workspaceupdates.googleblog.com/2019/06/edit-history-sheets.html)以降おそらく放置されてしまっている。ここでは `apple banana citrus` の `banana` を `orange` に置き換えた例で現状の仕様を比較する。

## スプレッドシートが表示する部分変更の HTML

以下は履歴表示とその HTML の例。読みやすいよう改行と字下げを行っている。

### 英語

表示イメージ:

> **Replaced:** *"banana"* **with** *"orange",* **within** *"apple banana citrus"*

HTML:

```html
<div class="docs-blameview-value-content">
  <span class="docs-blame-bold-text">Replaced:</span>
  "banana"
  <span class="docs-blame-bold-text">with</span>
  "orange",
  <span class="docs-blame-bold-text">within</span>
  "apple banana citrus"
</div>
```

### 日本語

HTML の構造は英語に準じているが、不自然な日本語となっている。またこれはフォントの都合だが、Mac で Chromium / Gecko 系ブラウザのデフォルトの sans-serif 用フォントとして使用される Hiragino Kaku Gothic ProN は MacOS 26 時点では font-weight: 500 で太字にならず、Regular (W3) で表示される。

表示イメージ:

> **置き換えました:** *"banana"* **から** *"orange",* **期間** *"apple banana citrus"*

HTML:

```html
<div class="docs-blameview-value-content">
  <span class="docs-blame-bold-text">置き換えました:</span>
  "banana"
  <span class="docs-blame-bold-text">から</span>
  "orange",
  <span class="docs-blame-bold-text">期間</span>
  "apple banana citrus"
</div>
```

### 中国語・簡体字

太字の要素が入れ子になっていて、両方の断片に二重に引用符がついている。「范围」の次の「：」も斜体となっている。

表示イメージ:

> **已用“"orange"”替换“"banana"”**, **范围** *："apple banana citrus"*

HTML:

```html
<div class="docs-blameview-value-content">
  <span class="docs-blame-bold-text">
    已用
    <span class="docs-blame-bold-text">“"orange"”</span>
    替换“"banana"”
  </span>
  ,
  <span class="docs-blame-bold-text">范围</span>
  ："apple banana citrus"
</div>
```

### 中国語・繁体字

変更前の断片の引用符は `「」` と `""` が重なり、文をつなげて読むと `已` が重複する。「範圍」の次の「：」も斜体となっている。

表示イメージ:

> **已將「***"banana"***」已取代為：***"orange",* **範圍**&#8203;*："apple banana citrus"*

HTML:

```html
<div class="docs-blameview-value-content">
  <span class="docs-blame-bold-text">已將「</span>
  "banana"
  <span class="docs-blame-bold-text">」已取代為：</span>
  "orange",
  <span class="docs-blame-bold-text">範圍</span>
  ："apple banana citrus"
</div>
```

### 韓国語

操作名が値の後ろにくる。助詞の候補 `이(가)` と `(으)로` がそのまま表示され、`교체됨` の直後に空の太字要素が付く場合がある。 

表示イメージ:

> *"banana"이(가) "orange"(으)로* **교체됨**&#8203;*, "apple banana citrus"* **이내**

HTML:

```html
<div class="docs-blameview-value-content">
  "banana"이(가) "orange"(으)로
  <span class="docs-blame-bold-text">교체됨</span>
  <span class="docs-blame-bold-text"></span>
  , "apple banana citrus"
  <span class="docs-blame-bold-text">이내</span>
</div>
```

## 拡張機能での取り扱い

Sheets Popup Enhancer では、こういった部分変更表示に対しては以下の手順で変更前後の全文を取得している。

1. 履歴の「次の編集」ボタンが無効であることを確認し、数式バーから現在のセルの値を取得する。
2. 履歴の HTML を言語ごとに読み取り、変更前の全文と、置換・追加・削除された部分を取り出す。上の例では、変更前の全文が `apple banana citrus`、置換の内容が `banana` から `orange` への変更となる。
3. 履歴に記載された変更で数式バーの現在値を説明できるか確認する。整合すれば、現在値の `apple orange citrus` を変更後の全文として差分を表示する。

数式バーの値を取得できない場合や、履歴の HTML を解釈できない場合、変更内容と現在値が一致しない場合は、スプレッドシート標準の履歴表示を使う。
