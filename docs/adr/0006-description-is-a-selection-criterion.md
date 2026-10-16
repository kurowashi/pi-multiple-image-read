# ADR 0006: ツールの description は「read ではなくこのツールを選ぶ」基準だけを書く

## 状況

description は、毎回のリクエストでツール定義として送られます。Pi がモデルに送るのは、ツール名・description・入力スキーマです（`label` は送られません。`@earendil-works/pi-ai` の `anthropic-messages.js`）。

初版の description（233字）は、ラベルの仕様、返答テキストの内容、1回の上限、`offset` の使い方を書いていました。これらはツールの出力を説明するもので、ツールを使うかどうかの判断には使われません。

ツールの payload（name・description・input_schema の JSON、文字数）:

| 版 | description | payload |
|---|---|---|
| 初版 | 233字 | 657字 |
| 現版 | 127字 | 422字 |

## 測定

Claude Haiku 5.5 に、組み込みの `read` と本ツールの2つを渡し、最初のツール呼び出しを記録しました（`opencode-go` の直接呼び出し。Pi は経由していません）。試行は各3回です。

| 問い | 正解 | 初版 | 基準の文（現版） | 短い文 |
|---|---|---|---|---|
| フォルダの画像を全部見せて | read_images | 3/3 | 3/3 | 3/3 |
| 3つのパスを列挙 | read_images | 3/3 | 3/3 | 3/3 |
| glob の指定 | read_images | 3/3 | 3/3 | 3/3 |
| 1枚（英語 "Show me"） | read | **0/3** | 3/3 | 3/3 |
| テキストファイル | read | 3/3 | 3/3 | 3/3 |
| 1枚（日本語） | read | 3/3 | 3/3 | 3/3 |
| 2枚の比較 | read_images | 3/3 | 3/3 | 3/3 |

- 基準の文: 「Use instead of read to view two or more local images (a folder, a glob, or several paths) in one call. For one image, use read.」
- 短い文: 「View several local images at once, e.g. a folder of screenshots. Prefer over read for two or more images.」
- 初版は1枚の英語の問いで、3回とも `read_images` を選びました。初版には「1枚なら read」という基準がありません。

## 決定

- description は、`read` より本ツールを選ぶ条件（複数の画像を1回で見る）と、`read` に戻す条件（1枚）だけを書きます。
- ラベル・返答テキスト・上限・`offset` の説明は書きません。返答テキストが、続きの呼び出し（`call again with offset N`）と注記を伝えます。
- 引数の説明は `paths` の形式（ファイル・ディレクトリ・glob）だけにし、`offset` は説明を付けません。

## 理由

- 判断に使われるのは、「いつ選ぶか」の文だけです。出力の説明は、呼び出した後に返答で伝わります。
- 基準の文は、初版で失敗した1枚の問いに正しく答えました。初版より短く、payload は約 36% 減りました。

## 限界

- 測定は7問・3試行・1モデルです。判別力が低く、短い文と基準の文の差は測れていません。
- 測定したのは最初のツール選択だけです。`offset` を返答の指示どおりに使うかは測っていません（[manual-checks](../manual-checks.md) の paging 確認で見ます）。
- 説明を削ったことで、モデルが `offset` を使えなくなる可能性があります。その場合は返答テキストの指示を先に直します。
