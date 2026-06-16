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

`error` blocks; `warning`/`info` are advisory. `sortFindings` gives a stable
order and `isClean` reports whether any error is present.

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

All thresholds (`DEFAULT_IMAGE_ANALYSIS_OPTIONS`) are configurable. Platform
target width and manifest-aware compression checks belong to #10 (Phase 2).

## Out of scope (Phase 2)

`toony lint` CLI wiring, bubble-text overflow (needs #8 layout), export manifest
completeness (needs #10's manifest), and OCR are deliberately not implemented
here.

## Commands

- `pnpm --filter @toony/lint build`
- `pnpm --filter @toony/lint typecheck`
- `pnpm --filter @toony/lint test`
