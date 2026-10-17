# @toony/schema

Shared structural schema and validators for Toony projects. This package is the
single source of truth for the project data model consumed by the preview (#7),
lettering editor (#8), transition editor (#9), export (#10), and lint (#11)
work. Those tickets import these definitions instead of redefining them.

## Scope

- TypeScript types for `webtoon.json`, episodes, cuts, transitions, and
  lettering overlays.
- Validators for project-level language config, the canonical episode sequence,
  cut/transition references, lettering overlay geometry, duplicate ids, missing
  records, and cross-file referential integrity.
- Canonical, deterministic, lossless serialization for round-trip use.

File reading and YAML/JSON parsing are intentionally out of scope: validators
operate on already-parsed structures so the schema stays headless and
deterministic. The CLI (#5) loads files from disk and hands parsed values here.

## Validation boundary

`@toony/schema` owns **structural validity**: schema conformance, canonical
ordering, duplicate ids, missing records, and referential integrity. Production
readiness linting (image decode, blank/corrupt, overflow scoring, compression
feasibility) belongs to #11, which consumes these validators rather than
reimplementing them.

`validateProject(value)` never throws; it returns `{ valid, issues }`, where each
issue has a `path`, a stable machine `code`, and an actionable `message`.

## Schema decisions

- **Coordinate space.** Bubble geometry (`x`, `y`, `width`, `height`) is
  normalized `0..1` relative to the cut image, with the origin at top-left. The
  box must stay inside the image (`x + width <= 1`, `y + height <= 1`).
- **Bubble tail.** The tail resolves deterministically to a normalized
  `{ x, y }` point in the same `0..1` space as the geometry, so consumers never
  re-derive tail positions from an enum. A `null` tail means a tailless bubble
  (for example, narration boxes). This is the chosen default over a string enum.
- **Transition type.** A fixed vocabulary: `hard-cut`, `gutter`, `fade`, `beat`,
  `scene-break`, `time-skip`. New types are added here so every consumer
  validates against one list.
- **Gutter height.** Expressed in CSS pixels (px) as an integer in
  `0..4096` — the shared unit used by preview, the transition editor, and
  stitched export, which preserves gutters at concrete heights.
- **Review status.** Shared by overlays and transitions: `draft`,
  `human-edited`, `final`.
- **Asset references.** Cut and transition image references are project-relative
  paths only; absolute or parent-escaping paths are rejected. Provider config
  stores neutral labels, never account ids, keys, or endpoints.

## Commands

- `pnpm --filter @toony/schema build` — emit `dist/` (library only).
- `pnpm --filter @toony/schema typecheck` — type-check sources and tests.
- `pnpm --filter @toony/schema test` — compile and run the Node test runner.
