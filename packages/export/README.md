# @toony/export

Headless export for Toony episodes: an episode strip (whole or in parts), one
image per cut, and fixed-size social frames, plus the export **manifest schema**.

Compositing and encoding use `@napi-rs/canvas` (self-contained skia; PNG and
JPEG). All lettering and transition geometry comes from `@toony/render`
(`layoutCut`/`layoutTransition`), so every output matches the Studio preview and
never invents its own layout.

## Outputs

Three engines share one composition path (`composeCut` and
`composeTransitionBand`) and one pure layout planner (`./layout`, also a
browser-safe subpath the Studio preview uses):

- **strip** (`exportStrip`): the reading sequence stacked into one tall image,
  identical to the page craft measurement reads (`stitchEpisode`). With
  `sliceHeight` it writes parts instead. Each part takes the longest run of whole
  bands that fits; only a band taller than a part is split, at exact integer rows,
  so the parts restack to the full strip pixel for pixel. With `maxBytes` a part
  that encodes too large gives back its last band, and a single band is cut at the
  largest row count that fits, found by real encodes. Width and quality never
  change silently. Parts compose bands on demand and free them after their last
  use, so the full page is never allocated.
- **cuts** (`exportCuts`): one opaque image per cut at `width`, the cut composed
  at `width - 2 * margin` and placed on a white background. `textCards: true` also
  writes every transition that carries words as its own image.
- **social** (`exportSocial`): frames of a fixed size (`instagram-portrait`
  1080 x 1350, `instagram-square` 1080 x 1080, `x-landscape` 1600 x 900). Content
  stays inside the frame's safe insets. Bands are packed whole per frame and a
  plain gap never starts or ends one. A cut taller than the content box is split
  into rows (`tallCuts: "split"`, the default) or, with `"fit"`, composed narrower
  so it fits whole when that keeps it at least 0.6 of the reference column wide.
  Frames are grouped into posts (20 per Instagram post, 4 per X post).

Built-in outputs (presets): `strip`, `cuts`, `instagram`, `instagram-square`,
`x`, and `webtoon` (strip at 800 px, 1280 px parts, JPEG quality 90). `stitched`
and `platform` resolve to `strip` and `cuts`. Packs may contribute more presets.
`exportWithPreset` runs one, with explicit options overriding what it pins.

Every output writes `episodes/<id>/exports/<output>/`. All files are encoded
before anything on disk changes; the folder is staged beside the old one and
swapped. A previous file is replaced or removed only when the previous valid
manifest lists it and its bytes still match the recorded size and SHA-256, so
unrelated files are preserved and a changed or symlinked output stops the export
without replacing anything. Export folders written by earlier versions are never
read or changed.

## Manifest schema (owned here)

`ExportManifest` (version 2): `kind`, `output`, `projectId`, `episodeId`, `width`,
the resolved `options`, ordered `files[]` (each with a **project-relative**
`path`, `format`, `width`, `height`, `byteSize`, `quality`, `sha256`, a `role`
of `strip`, `slice`, `cut`, `card` or `frame`, the sequence `items` it shows with
row ranges for split pieces, and a `post` for social frames), `warnings` (for
example cuts without artwork) and `inputs.sha256`, a hash of what the files were
rendered from. `episodeInputsHash(root, episodeId)` computes the current value,
so a caller can tell when an export is out of date. `validateManifest(value)`
returns a list of problems, including any non-project-relative path.

## Public safety

Manifests and outputs use project-relative paths only; no absolute paths,
provider details, or logs are written. Filesystem errors are wrapped so absolute
paths never reach output.

## Commands

- `pnpm --filter @toony/export build | typecheck | test`

CLI: `toony export <episode> [path] --output <strip|cuts|instagram|instagram-square|x|webtoon|preset> [--width <px>] [--slice-height <px>] [--format png|jpg] [--quality <0-100>] [--margin <px>]`.
