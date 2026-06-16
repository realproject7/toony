# @toony/export

Headless export for Toony episodes: platform image sequences, stitched episode
images, and PlotLink-ready WebP packages — plus the export **manifest schema**.

Compositing/encoding uses `@napi-rs/canvas` (self-contained skia; PNG/JPEG/WebP).
All lettering/transition geometry comes from `@toony/render`
(`layoutCut`/`layoutTransition`), so export matches the studio preview and never
invents its own layout.

## Targets

- **platform** — one PNG/JPEG per cut, in reading order, at a configurable width
  and compression.
- **stitched** — one long image preserving cuts, gutters, transitions, and
  lettering.
- **plotlink** — WebP images (**≤20 per episode, ≤1MB each**, reading order) with
  active resize/recompress-to-fit, plus generated markdown (**500–10,000 chars**,
  enforced) and a manifest. Prepares content only — never uploads or publishes.

Each target writes into the project's `episodes/<id>/exports/<target>/` folder
and emits `manifest.json`. Toony does not upload or publish to PlotLink.

## Manifest schema (owned here)

`ExportManifest`: `manifestVersion`, `target`, `projectId`, `episodeId`, `width`,
ordered `files[]` (each with a **project-relative** `path`, `format`, `width`,
`height`, `byteSize`, `quality`, `sha256`), and `markdown` (path + character
count + sha256) for the plotlink target. `validateManifest(value)` returns a
list of problems — including any non-project-relative path — for #11 to lint
completeness against.

## Public safety

Manifests and outputs use project-relative paths only; no absolute paths,
provider details, or logs are written. Filesystem errors are wrapped so absolute
paths never reach output.

## Commands

- `pnpm --filter @toony/export build | typecheck | test`

CLI: `toony export <platform|stitched|plotlink> [path] --episode <id> [--width <px>] [--format png|jpg] [--quality <0-100>]`.
