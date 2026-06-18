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

---

# v2 Capstone — Workspace Studio Re-verification

Status: PASSED (2026-06-18)

v2 turned Toony into "one workspace, two doors" (agents via the `toony` CLI;
humans via Toony Studio) with a workspace library, a pro-lettering editor, a
reader mode, an in-Studio export screen, and the "Studio Pulse" redesign. This
re-verifies the whole experience end-to-end on a real multi-work workspace —
built self-contained from the rendered "Last Train" episode plus a second
`toony init` work (no pre-existing local path required).

## What was verified

| Surface | Result |
| --- | --- |
| Workspace library | Lists multiple works (Last Train w/ its real generated cover, Cafe Hours) with episode/cut counts — "2 works · 2 episodes · 9 cuts". Open/switch without restart; New webtoon. |
| Reader mode | Full "Last Train" episode renders top-to-bottom — real artwork + composited bubbles (no speaker labels) + transition bands — in a clean centered column, no edit chrome. |
| Pro-lettering editor | Typography (family/size/weight/align/line-height/letter-spacing), color pickers (text/fill/border + opacity), styling (border/radius/tail), arrangement (z-order/nudge) — all persist and render via the shared `@toony/render` core. |
| Export | All three targets from the UI and CLI; PlotLink-ready produced 7 WebP + 734-char markdown + manifest, constraints met. |
| Settings | ComfyUI endpoint/checkpoint/workflow via the shared `.toony/config.json`, with a connection badge; env overrides file. |
| Agent door (CLI) | `toony validate` / `lint` / `export` run headlessly on the same workspace files — the agent path is intact. |
| Redesign | "Studio Pulse" (Toony Indigo + Pulse Coral, state colors, new icon/logo) applied across every screen; livelier and higher-contrast while keeping canvas-first Production Scroll. |
| Single install | `toony-cli` tarball installs outside the monorepo and provides both `toony` (CLI) and `toony studio` (bundled web app). |

## Findings folded in during v2

- #45 (pre-existing): `pnpm check` was red (biome); fixed and check output is no longer grep-filtered.
- #57: the only verification catch was two `no-stub` comment-wording flags (reworded); packaging deps were correct (`@toony/*` are devDeps/bundled, runtime dep = `@napi-rs/canvas`).

## Conclusion

The v2 quality bar — a human can manage all works, fine-tune lettering with a
real editor, read the episode, and export, while agents still drive everything
headlessly, all under one livelier brand — is met. EPIC #47 complete.

---

# v3 Capstone — Craft-Informed Original Episode

Status: PASSED (2026-06-18)

v3 added the **craft skills**: genre scaffolds (`toony init --genre`), a character
registry with injected lockstrings, an expanded **bubble grammar** (`beat`/
`ambient` kinds, `tone`, `sfxMode`, `placement`, `tailTarget`), per-cut craft
metadata (`shotType`/`palette`/`layer`/`styleTag`), new transition kinds with
`color`, and the `craft/*` + `character/unknown-ref` lints. The v3 quality bar is
not "the fields exist" — it is that **using the craft skills produces a better
webtoon end to end** than v2 did. This records that final acceptance.

The capstone is an **original** thriller short, **"Dead Air"** (a lone late-night
radio host is hijacked on air by an unknown caller who is describing her own
booth in real time). It was scaffolded with `toony init dead-air --genre thriller`,
authored against the craft skills, generated through the running local ComfyUI
(Animagine XL 3.1), and taken through `validate` / `lint` / all three exports. No
studied work was copied — only the craft process.

## What was produced

A **7-cut episode with 6 transitions** and **two registered characters** whose
lockstrings keep them on-model across every cut they appear in:

- **Wren** — `1girl … short choppy auburn bob, thin silver headphones around neck,
  oversized charcoal cardigan over a black tee, small star stud earring, muted
  teal-and-amber palette, clean modern webtoon lineart …` (cuts 002, 004, 006).
- **The Caller** — `a shadowed figure in a dark hooded raincoat, face hidden in
  deep shadow … desaturated near-monochrome palette, high-contrast noir lineart …`
  (cut 005).

`toony generate` injected each character's lockstring **verbatim** ahead of the
per-cut scene prompt (the cut only describes the action; the lockstring carries
the identity), so Wren reads as the same person in the calm intro (002), the
hesitant reach for the line (004), and the close-up of dread (006), and the
Caller reads as one consistent silhouette.

## Craft features the episode deliberately exercises

