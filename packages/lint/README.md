# @toony/lint

Headless, deterministic production-readiness lints for Toony projects. Phase 1
covers schema/sequence lints and pure image analysis. No cloud services and no
third-party image codecs.

## Findings

Every lint returns `Finding[]`:

```ts
interface Finding {
  severity: "error" | "warning" | "info";
  code: string;     // namespaced, e.g. "schema/..." or "image/..."
  targetId: string; // record id, project path, or image id
  message: string;  // actionable
}
```

`error` is a project that is wrong, `warning` one that is right but will not read
as intended, `info` a note. What each means for an exit code belongs to the
consumer: `toony lint` blocks on `error` AND `warning`, so only `info` leaves it
at 0. `sortFindings` gives a stable order and `isClean` reports whether any
`error` is present — which is a narrower question than whether `toony lint`
passes.

## Schema and sequence lints

`lintProjectSchema(project)` consumes `@toony/schema`'s `validateProject` — it
does not reimplement structural rules. Each schema issue (including
sequence-reference problems: missing/orphan records, adjacent transitions)
becomes an `error` finding under the `schema/` namespace.

## Image analysis

Pure and deterministic, operating on decoded rasters:

- `decodePng(buffer)` — minimal 8-bit PNG decoder (grayscale/RGB/RGBA,
  non-interlaced) built on Node's `zlib`. Throws `ImageDecodeError` on
  unsupported/corrupt input.
- `readImageDimensions(buffer)` — header-only dimensions for PNG/JPEG/GIF/WebP.
- `analyzeRaster(raster, id, options?)` — blank, corrupt-raster, dimension,
  aspect, darkness, and low-contrast checks, plus an optional
  compression-feasibility estimate.
- `analyzeImageBuffer(buffer, id, options?)` — decodes PNGs for full pixel
  analysis; for other recognized formats, checks header dimensions and notes
  that pixel analysis was skipped; unreadable buffers produce an error.

### Compression feasibility

`estimateCompressibleBytes(raster, targetWidth?)` optionally downscales, drops
alpha, and `deflate`s the RGB bytes as a deterministic proxy. Deflate is
lossless and generally larger than a lossy WebP at the same dimensions, so a
proxy within budget implies a lossy re-encode also fits (`image/compression-ok`).
When the proxy exceeds budget the outcome is advisory
(`image/compression-uncertain`) — it is not a real WebP size.

All thresholds (`DEFAULT_IMAGE_ANALYSIS_OPTIONS`) are configurable.

## Bubble-text overflow

`lintBubbleOverflow(bundle, resolveImage, options?)` reuses `@toony/render`'s
`layoutCut` — the single source of truth for lettering geometry — and reports a
`warning` (`lettering/overflow`) for every overlay whose text overflows its box
even at the minimum font size. It does not re-measure or re-lay-out text; it only
attributes the layout's `overflow` flag. Cut pixel dimensions come from the
header reader (`readImageDimensions`) when an image is present; otherwise the cut
is staged at the shape it declares (`Cut.panelAspect`), and only a cut declaring
nothing falls to the documented fallback `DEFAULT_OVERFLOW_FALLBACK` (a typical
portrait cut), which keeps the check deterministic. `resolveImage(cutId)` returns
the cut's encoded image bytes, or `null` when none is associated.

Staging an art-less cut at its declared shape matters because every cut in a
pack's genre scaffold is art-less: what fits a bubble box depends on the font
floor, the floor is derived from the render height, and a scaffold's declared
height was reaching nothing here.

## Declared vs rendered panel shape

`lintPanelShape(bundle, resolveImage)` reports a `warning`
(`cut/panel-aspect-mismatch`) for every cut whose art sits further than
`PANEL_ASPECT_TOLERANCE` from the `panelAspect` it declares. A declaration binds
when the art is made — generation resolves it into the latent height — so a cut
that already carried art keeps composing at that art's shape, and the declaration
is then describing a page that is not the page. Re-generate the cut to bind it,
or drop the declaration.

A cut that declares nothing is never reported, whatever shape its art is, and
neither is one with no readable art. The tolerance is the generator's own 8px
latent snap, not a taste call: see the constant's comment for the derivation and
`packages/cli/src/__tests__/panel-shape.test.ts` for the assertion that it still
covers it.

Both this and the overflow stage go through `@toony/render`'s `resolveCutAspect`
— *a cut's shape is its declaration, else its image's, else the fallback* — which
the export raster and the studio reader also stage art-less cuts with.

## Export-manifest completeness

`lintManifestCompleteness(manifest, manifestId, resolveFile?)` consumes
`@toony/export`'s manifest contract rather than redefining it: `validateManifest`
owns structure, project-relative path safety, and quality bounds, and the
PlotLink constraints come from the exported `PLOTLINK_*` constants. On top of the
structural check it adds the PlotLink semantics (all WebP, ≤20 images, ≤1MB each,
markdown present), a reading-order check on the declared file order, and — when a
`resolveFile` probe is supplied — on-disk existence and `byteSize` consistency.

## OCR (accidental text/logo/watermark detection)

**Excluded from the MVP, deliberately.** OCR for detecting accidental
text/logos/watermarks in generated art requires either a heavy native/WASM
engine (e.g. a Tesseract build plus per-language trained data — megabytes of
dependency and a non-deterministic, locale-sensitive result) or a cloud OCR
service (network access and credentials). Both violate this package's
constraints: dependency-light, fully offline/deterministic, and no
secrets/network in a public repo. It is therefore left out until a lightweight,
deterministic, offline option exists. This is an explicit decision, not a silent
drop; revisit if requirements change.

## Commands

- `pnpm --filter @toony/lint build`
- `pnpm --filter @toony/lint typecheck`
- `pnpm --filter @toony/lint test`
