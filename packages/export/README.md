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
- **plotlink** — consecutive cuts, lettering and transition bands packed into
  **≤20 WebP strips per episode, ≤1,000,000 bytes each**, plus generated markdown
  (**500–10,000 chars**, enforced) and a manifest. Keeps one episode and the
  requested width and quality (defaults: 800px, quality 82); never silently
  shrinks lettering or lowers quality. Prepares content only — never uploads or
  publishes.

Each target writes into the project's `episodes/<id>/exports/<target>/` folder
and emits `manifest.json`. Toony does not upload or publish to PlotLink.

PlotLink packing prefers boundaries between complete rendered cuts/transitions.
A block too tall for WebP's **16,383px** dimension limit, or too large to encode
within the byte budget alone, is split at exact integer rows without omitted or
duplicated pixels. The adjacent strips reproduce the full rendered page. Widths
above the WebP limit are rejected. If the complete sequence needs more than 20
strips at the requested settings, export fails with an actionable error; callers
can explicitly choose a smaller width or lower quality and review readability.
Packing is deterministic and greedy, not a promise that every episode can fit.

All strips are encoded before replacing a previous PlotLink package. Publication
stages a complete directory and preserves unrelated files; obsolete images are
removed only when owned by the previous valid manifest. A conflicting unowned
output filename is reported without overwriting it. The bounded markdown is a
support artifact and may be truncated at a line boundary above 10,000 characters;
the image strips still contain the complete rendered episode.

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
