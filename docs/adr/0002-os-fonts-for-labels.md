# ADR 0002: 日本語ラベルは OS のフォントを使い、同梱しない

## 状況

タイルのラベルにはファイル名を描きます。ファイル名には日本語を含みうるため、日本語を描けるフォントが必要です。

実測した事実は次のとおりです（Linux、`@napi-rs/canvas` 1.0.11）。

- 明示的なフォント名のリストで指定したときだけ日本語が描かれます（`"Noto Sans CJK JP", "Droid Sans Fallback", sans-serif`）。
- 汎用名 `sans-serif` だけを指定すると、日本語は空白になります。
- `Noto Sans`（日本語を含まない版）だけでは、日本語が豆腐（□）になります。
- フォントの自動フォールバックは起きません。

同梱フォントのサイズ（Noto Sans CJK JP Regular）は次のとおりです。

| 形式 | サイズ |
|---|---|
| JIS X 0208 のサブセット | 4.3 MB |
| JIS 第1水準のサブセット | 2.0 MB |
| 全日本語 | 16.5 MB |
| TTC（全体） | 19.5 MB |

## 決定

- フォントは同梱しません。OS にインストール済みのフォントを使います。
- 候補は `src/font.ts` の `CJK_FAMILIES` に優先順で並べます（Noto Sans CJK JP、Noto Sans JP、Droid Sans Fallback、Hiragino Sans、Hiragino Kaku Gothic ProN、Yu Gothic、Meiryo）。
- 選択は `GlobalFonts.has` で行い、最初に見つかった名前を使います。
- 見つからない場合は、非 ASCII のラベルを描きません。返答テキストには、位置とパス、そして `label not drawn` の注記を出します。
- ASCII だけのラベルは、フォントの有無に関係なく描きます。

## 理由

- 同梱は、最も小さい構成でも 2.0 MB（JIS 第1水準）から、全文字だと 16.5 MB かかります。パッケージサイズに対して、得られる範囲が見合いません。
- OS のフォントを使うと、取得物は増えません。
- 「描けない場合は描かず、理由を返す」にすると、ファイル名の情報は返答テキストから失われません。描けないことを画像の中に偽装しません。

## 実測の範囲と未確認

- Linux（Noto Sans CJK JP）で、`GlobalFonts.has("Noto Sans CJK JP")` と日本語の描画を確認しました。`Noto Sans JP` は、この環境では `has` が偽でした。
- macOS と Windows の日本語フォント名（Hiragino Sans、Yu Gothic、Meiryo など）は、この環境では確認できていません。候補リストに入れていますが、名前が一致するかは未検証です。ラベルが描けない場合は、返答の `label not drawn` で分かります。
- `@napi-rs/canvas` は、`loadSystemFonts()` でシステムのフォントを読み込みます（`index.js` の実装）。加えて、Windows では `~/AppData/Local/Microsoft/Windows/Fonts`、macOS では `~/Library/Fonts` も読み込みます。環境変数 `DISABLE_SYSTEM_FONTS_LOAD` が設定されていると、この読み込みは行いません。

## 却下した代替

- **同梱（サブセット）**: 2.0〜4.3 MB を毎回取得させることになります。日本語の文字集合が変わると、サブセットを作り直す手順が増えます。
- **Photon の文字描画**: Roboto のみで、日本語のグリフがありません。
- **描けない文字を豆腐のまま描く**: 利用者が画像の内容を誤って読みます。

## 帰結

- 日本語の描画は、利用者の OS にフォントがあるかどうかに依存します。`manual-checks.md` で環境ごとの確認項目を持ちます。
- 候補リストへのフォント追加は、実測した描画結果（名前が一致し、日本語が出ること）を添えて行います。
- `readImages` の `fontFamily` 引数は、テストで「フォントなし」を再現するためのものです。利用者向けの設定ではありません。
