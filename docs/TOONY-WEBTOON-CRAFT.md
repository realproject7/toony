# Toony Webtoon Craft Study — Transferable Skills

Status: Research synthesis (2026-06-18)

Abstracted craft skills observed across six WEBTOON Originals studied by genre
(Lore Olympus, Cursed Princess Club, Tower of God, unOrdinary, Yumi's Cells,
Purple Hyacinth — episodes 1–3 each). This records **transferable technique**
("how"), NOT any work's content. No verbatim dialogue, character designs, names,
plots, or compositions are reproduced. Findings that appeared independently in
multiple works are marked **[convergent]** (high confidence).

The point of this study is to make Toony *author better webtoons*: it feeds image
prompts, agent planning, editor defaults, and lint rules.

---

## 1. Character creation → image-prompt skill **[convergent: all 6]**
- A character's **identity is a locked palette + 2–3 invariant shape cues**, not a long description. The signature color often reads as "who" before the face does (esp. romance/fantasy). Identity must survive stylization (silhouette, backlight, cropped face) via those few anchors.
- Flat/bold/cel styles stay on-model far more easily than painterly/rendered styles.
- **Toony implication:** store each character as a short fixed **lockstring / anchors** `{hair shape+exact color, eye color, one signature garment/accessory, body/age read, style}` and inject it **verbatim into every panel's image prompt**; only pose/expression/lighting/camera vary per cut. Lint for anchor drift. Editor forces defining the lockstring at character creation (with swatch+silhouette preview).

## 2. Bubble grammar
- **One dominant bubble per cut** (one idea per scroll-beat); avoid clusters. **[convergent]**
- **Bubble shape encodes emotional tone** — oval=neutral, scalloped/cloud=shout/panic, jagged/spiky=aggression, ellipsis-only "…" = silence/beat, small+dense+tail-off-panel = ambient "noise to skim." **[convergent: 3 works]**
- **Bubbles often live in the gutter/whitespace**, tail crossing into the art (dialogue and art occupy separate vertical zones). **[convergent]**
- **Narration ≠ speech, split by container + typography:** dialogue = tailed bubble (upright sans); narration/voice-over = **borderless caption** (cinematic serif-italic + soft glow, or bold display + speed-lines for collective reactions). **[convergent: all]**
- Low text density: 2–4 short stacked lines, heavy weight, generous spacing for thumb-distance legibility.
- **Toony implication:** bubble `type` enum (speech|thought|narration|sfx|beat|ambient) with `tone`→shape presets; `placement` (in_panel|gutter) + off-panel `tailTarget`; narration as a distinct text type with locked typography; density/line + tail-attribution lints.

## 3. Dialogue voice & style
- Voice differentiated by **register/rhythm**, reinforced **typographically** (italic-serif internal narrator vs upright-sans speech). Typography carries vocal delivery (elongated vowels = sing-song; size/weight = emphasis).
- Genre registers: naturalistic-modern-over-fantasy (romance), deadpan-clipped-ellipsis (comedy), sparse-declarative + silence beats (action), wry-ironic self-aware narrator (drama).
- **Toony implication:** dialogue-gen voice presets per genre; inline emphasis markup (elongation/size/weight) so generated lines encode tone; lock narration-vs-speech typography as a theme.

## 4. Pacing = scroll; whitespace = timing **[convergent: all]**
- The **scroll distance IS the pause.** Large gutter/whitespace = slow/heavy beat; tight stacking = rapid exchange. One narration line ≈ one spacer.
- Comedy splits **setup and punchline across separate cuts with a gutter between** (you scroll into the punchline). Dramatic "incomplete sentence over empty space" = micro-cliffhanger.
- **Toony implication:** first-class **beat-spacer** primitive (`gapAfter`, presets quick/beat/dramatic/scene-break); a "beat/pause cut" primitive (small `…`/empty); split-gag template; lint to suggest fragmenting long narration across panels.

## 5. Vertical rhythm & composition **[convergent]**
- Alternate **tall full-bleed splash ↔ small centered cut ↔ void/black gap**; monotony kills the read.
- **Scale-before-character / mood-&-world-before-plot:** open a location with an establishing wide/long shot; use scale juxtaposition (tiny figure after a void = reveal). Diagonal/Dutch angles for drama/motion. Long impact cuts force slow scroll.
- **Toony implication:** cut-size/shot-type presets (`small_centered`, `full_bleed_tall`/`impact_splash`, `void_gap`, `establishing_wide`); rhythm lint (flag long runs of same-size cuts); planning heuristic "establishing wide before close-ups."

