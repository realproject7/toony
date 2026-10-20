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

The files are subsets; a family's script label is a browsing aid, not proof that
any particular character is present. Coverage differs between the Korean faces,
and the Gaegu files have no grave accent (`` ` ``). Do not infer glyph
availability from a filename or the family name.

`../src/coverage-data.ts` records each file's SHA-256 and actual cmap intervals.
Tests tie this metadata to the bundled bytes. Regenerate from the repository root
with `python3 scripts/font-coverage.py` (local FontTools and Node are required),
then format that generated file with Biome. This maintenance step downloads
nothing. Runtime code and normal builds do not need Python.

New range layout resolves each complete grapheme to a supporting bundled face
and reports the effective fallback in Studio. If no bundled face supports it,
the text is preserved and Studio reports unresolved codepoints. System fallback
in that case is not preview/export parity evidence. Cmap coverage alone is not a
complex-script shaping guarantee. Existing legacy lettering retains its original
host fallback until explicitly converted.

The Noto Sans KR/JP files are static weight instances. The current Nunito 400/700
files contain identical variable data with a default weight of 200; their names
alone do not select a static instance. Range-aware lettering selects the requested
weight axis during raster measurement and drawing, matching CSS. Legacy rendering
retains its previous behavior for compatibility.

Subsetting was done with `fonttools` (`fontTools.subset` + `fontTools.varLib.
instancer`) producing `woff2`. `@napi-rs/canvas` registers these same `woff2`
files directly (verified: identical text metrics to the source TTF), so export
and the studio share one set of files — no parallel TTF set is shipped.

Anton is the google/fonts Anton 2.116 release subset to the Google Fonts latin and
latin-ext ranges (Basic Latin, Latin-1, Latin Extended, common punctuation). It
keeps hinting, glyph names and the `ccmp`, `locl`, `kern`, `mark` and `mkmk`
features.

## Sizes (woff2, on disk)

| file                     | size    |
| ------------------------ | ------- |
| `nunito-400.woff2`       | 38 KB   |
| `nunito-700.woff2`       | 38 KB   |
| `bangers-400.woff2`      | 23 KB   |
| `anton-400.woff2`        | 39 KB   |
| `patrick-hand-400.woff2` | 23 KB   |
| `noto-sans-kr-400.woff2` | 282 KB  |
| `noto-sans-kr-700.woff2` | 288 KB  |
| `noto-sans-jp-400.woff2` | 417 KB  |
| `noto-sans-jp-700.woff2` | 426 KB  |
| `gaegu-400.woff2`        | 68 KB   |
| `gaegu-700.woff2`        | 189 KB  |
| `nanum-pen-400.woff2`    | 372 KB  |
| **total**                | ~2.2 MB |

The Latin editor faces total about 160 KB. The studio declares all curated
`@font-face` rules globally (a single static `lettering-fonts.css`, generated
from this registry), but with `font-display: swap` the browser fetches a face's
woff2 only when that family is first actually used. So the heavy CJK files are
not downloaded eagerly: the library and reader stay light until a page renders
text in a CJK family.

## Licenses

Each `*-OFL.txt` is the upstream SIL Open Font License for the corresponding
family, fetched from the `google/fonts` repository's `ofl/` directory. The OFL
permits bundling, self-hosting, and redistribution; these files satisfy that
requirement. The fonts are used unmodified except for glyph subsetting and weight
instancing, which the OFL permits.
