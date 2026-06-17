# MVP Capstone — Original Episode Production Test

Status: PASSED (2026-06-17)

The MVP's quality bar is not "files are created" — it is that Toony can produce
**one original webtoon episode end to end**. This records that test. The episode
("Last Train", an original short — a girl misses the last train and has a quiet,
brief encounter on an empty platform) is reproducible from
[`examples/last-train`](../examples/last-train).

## What was produced

A 7-cut episode with 5 transitions, authored as an `episode.sequence`, with
per-cut image prompts and lettering, then taken through the full pipeline:

1. **Authoring** — `episode.yaml` (sequence), `cuts.yaml` (prompts), `transitions.yaml`, `lettering.json`.
2. **Generation** — each cut image generated from its `imagePrompt` via a local
   ComfyUI provider (Animagine XL 3.1, Apple Silicon / MPS), ingested with a
   project-relative path.
3. **Validation & lint** — `toony validate` and `toony lint` (schema, sequence,
   image decode/dimension/blank/darkness/contrast, bubble overflow) both clean.
4. **Export** — platform (7× JPG), stitched (1× 800×8735 PNG), and PlotLink-ready
   (7× WebP + generated markdown + manifest).

## Quality-bar results

| Bar | Result |
| --- | --- |
| Story flow | Coherent hook → encounter → turn → quiet resolution. |
| Bubble variety | Narration, speech, thought, and SFX all present and styled distinctly (narration/SFX correctly unattributed). |
| Transition rhythm | Gutter beats, scene-breaks with time-stamps ("11:47 PM", "The next morning"), and a fade — varied pacing. |
| Editor usability | Cut lettering editor and transition editor verified (issues #8, #9) — bubbles and transitions are editable and persist. |
| Export validity | Platform sequence preserves reading order; stitched preserves cuts, gutters, transitions, and lettering; all three targets produced real composited rasters. |
| PlotLink constraints | WebP; 7 images (≤ 20); largest 62 KB (≤ 1 MB); generated markdown 734 chars (500–10,000); manifest with project-relative paths + checksums. |
| Generation | Real provider-neutral generation through a local ComfyUI; no provider policy baked in as a product limit. |

## Generated PlotLink script (excerpt)

The PlotLink markdown is generated from canonical episode data (not hand-edited),
in reading order, annotating cuts, dialogue, and transitions:

```md
#### cut-002
*SFX: VWOOOOO*
**Mina:** ...No. No no no—

— scene break: 11:47 PM —

#### cut-003
**Mina:** Did the platform always feel this... endless?

— fade: dreamlike approach —
```

## Findings folded back in

Producing the episode surfaced and fixed real issues before sign-off:

- **#32** — export composited lettering but omitted the cut artwork (`@napi-rs/canvas` decode); fixed to use `loadImage`.
- **#42** — the schema forced a non-empty `speaker` on narration/SFX; relaxed for unattributed kinds.
- **#40** — `toony generate` now defaults its prompt from the cut's stored `imagePrompt`, completing the agent-first loop.

## Reproduce

See [`examples/last-train/README.md`](../examples/last-train/README.md). The
committed seed carries the story, prompts, lettering, and transitions; artwork
regenerates from the prompts through any configured provider.