## 6. Opening / hook engineering
- Patterns observed: **dialogue-first withhold** (bubble before the speaker → "who?"), **desire/question montage** → dark scale reveal, **ideal-then-subvert** (aspirational framing undercut by irony), **tonal misdirect** (solemn cold-open the comedy later subverts), **threat-object cold-open** (extreme close-up of a menacing object, identity withheld). Common rule: **state no plot; raise exactly one open question by the end of the first screen.**
- Cinematic cold-open devices: full-bleed solid-color title/"turn sound on" card; mid-scroll title card after the hook.
- **Toony implication:** genre `toony init` templates seeding cold-open structures + an episode beat scaffold; planning heuristic for ep-1 hooks; cold-open primitive (full-color-field title/sound-cue panel) + mid-scroll title card.

## 7. SFX / onomatopoeia
- Two modes: **typeset/atmospheric** (restrained — romance/drama) vs **hand-lettered/loose/lowercase, in-panel** (playful — comedy) vs **giant full-panel impact** (its own band, white+outline over radial speed-lines + impact burst — action). SFX is a *beat*, not a corner label. **[convergent]**
- **Toony implication:** SFX element type with render modes (typeset|hand_lettered|impact_band) defaulted by genre; one-click "promote SFX to full-width impact panel."

## 8. Color / mood & transitions **[convergent]**
- **Gutters carry mood:** inter-panel space can be colored/black (cold purple/blue=dread, black=threat), not just white. Palette is assigned per scene; **palette shift = scene transition.** Desaturating a repeated image = tonal/temporal pivot.
- Scene breaks: solid-color full-bleed band, mid-scroll title card, desaturate-repeat, or **art-style switch** (e.g. simplified chibi + speed-line BG for a comedic aside, then back).
- Two-layer worlds (reality vs metaphor/inner) signposted by distinct style presets; transitions between layers are a core device.
- **Toony implication:** `scene.palette` + `gutterColor`; `transition.kind` blocks (black_band|title_card|desaturate_repeat|palette_shift|style_switch); per-cut `styleTag`/`layer` (reality|metaphor) with auto style preset; agent rule to shift palette on scene change.

## 9. Episode structure & cliffhangers
- Escalation curve: **atmospheric open → build → kinetic → single payoff → cut.** Isolate the key reveal/impact on its own full-width cut (nothing competing). Comedy = setup→escalation→punchline, each its own beat. Comedy uses ~2× the vertical real estate of romance (more, shorter beats).
- **Toony implication:** per-episode `tensionArc`/beat-structure template the planner lays beats against; lint warning when a reveal/SFX beat shares a cut with other content; genre-tuned default beat counts/cadence.

---

## Product-improvement backlog (study → candidate work)

| Area | Improvement | Likely routing |
|---|---|---|
| Schema | `character.lockstring`/anchors; bubble `type`/`tone`/`placement`/`tailTarget`; text `narration` type; `scene.palette`; `cut.gutterColor`/`styleTag`/`layer`/`shotType`; `episode.tensionArc` | QuadWork (schema, back-compat) |
| Render | bubble shape-by-tone; narration caption vs bubble typography; colored gutter; SFX render modes; beat/`…` rendering | QuadWork |
| Image prompts | inject `character.lockstring` + genre style preset into `toony generate`; framing flags (crop/silhouette) | Direct (providers/cli) |
| Planning/CLI | genre `toony init` templates (romance/comedy/action/thriller/slice-of-life) w/ cold-open + beat scaffolds + style/SFX/voice presets; agent planning heuristics | Direct + QuadWork |
| Lint | bubble density (≤~2/cut); tail attribution; narration fragmentation suggestion; all-caps/line-break; vertical-rhythm monotony; character-anchor drift; reveal-beat isolation | QuadWork |
| Editor/Studio | bubble tone→shape presets; narration distinct type; beat-spacer + gutter-color + SFX-promote; cut-size/shot-type presets; character-lockstring UI; scene palette | Direct |

These become a "craft-informed authoring" EPIC; see the GitHub issues.

---

## See also

- [TOONY-PLANNING-HEURISTICS.md](./TOONY-PLANNING-HEURISTICS.md) — the concise,
  actionable per-genre cold-open + tension-arc guidance an author/planning agent
  follows, embodied by the `toony init --genre` starter templates (#101).
