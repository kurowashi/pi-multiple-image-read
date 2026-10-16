# ADR 0001: 画像の合成とエンコードに @napi-rs/canvas を使う

## 状況

複数の画像を1枚のシートに並べ、タイルごとにファイル名のラベルを描きます。必要な処理は次の4つです。

1. 画像の復号（PNG / JPEG / WebP / BMP / GIF、EXIF の向き補正、16bit グレースケール、透過の合成）
2. 縮小と配置（タイル単位の描画）
3. 文字の描画（ファイル名。日本語を含む）
4. PNG / JPEG へのエンコード（品質を段階的に下げて上限に収める）

Pi の拡張 API には、タイルを合成する公開 API も文字を描く公開 API もありません（Pi 1.2.0 の公開 API は `resizeImage` / `convertToPng` / `formatDimensionNote` だけです）。このため、合成は拡張側で行う必要があります。

本プラグインは「実行時依存ゼロ」を原則にしてきた他のプラグインと違い、この処理を自前では書けません。依存を入れるか、別の手段を取るかを判断しました。

## 決定

`@napi-rs/canvas` 1.0.11 を唯一の実行時依存として採用します。バージョンは固定します（`^` を使わない）。

## 理由

- 4つの処理（復号・縮小・文字・エンコード）を1つのライブラリで満たします。Skia ベースで、EXIF 向き補正、16bit グレースケール、透過画像、アニメーション GIF の先頭フレームを扱えることを実測で確認しました。
- 文字は、システムフォントを指定すると日本語が描けることを実測で確認しました（`Noto Sans CJK JP` など。[ADR 0002](0002-os-fonts-for-labels.md)）。
- 配布は npm の `os` / `cpu` フィルタで、利用者の環境に合うバイナリ1つだけが入ります。

## 取得物の大きさ（実測）

| 対象 | 展開後のサイズ | 備考 |
|---|---|---|
| `@napi-rs/canvas` 本体 | 125.6 KB | JavaScript のラッパー |
| `@napi-rs/canvas-linux-x64-gnu` | 34.8 MB（tarball 14.2 MB） | 本プラグインを動かした環境 |
| `@napi-rs/canvas-darwin-arm64` | 28.1 MB（tarball 12.9 MB） | |
| `@napi-rs/canvas-darwin-x64` | 33.0 MB（tarball 13.7 MB） | |
| `@napi-rs/canvas-linux-x64-musl` | 31.1 MB（tarball 13.1 MB） | |
| `@napi-rs/canvas-linux-arm64-gnu` | 29.5 MB（tarball 13.1 MB） | |
| `@napi-rs/canvas-win32-x64-msvc` | 38.4 MB（tarball 15.3 MB） | |

大きさは `npm pack --dry-run` で計測しました。npm は `os` / `cpu` が一致するバイナリだけを取得するため、利用者に入るのは1つです。上の表は他の対象環境の参考値です（未計測のプラットフォームは含みません）。

## 却下した代替

- **`@silvia-odwyer/photon-node` 0.3.4**（WASM 1.88 MB）: 文字描画は Roboto のみで、日本語のグリフがありません。ラベルを ASCII に限ると、日本語のファイル名は利用者の要求を満たせません。
- **Pillow（Python）**: 旧 MCP サーバーで使っていました。Python と uv の実行環境が増え、Pi 拡張として TypeScript で統一する方針に反します。
- **純 JavaScript の復号器（pngjs / jpeg-js など）と文字ラスタライズを自前で組み合わせる**: 未計測です。復号器と、フォントのパース・アンチエイリアス付きの描画を別々に持つことになり、検証の範囲が本件の目的（ラベルを読めるシート）より大きくなると見積もって却下しました。

## 帰結

- 依存の許可リストは `test/contract/dependencies.test.ts` の `ALLOWED_RUNTIME_DEPENDENCIES` に1件だけあります。別の実行時依存を足すには、この ADR を更新してからにします。
- `src` が使える Node builtin は `node:fs` / `node:os` / `node:path` だけです（ファイルの読み取り、ホームディレクトリの展開、パスの解決）。
- TIFF は canvas が復号できないため対象外です。`.tif` / `.tiff` を明示指定すると「unsupported image type」で失敗します。ディレクトリと glob では、画像でないファイル（テキストなど）は黙って除外し、TIFF は `skipped` として返答に列挙します（`src/files.ts`、`test/unit/files.test.ts`）。
- Linux x64 で canvas のネイティブバイナリを読み込めない環境では、拡張の読み込みが失敗します。この場合の代替は未定です。
- 依存の更新は、描画結果（タイル位置・ラベル・サイズ上限）がテストで変わらないことを確認してから行います。
