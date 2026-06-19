# Toony Interstitial-Panel Craft Study (v4)

> Companion to `TOONY-WEBTOON-CRAFT.md`. Focus: the **no-art panels between scenes** —
> solid color fields, narration-only captions, dialogue-on-color, title/time cards, and
> silence/beat gaps — that carry transition, time, and emotional pacing in vertical-scroll
> webtoons. Method: two web-research passes (creator guides, sequential-art theory, color
> theory) + live observation of real episodes on webtoons.com. **Skills only — no specific
> work's text, art, characters, or compositions are copied.**

This study reframes Toony's **transition** primitive: a transition is not an on-screen gap or
UI chrome — it is a **real image panel in the scroll** (rendered into Read mode AND export),
filled with color / narration / dialogue / a card / or deliberate emptiness.

---

## 1. Core principle — in vertical scroll, empty vertical space *is time*

The reader sees ~2 panels at once and scrolls at a near-constant ~800px/sec. So vertical
pixels map to perceived seconds; the gutter is a **rest note**, not a divider. This *inverts*
print: a print gutter compresses time (whole page seen at once → instant closure); the long
vertical gutter *expands* it (the next panel is withheld until the thumb arrives). Confirmed
live: real episodes isolate art panels inside large empty bands to time each beat, and run a
dark-field text-only caption as the opening interstitial.

**Gutter-as-clock ladder** (standard 800px-wide canvas; one mobile screen ≈ 1200–1280px):

| Empty band | Reads as | Use for |
|---|---|---|
| 100–150px | continuous | fast action, punches, rapid dialogue |
| 200–300px | a beat | reaction shot, a line landing, comic timing |
| 400–600px | a breath / cut | scene transition, indoor→outdoor, day→night |
| 600–800px | a held pause | cliffhanger setup, anticipation before a reveal |
| 1000–2000px+ | "time passes" / dread | major time skip, horror silence, emotional void |

Rules: **one beat per panel**; **vary the gutters** (monotone spacing flattens pacing — rhythm
is contrast); **pre-load the payoff** (art → long blank → BIG art); a pause **must fill the
viewport to "count"**; **cap a single panel ≈1200px** so a no-art band isn't sliced across the
mobile fold.

---

## 2. Taxonomy of interstitial panel types

Each maps to a Toony transition `kind`. Heights are panel heights (px on the 800px canvas).

| # | Type | Function / when | Height | Color | Typography |
|---|---|---|---|---|---|
| 1 | **Beat / silence gap** | timed pause; let a moment land before the next image | 200–300 (beat), 600–800 (held) | inherits page/scene bg | none |
| 2 | **Solid-color mood field** | carry emotion abstractly; tonal shift | 600–1800 (fill viewport) | color = emotion (below) | none, or 1 centered line |
| 3 | **Full-black void** | hard stop: blackout, death, dread | 2000–3500 (over-long on purpose) | #000–#0a0a0a | none / faint whisper |
| 4 | **Narration caption** | monologue, framing, time/place context | scales to text, <1200 | neutral or low-sat mood tint | match narrator; readability-first; vertically centered block |
| 5 | **Dialogue-on-color** | make the reader sit with one line; voice before we see speaker | 300–500 | plain or mood tint; bubble optional | dialogue font, centered; isolation > size |
| 6 | **Title / chapter card** | series/chapter identity; opening theme | ~1 screen | brand/mood palette | display/logo type (the one place decorative type belongs) |
| 7 | **Time / place card** | explicit time/scene-skip signpost | 300–600 | flat dark/desat bar (cinematic lower-third), or time-of-day tint | clean, often all-caps/mono, centered or slate-left |
| 8 | **End card** | episode CTA (thanks/subscribe) | short | off-tone from story | friendly, legible |

**Color → emotion coding (mood color script — treat as a per-scene key, not per-panel decor):**
black/very-dark = dread/void/death · red = rage/danger/alarm/love · white = emptiness/shock/clinical ·
warm amber/peach/rose = intimacy/nostalgia/safety · cool blue/teal/grey = sadness/isolation/night/calm ·
saturated = intensity · desaturated = numbness/memory.

**Fade transitions:** vertical gradient blending prior panel into the flat field; direction matters
(fading *down into* black = descent/ending; *up out of* black = waking/arrival).

---

## 3. Genre patterns (which interstitials dominate, and why)

- **Horror / thriller** — full-black voids, very long empty scrolls, dialogue-before-image. The
  format's killer feature is the *forced slow scroll through nothing* → dread/"sinking." Spacing
  long; color black/desaturated.
