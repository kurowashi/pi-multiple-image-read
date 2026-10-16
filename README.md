# pi-multiple-image-read

ローカルの複数の画像を、1回のツール呼び出しでモデルに見せる Pi 拡張です。
画像を1枚ずつ `read` に渡す代わりに、ファイル名のラベルを付けた「コンタクトシート」にまとめます。

```
read_images(paths: ["/tmp/shots/"])
  → 24枚ごとのシート（ラベル付き）が画像として入る
  → ラベルで識別できない画像だけ、返答テキストが位置と元のパスを示す
```

## 使い方

モデルは複数の画像を見せるとき `read_images` を呼びます。手動で頼む場合は、次のように書きます。

```
/tmp/shots/ の画像を read_images で全部見て
```

## インストール

```bash
pi install /path/to/pi-multiple-image-read
```

開発とテストは Pi 1.0.3 と Node.js 22.19 以上で行っています。

## ツールの仕様

| 項目 | 内容 |
|---|---|
| ツール名 | `read_images` |
| 引数 | `paths`（文字列の配列、1件以上）。ファイル、ディレクトリ、glob を混ぜて指定できる。全形式を拾うにはディレクトリか `dir/*` を使う（`*.png` は PNG だけになる）。`offset`（省略可、既定 0）は先頭から飛ばす枚数 |
| 対応形式 | PNG / JPEG / WebP / BMP / GIF（GIF は先頭フレーム）。TIFF は対象外 |
| 1回の上限 | 48枚。超える分は `offset` で次の呼び出しに回す。返答に「Showing inputs 1-48 of 130. For the rest, call again with offset 48.」と出る
| 1シートの枚数 | 最大24枚。25枚目以降は次のシートになる |
| シートの大きさ | 長辺 2000 px 以下、画像トークン 4784 以下（Pi の画像上限に収まる）。枚数に応じて配置を変える |
| 並び順 | 入力順。ディレクトリと glob の中は自然順（`img2` は `img10` より前） |
| ラベル | ファイル名（拡張子を除く）。同じ名前が複数あるときは拡張子付きの完全なファイル名 |

### 返答テキスト

ラベルで識別できる画像は、テキストに出ません。テキストが付くのは、次のいずれかの画像がある場合だけです。

```
13 image(s) on 2 sheet(s); positions run in input order, left to right, top to bottom. Listed: labels cut off, not drawn, or shared.
  6. /tmp/shots/a-very-long-name.png (label cut off)
  13. /tmp/shots/other/shot_13.png (label shared with another file)
```

- 位置番号は、シートの左から右、上から下の順の通し番号です。
- `(label cut off)`: ラベルが長すぎて、中央を `…` で省いた（先頭と末尾は残す）。
- `(label not drawn)`: 日本語のラベルを描けなかった（後述）。
- `(label shared with another file)`: 同じ名前のファイルが別のディレクトリにあり、ラベルで区別できない。
- `skipped: <path> (<reason>)`: 読めなかった、または対応外の形式のファイル。残りの画像は返ります。
- 判断の経緯は [docs/adr/0003](docs/adr/0003-text-lists-only-unlabelled-images.md) にあります。

### タイルの大きさに関する注意

1シートに24枚を並べるため、1枚のタイルは小さくなります。細部（小さな文字、指先、ファイルの欠陥など）は見えないことがあります。
タイルが 160 px 未満のときは、返答に注意が付きます。細部が必要なら、元のファイルを `read` で開いてください。

### 日本語のラベル

ラベルには、システムにインストールされた日本語フォントを使います。候補の優先順は次のとおりです。

1. Noto Sans CJK JP
2. Noto Sans JP
3. Droid Sans Fallback
4. Hiragino Sans / Hiragino Kaku Gothic ProN（macOS）
5. Yu Gothic / Meiryo（Windows）

どれも見つからないと、日本語を含むラベルは描かれず、返答に `(label not drawn)` と注記が付きます。
画像の中ではファイル名が読めませんが、返答テキストの位置番号とパスで対応が分かります（その画像が一覧に入ります）。
日本語のラベルを描くには、Noto Sans CJK JP などのフォントをインストールしてください。
なお、macOS と Windows の候補名は、この開発環境では確認していません。

## 失敗の例

失敗すると、原因を示すエラーがツール結果として返ります。セッションは続きます。

| 原因 | エラーの例 |
|---|---|
| 入力が空 | `no images given` |
| glob が一致しない | `no images match: /tmp/none/*.png` |
| ディレクトリに画像がない | `no images in directory: /tmp/empty` |
| 存在しない | `not found: /tmp/missing.png` |
| 明示指定の形式が対応外 | `unsupported image type: /tmp/scan.tiff` |
| offset が範囲外 | `offset 5 is past the last image (1 found)` |
| 復号できない | 返答に `skipped: /tmp/broken.png (cannot decode: ...)` と出て、残りは返る。全件失敗なら `no readable images: ...` |
| TIFF（ディレクトリ・glob 内） | 返答に `skipped: /tmp/x/scan.tif (unsupported image type)` |

## 開発

```bash
npm install
npm run verify   # check, knip, test, coverage
```

設計は [DESIGN.md](DESIGN.md)、制約と変更手順は [AGENTS.md](AGENTS.md)、判断の記録は [docs/adr/](docs/adr/) にあります。