| Skill | How "Dead Air" uses it |
| --- | --- |
| Genre cold-open + tension arc | Thriller open on the empty booth + a threat-object beat (the line lighting up) → escalation (the Caller) → payoff (the blackout). |
| Character lockstrings (#92) | Two registry characters; `cut.characters` refs on 4 cuts; lockstrings injected verbatim at generation, holding Wren and the Caller on-model. |
| Bubble variety (#93) | **narration** (borderless caption, cut-001/007), **speech** (Wren, 002/006), **thought** (Wren, 004), a **beat** "…" (004), a **shout** with `tone=shout` → scalloped outline ("DON'T LOOK UP.", 005), **ambient** ("rain. static. breathing.", 006), and two **sfx** with distinct `sfxMode` — `hand_lettered` "BZZT" (003) and `impact_band` "CLACK" radial burst (007). |
| Transition rhythm (#99) | Six varied kinds with `color`: `title_card` ("2:14 AM — LIVE"), `gutter`, `scene-break` ("One unknown caller."), `palette_shift`, `black_band`, `fade`. |
| Visual rhythm (#98/#100) | `shotType` varies every cut (establishing_wide → medium → close_up → small_centered → medium → close_up → impact_splash) so no monotony run forms; per-cut `palette` darkens from teal toward black as dread builds; `layer`/`styleTag` set (`noir`, `metaphor`). |
| Lint discipline (#94/#100) | ≤2 dialogue bubbles per cut, short attributed lines, every attributed bubble resolvable (speaker or registered character) → `toony lint` is **clean** (no warnings, no info findings). |

## Quality-bar results

| Bar | Result |
| --- | --- |
| Story flow | Coherent thriller arc: cold-open hook → the line lights up → the Caller → real-time dread → blackout payoff with the line still open. |
| Bubble variety | All eight grammar elements present and styled distinctly: borderless narration, speech, thought, beat "…", scalloped shout, low-emphasis ambient, hand-lettered SFX, and a full-width impact-band SFX burst. |
| Transition rhythm | Six different transition kinds (title_card / gutter / scene-break / palette_shift / black_band / fade), three carrying a `color`, pacing the read from a station card to a hard drop to a fade-out. |
| Character consistency | Lockstrings injected verbatim by `toony generate`; Wren stays on-model across cuts 002/004/006 and the Caller across 005 (see `docs/capstone-v3/` screenshots). |
| Export validity | platform (7× JPG + manifest), stitched (1× 800×8945 PNG preserving cuts + transition bands + lettering), plotlink (7× WebP + generated markdown + manifest) — all real composited rasters. |
| PlotLink constraints | WebP; 7 images (≤ 20); largest 102 KB (≤ 1 MB); generated markdown 732 chars (500–10,000); manifest with project-relative paths + sha256 checksums. |
| Validate / lint | `toony validate` ok; `toony lint` **clean** (no findings). |
| Generation | Real local ComfyUI (Animagine XL 3.1); seven cuts generated from their prompts with lockstrings prepended; artwork lands project-relative. |

## Generated PlotLink script (excerpt)

The PlotLink markdown is generated from canonical episode data in reading order,
now carrying the full v3 bubble grammar and the new transition kinds:

```md
#### cut-004
…
**Wren:** Just answer it.

— palette_shift: shift cold as we cut to the caller —

#### cut-005
**???:** DON'T LOOK UP.

— black_band: hard drop into dread before the reveal —
```

## How the v3 craft skills improved the result vs the v2 capstone

The v2 capstone ("Last Train") proved the *pipeline*; v3 proves the *craft*. The
same author working with v2's vocabulary alone would have produced a flatter
episode. Concretely, v3 raised the bar in ways v2 could not:

- **Character consistency stopped being luck.** In v2, on-model recurrence
  depended on hand-repeating "long dark hair, red scarf, navy coat" in every cut
  prompt — easy to drift. v3's **lockstring registry** makes identity a single
  source injected verbatim, so Wren and the Caller hold across cuts by
  construction, and a typo'd ref is caught by `character/unknown-ref` lint, not
  by eye.
- **Emotion now lives in the bubble silhouette.** v2 had a fixed bubble set; v3's
  `tone=shout` turns the Caller's threat into a scalloped shape and `sfxMode`
  gives "BZZT" a hand-lettered face and "CLACK" a full impact-band burst — the
  lettering carries dread the v2 grammar could only state in words.
- **Pacing became a checkable craft, not a vibe.** v2 leaned on gutter/scene-
  break/fade; v3 adds `title_card`/`palette_shift`/`black_band` with `color`, and
  `shotType` + the `craft/rhythm-monotony` lint turn "vary your shots" into a rule
  the build enforces — the episode's establishing→close→splash cadence is
  deliberate and lint-guaranteed.
- **The cold-open is genre-aware from the first command.** `toony init --genre
  thriller` seeds a threat-object open and a setup→escalation→payoff curve, so the
  author starts from craft heuristics instead of a blank file.

The result is a tighter, more legible, more *intentional* episode produced by the
same end-to-end loop — which is exactly the v3 acceptance: the craft skills make a
better webtoon, headlessly, with the lints keeping it honest.

## Reproduce

The committed seed lives at [`examples/dead-air`](../examples/dead-air) with
`image: null` on every cut and the lockstrings/prompts/lettering/transitions in
place; artwork regenerates from the prompts through any configured provider:

```bash
cd examples/dead-air
export TOONY_COMFYUI_URL=http://127.0.0.1:8188
export TOONY_COMFYUI_CHECKPOINT=animagine-xl-3.1.safetensors
for n in 001 002 003 004 005 006 007; do
  toony generate --episode ep-001 --cut cut-$n --slot clean \
    --width 832 --height 1216 --allow-remote
done
toony validate && toony lint
toony export platform --episode ep-001 --width 800 --format jpg
toony export stitched --episode ep-001 --width 800 --format png
toony export plotlink  --episode ep-001
```

Browser evidence (workspace library with the real cover, and the reader rendering
the full episode with real art + craft bubbles + transition bands) is in
[`docs/capstone-v3/`](./capstone-v3).