- **Mystery / procedural** — time/place cards, dark cinematic bars, short hard-cut gaps. Goal is
  clarity under complexity. Spacing medium/crisp; color cool/neutral, high-contrast text slates.
- **Romance / drama** — warm/cool solid-color mood fields, soft-tinted narration, medium beats.
  Background color shifts cue mood/time. Spacing generous/smooth; warm pastels / cool tints.
- **Action / shounen** — minimal interstitials, tight gutters; a single red/black flash on impact.
- **Comedy** — the 200–300px beat panel *is* the punchline timer.

---

## 4. Toony product mapping → v4 backlog

Current state: `black_band` / `title_card` / `palette_shift` already render as real panels in
**export** (`composeTransitionBand`) and via `layoutTransition`, but studio **Read mode renders
them as thin "gap + label" chrome** (`transition-block.tsx`, min ~56px) → Read ≠ Export. The
editor also over-exposes agent-only fields. The study turns into:

**A. Transition = real panel (render parity + richer kinds)**
- A1. Read mode + transition editor render the **export-identical full-height panel** (true WYSIWYG); drop the gap-chrome treatment. Honor authored panel height (no 56px floor in Read).
- A2. Add interstitial panel kinds to schema/render/export: `beat` (empty timed gap), `color_field` (solid mood fill), `void` (full-black), `narration_card` (caption on field), `dialogue_card` (line on field), `time_card` (time/place slate), keep `title_card`. Each is a no-art panel with `height`, `fill`/gradient, optional `text` + `textAlign` (H) + `verticalAlign` (V).
- A3. **Height presets** mapped to the clock ladder: `tight=120 · beat=250 · cut=500 · pause=700 · timeskip=1600` + free override; warn if a single panel >1200px (auto-noted for slicing).
- A4. **Mood color presets** (named swatches → emotion) selectable on color/void/field panels.
- A5. **Fade** control: `to-black|to-white|to-color` × direction `top→bottom|bottom→top` × length.
- A6. Craft lint: `craft/rhythm-monotony` already exists for bubbles — extend the idea to **transition spacing monotony** (flag long runs of identical gutter heights) and a **co-visibility** hint (read-together items >~1600px apart).

**B. Editor reset (human-first; agent owns the rest)**
- B1. **Sticky art column** — the cut image stays pinned/visible while the inspector scrolls (no scroll ping-pong).
- B2. **Resize on all 4 corners** + clearer handle affordance (today only the bottom-right corner resizes and it's hard to find).
- B3. **Bubble vertical align** (top/middle/bottom) added to schema + render + editor (today only horizontal `textAlign`).
- B4. **Scope cut:** editor surfaces only what a human tunes — **bubbles + transitions**. Move prompts / shotType / palette / layer / styleTag / characters / lint OUT of the editor into the agent/CLI domain.

**C. Brand redesign (separate workstream)** — cute, character-driven "Toony" identity (a Toony
character at a webtoon workstation) across logo + all screens; Open Design re-engagement.

---

## 5. Reusable parameters (implementable knobs)

- Spacing presets (px): `tight=120 · beat=250 · cut=500 · pause=700 · timeskip=1600` + override.
- Panel-height presets: `S=400 · M=800 · L=1600 · Impact=2000+`; flag >1200 for fold-slicing.
- No-art panel block: solid fill | gradient | fade, with optional text.
- Mood color presets: anger-red · calm-blue · melancholy-desat · joy-vivid · dread-black · shock-white.
- Fade: type (`to-black|to-white|to-color`) + direction + length(px).
- Text element types: `narration-caption` (top-aligned default, fill+opacity) · `dialogue-bubble` (white default) · `sfx`.
- Text alignment: horizontal (L/C/R) **+ vertical (top/center/bottom)** — center default for standalone lines.
- Reading-time estimate from total height (~1200px/min); beat count.

---

## Sources

Vertical paneling & pacing: comistitch.com vertical-scroll paneling guide; contentcurve 400px-section
model; mattreadscomics vertical-scroll strengths; Wikipedia *Infinite canvas*; ClipStudio Tips scene-
transition & ultimate guides; comicsai webtoon guide; teachmefirstcomic. Closure theory: McCloud
*Understanding Comics* study notes. Color: TV Tropes *Colour-Coded Emotions*; toonsmag color psychology.
Typesetting: webtoonish typesetting guide. Genre/horror pacing: KComicsBeat / WEBTOON creator talks.
Live observation: webtoons.com Originals episode viewers (interstitial/beat structure only; nothing copied).
