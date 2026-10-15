# AGENTS.md — pi-multiple-image-read

読者: pi-multiple-image-read を変更するエージェントと開発者。利用者向けの仕様は [README](README.md)、設計判断は [DESIGN.md](DESIGN.md)。
共通の検証と規則はルートの `AGENTS.md` にある。

## 壊してはいけない制約

- 登録するツールは `read_images` の1つだけ。コマンドもイベントハンドラも登録しない（`test/contract/surface.test.ts`）。
- 引数は `paths`（文字列の配列、1件以上）だけで、未知の引数は拒否する（`additionalProperties: false`）。description は280文字以内（`test/contract/surface.test.ts`）。
- 1回の呼び出しは48枚まで。超えるとエラーにし、件数を示す（`test/unit/files.test.ts`）。
- 入力は画像ファイル・ディレクトリ・glob。ディレクトリと glob は画像の拡張子のファイルだけを使い、入力順（自然順）に並べる。重複は1回だけ数える（`test/unit/files.test.ts`）。
- 画像の拡張子は `.png` / `.jpg` / `.jpeg` / `.webp` / `.bmp` / `.gif` だけ。TIFF は対象外で、明示指定すると `unsupported image type` で失敗する（`test/unit/files.test.ts`、[ADR 0001](docs/adr/0001-canvas-for-compositing.md)）。
- 1シートは最大12枚。13枚目以降は次のシートにする（`test/integration/read-images.test.ts`）。
- 1シートの画像トークン（`ceil(w/28) × ceil(h/28)`）は1568以下、長辺は1568 px以下（`test/unit/layout.test.ts`）。
- タイルはソース画像の高さを超えない。タイル同士は重ならず、シートの内側に収まる（`test/unit/layout.test.ts`）。
- シートは PNG で、base64 が 4.5 MiB 以下なら PNG のまま返す。超えるときは JPEG を品質 92 → 85 → 75 → 65 → 50 の順に試し、最初に収まったものを返す。どれも収まらなければ q50 の結果を返し、Pi の自動リサイズに任せる（`test/unit/render.test.ts`）。
- 1枚でも復号できなければ全体を失敗させる。エラーは `cannot read <path>: <reason>`（`test/integration/read-images.test.ts`）。
- 返答テキストは、画像ブロックの後ろに1つだけ置く。入力順の `位置. パス` を示し、切り詰めは `(label cut off)`、描けないは `(label not drawn)` を付ける（`test/integration/read-images.test.ts`）。
- 160 px 未満のタイルがあれば注意の注記を出す（`MIN_TILE`、`test/unit/render.test.ts`、`test/integration/read-images.test.ts`）。
- 日本語フォントは `src/font.ts` の候補から、システムにある最初のものを使う。見つからなければ非 ASCII のラベルは描かず、注記を出す（`test/unit/labels.test.ts`、`test/integration/read-images.test.ts`）。
- ファイルシステム API は `node:fs` を読み取りに使う。`src` が使える node builtin は `node:fs` / `node:os` / `node:path` だけ（`test/contract/dependencies.test.ts`）。
- 実行時依存は `@napi-rs/canvas` の1つだけで、バージョンは固定する。ビルド工程を持たない（`test/contract/dependencies.test.ts`）。

## 変更手順

- 受け付ける形式・上限・配置の数値を変えるときは、先に該当するテストを更新し、README の仕様表と DESIGN.md を同じコミットで更新する。
- ツール名・引数・description を変えるときは、`test/contract/surface.test.ts` を先に更新する。
- 依存を追加・更新するときは、`test/contract/dependencies.test.ts` の許可リストと [ADR 0001](docs/adr/0001-canvas-for-compositing.md) を同じコミットで更新する。
- 日本語フォントの候補を変えるときは、[ADR 0002](docs/adr/0002-os-fonts-for-labels.md) を読み、描画の実測結果を添える。
- 手動で確認する項目は [docs/manual-checks.md](docs/manual-checks.md) に書く。
- 検証は `npm run verify`（check、knip、test、coverage）。CI は Node 22.19 と 24 で動く。
