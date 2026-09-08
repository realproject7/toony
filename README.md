# Toony

Toony is an agent-first, local-first, webtoon-only production tool.

The product is designed for agents and human creators to collaborate on story
planning, cut planning, transition rhythm, image asset ingestion, lettering,
review, and export.

## Product Boundaries

Toony includes:

- local project folders
- story bible and character planning
- episode, cut, transition, and lettering schemas
- provider-neutral image generation and manual image import workflows
- local web studio editing
- webtoon-specific lint and review tools
- platform image sequence export
- stitched episode export
- PlotLink-ready export packages
- data-only content packs that add workflows, genre scaffolds, export presets,
  and craft bands without forking the core
  ([docs/PACK_FORMAT.md](./docs/PACK_FORMAT.md))
- craft measurement that grades a rendered episode against a target band
  ([docs/CRAFT_MEASURE.md](./docs/CRAFT_MEASURE.md))

Toony does not include:

- wallet management
- account management
- transaction signing
- direct PlotLink upload or publishing
- royalty claiming
- marketplace or reader features
- cloud sync
- payment or license-key enforcement in the MVP

## MVP Direction

The MVP should prove that Toony can produce one original webtoon episode with:

- coherent story flow
- visible bubble variety
- useful transition rhythm
- usable focused lettering edits
- valid platform, stitched, and PlotLink-ready exports

File creation alone is not the quality bar.

## License

Toony is source-available under the
[PolyForm Noncommercial License 1.0.0](./LICENSE). Noncommercial use is free
under that license. Commercial use, such as monetized publication, commissioned
work, or studio production, requires a separate commercial license.

See [LICENSE](./LICENSE) for the terms and [COMMERCIAL.md](./COMMERCIAL.md) for
what counts as commercial use and how to ask for a license.

## Status

Founding repository. Implementation tickets must be created and reviewed before
feature implementation begins.
