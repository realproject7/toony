# Toony

Toony is an agent-first, local-first, webtoon-only production tool.

The product is designed for agents and human creators to collaborate on story
planning, cut planning, transition rhythm, image asset ingestion, lettering,
review, and export.

## For agents

An agent driving Toony reads [docs/AGENT_GUIDE.md](./docs/AGENT_GUIDE.md) first.
It states the loop from brief to export, the command that answers each question,
and what the tool refuses so the agent does not have to remember it.

## Product Boundaries

Toony includes:

- local project folders
- story bible and character planning
- episode, cut, transition, and lettering schemas
- provider-neutral image generation and manual image import workflows
- local web studio editing
- webtoon-specific lint and review tools
- exports: the episode as one tall strip (or split into parts), one image per
  cut, Instagram and X post images, and 800 px parts for webtoon platforms, each
  with a manifest and a "Download all" ZIP in Studio
- data-only content packs that add workflows, genre scaffolds, export presets,
  and craft bands without forking the core
  ([docs/PACK_FORMAT.md](./docs/PACK_FORMAT.md))
- craft measurement that grades a rendered episode against a target band, and a
  plan-level grade that checks an episode's page geometry against the same band
  before any image is generated
  ([docs/CRAFT_MEASURE.md](./docs/CRAFT_MEASURE.md))

Toony does not include:

- wallet management
- account management
- transaction signing
- posting to social or reading platforms (Toony writes the files; you post them)
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
- valid strip, cut image, and social exports

File creation alone is not the quality bar.

## License

Toony is source-available under the
[PolyForm Noncommercial License 1.0.0](./LICENSE). Noncommercial use is free
under that license. Commercial use, such as monetized publication, commissioned
work, or studio production, requires a separate commercial license.

See [LICENSE](./LICENSE) for the terms and [COMMERCIAL.md](./COMMERCIAL.md) for
what counts as commercial use and how to ask for a license.

## Status

Active development focuses on stronger artwork composition and an easier human
lettering workflow. These are development goals, not a claim of professional
episode quality. The delivery flow is [docs/PO_WORKFLOW.md](./docs/PO_WORKFLOW.md).
Planning, research and work records are maintained locally. GitHub issues are
not the development backlog.
