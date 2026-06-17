# Self-hosted curated fonts (OFL)

These are the curated lettering faces for Toony, all free Google Fonts under the
**SIL Open Font License (OFL)**. Every face ships as a self-hosted `.woff2`
(never fetched from a CDN at runtime) with its `OFL.txt` license beside it. The
`@toony/fonts` registry (`../src/registry.ts`) is the single source of truth that
maps a family id to these files; `@toony/render`, `@toony/export`, and the studio
all import it so the SAME face renders in the SVG preview and the exported raster.

## Curated set

| id             | family            | scripts          | weights   | role                       |
| -------------- | ----------------- | ---------------- | --------- | -------------------------- |
| `nunito`       | Nunito            | Latin            | 400, 700  | clean dialogue (Latin)     |
| `noto-sans-kr` | Noto Sans KR      | Latin + Korean   | 400, 700  | clean dialogue (KO)        |
| `noto-sans-jp` | Noto Sans JP      | Latin + Japanese | 400, 700  | clean dialogue (JP)        |
| `bangers`      | Bangers           | Latin            | 400       | shout / titles             |
| `anton`        | Anton             | Latin            | 400       | impact / sfx               |
| `patrick-hand` | Patrick Hand      | Latin            | 400       | thought / narration        |
| `gaegu`        | Gaegu             | Latin + Korean   | 400, 700  | Korean handwriting (soft)  |
| `nanum-pen`    | Nanum Pen Script  | Latin + Korean   | 400       | Korean handwriting (pen)   |

## Subset approach (why the bundle stays light)

The Latin faces are subset to ASCII plus common typographic punctuation. The CJK
faces are the expensive ones, so they are subset to a curated glyph coverage at
build time rather than shipping the full multi-megabyte fonts:

- **Korean** faces (`noto-sans-kr`, `gaegu`, `nanum-pen`): 4,941 codepoints —
  ASCII + punctuation, the modern Hangul jamo, and the everyday Hangul syllable
  block composed from the 19 leading consonants × 21 vowels × the common final
  consonants. This covers virtually all everyday Korean text while leaving out
  the rare-syllable long tail that bloats the full block (11,172 syllables).
- **Japanese** faces (`noto-sans-jp`): 2,606 codepoints — ASCII + punctuation,
  full hiragana and katakana, and ~2,300 frequency-ordered common kanji. This
  covers the Jōyō range and ordinary prose.

Variable source fonts (Noto Sans KR/JP, Nunito) are instanced to static weight
files (400 and 700) before subsetting. Glyphs outside the subset fall back to the
registry's generic `sans-serif` fallback in the stack, both in the browser and in
the canvas, so text never disappears.

Subsetting was done with `fonttools` (`fontTools.subset` + `fontTools.varLib.
instancer`) producing `woff2`. `@napi-rs/canvas` registers these same `woff2`
files directly (verified: identical text metrics to the source TTF), so export
and the studio share one set of files — no parallel TTF set is shipped.

## Sizes (woff2, on disk)

| file                     | size    |
| ------------------------ | ------- |
| `nunito-400.woff2`       | 38 KB   |
| `nunito-700.woff2`       | 38 KB   |
| `bangers-400.woff2`      | 23 KB   |
| `anton-400.woff2`        | 31 KB   |
| `patrick-hand-400.woff2` | 23 KB   |
| `noto-sans-kr-400.woff2` | 282 KB  |
| `noto-sans-kr-700.woff2` | 288 KB  |
| `noto-sans-jp-400.woff2` | 417 KB  |
| `noto-sans-jp-700.woff2` | 426 KB  |
| `gaegu-400.woff2`        | 68 KB   |
| `gaegu-700.woff2`        | 189 KB  |
| `nanum-pen-400.woff2`    | 372 KB  |
| **total**                | ~2.2 MB |

The Latin editor faces total under ~155 KB; the CJK faces are lazy-loaded (the
studio injects `@font-face` only when an episode actually uses them) so the
library and reader stay light when no CJK lettering is present.

## Licenses

Each `*-OFL.txt` is the upstream SIL Open Font License for the corresponding
family, fetched from the `google/fonts` repository's `ofl/` directory. The OFL
permits bundling, self-hosting, and redistribution; these files satisfy that
requirement. The fonts are used unmodified except for glyph subsetting and weight
instancing, which the OFL permits.
