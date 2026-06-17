# PROPOSAL — Toony v2: Workspace, Full Editor, Reader, Export UI, Redesign

Status: Draft (2026-06-17)
Author: PO agent · Operator: Project7
Supersedes nothing; builds on the shipped MVP (`realproject7/toony`).

---

## 1. Executive Summary

The MVP proved Toony can take an original webtoon episode end to end (agent
plans + generates, human letters, export produces real platform / stitched /
PlotLink-ready output — see `docs/CAPSTONE.md`). v2 turns that proof into a
product the operator actually wants to live in, around three operator goals:

1. **Agent-first stays** — agents drive Toony as lightly as possible (headless,
   file-based; no browser).
2. **Human web editor** — a real, editor-grade interface for reviewing every
   work made so far and fine-tuning bubbles, dialogue, and transitions.
3. **Toony branding** — one named, coherent product.

### The shape: "one Toony, two doors, one workspace"

A single local **workspace** of plain project folders is the source of truth.
Two front doors operate on the same files:

- **Agent door** — the `toony` CLI (and optionally an MCP server): headless,
  deterministic, file-based. Agents never open a browser.
- **Human door** — **Toony Studio**, a local web app opened over the *whole
  workspace*: a library of all works, plus editor-grade fine-tuning.

Because both doors read/write the same files, no accounts, cloud, sync, or API
server are needed. This is a strict, low-risk evolution of the MVP — no desktop
packaging, no code-signing, no cloud gates.

This proposal also folds in five concrete product corrections/additions the
operator raised (full-feature editor, remove speaker labels from bubbles, reader
preview, surface export in the UI, and a livelier redesign).

---

## 2. Goals & Non-Goals

**Goals**
- Workspace library: open Studio → see and manage every work.
- Editor-grade lettering/transition fine-tuning (typography, color, styling).
- Distraction-free full-episode reader preview.
- Export surfaced in the Studio UI (all three targets).
- A livelier, webtoon-appropriate visual redesign + brand assets.
- Keep the agent path light; keep one shared local file format + config.

**Non-Goals (unchanged Toony boundaries)**
- Not an art/drawing editor — the canvas edits *lettering and transitions*, not
  pixels. Image creation stays provider-driven (ComfyUI etc.).
- No wallet/account/publish/royalty/marketplace; no cloud sync.
- No desktop packaging or app-store distribution in this round (possible later;
  the architecture below is desktop-ready without rework).

---

## 3. Architecture

```
        ┌──────────────── local workspace  (e.g. ~/Toony/) ────────────────┐
        │  work-1/   work-2/   work-3/ ...   (each work = a plain folder)    │
        │  source of truth: YAML/JSON + images   +   shared config (.toony/) │
        └───────────────────────────────────────────────────────────────────┘
              ▲                                              ▲
   🤖 Agent door: `toony` CLI (+opt. MCP)        🧑 Human door: Toony Studio (web)
      init/plan/generate/lint/export,               workspace library + reader +
      direct file edits — headless                  full lettering/transition editor
```

- **Workspace**: a parent folder Studio is pointed at once; each child folder
  with a `webtoon.json` is a work. `toony studio` opens the library over all of
  them. The CLI's `toony init <name>` adds a work to the workspace.
- **Shared config** (`.toony/config.json`, gitignored, provider-neutral): the
  ComfyUI endpoint/checkpoint/workflow and app settings live here. The Studio
  settings page, the CLI, and agents all read/write the same file.
- **Reuse**: all core packages (`schema`, `project-io`, `render`, `lint`,
  `export`, `providers`) are unchanged contracts; v2 is mostly new UI + a thin
  workspace/config layer + packaging.

---

## 4. Work Areas (the five operator items + the workspace)

### 4.1 Workspace library (all works in one dashboard)
- `project-io`: `listWorkspace(root)` — scan for `webtoon.json` folders, return
  per-work summary (title, episode/cut counts, a cover thumbnail, updated-at).
- Studio: `/` becomes a **library grid** (cover, title, counts, last edited),
  with **New webtoon** (runs `init`) and open/rename/(optional) archive. Work
  routes become project-scoped (`/w/<id>/...`); the write APIs gain a workspace
  + work scope (path-safe).
- Reflects agent work live (same files → refresh shows it).

### 4.2 Editor-grade lettering & transition editor (item 1)
Scope stays **lettering + transitions only** (never pixel drawing), but at a
"pro lettering" level. Recommended controls — enough to be real, curated to stay
light:

**Bubble / text**
- Text content; bubble **kind** (speech/thought/narration/shout/whisper/sfx).
- **Typography**: font **family** from a *curated, bundled* webtoon set (~6–8
  faces, incl. a couple of CJK-capable), font **size** (numeric + quick presets),
  **weight**, line-height, alignment, letter-spacing.
- **Color**: text color, fill color, fill opacity, border color — each via a
  proper **color picker** (swatch + hex + recent), plus a small project palette.
- **Bubble styling**: border width, corner radius, tail on/off + drag-position,
  bubble shape per kind.
- **Arrangement**: move, resize (normalized, in-bounds), duplicate, delete,
  **z-order** (forward/back) for overlapping bubbles, snap/nudge.

**Transition**
- Type, gutter height, text, SFX, color/treatment params, agent/human notes,
  review status.

**Kept light (explicit non-features):** no arbitrary font upload, no
gradients/shadows/filters, no freehand/vector drawing, no per-pixel image edits.
Rendering reuses the existing framework-agnostic `@toony/render` geometry core
(extended for the new style fields) so Studio (SVG), editor, and `export`
(canvas) stay pixel-consistent. **Weight control:** curate the bundled font set
and use a lightweight color-picker (no heavy design-tool dependency); lazy-load
editor-only chunks so the library/reader stay fast.

> Schema impact: a few additive style fields on the lettering overlay
> (fontSize/weight/lineHeight/align/letterSpacing/textColor/cornerRadius/zIndex),
> all back-compatible with sensible defaults (mirrors how #38 added prompt
> fields). `@toony/render` consumes them; old projects keep working.

### 4.3 Remove speaker name from bubbles by default (item 2)
Real webtoons do not print the speaker's name inside the bubble. **Stop
rendering the `speaker` label in `cut-canvas`/`@toony/render`.** Keep `speaker`
as *metadata* (used for the generated PlotLink **script/markdown** attribution
and as an editor aid for tracking who speaks) — it simply is no longer drawn on
the artwork. (This also retires the awkward narration/SFX speaker question from
#42 at the render layer.)

### 4.4 Full-episode reader preview (item 3)
A distraction-free **reader mode**: the whole episode rendered top-to-bottom as
the reader will see it (cuts + bubbles + transitions, vertical scroll), with no
inspector/edit chrome. Entry from the work dashboard ("Preview episode") and a
toggle between **Reader** and **Edit** in the episode view. Reuses the existing
render pipeline; it is a presentation/route addition, not new engine work.

### 4.5 Surface Export in the Studio UI (item 4)
**Clarification:** the export *engine* is built and verified — `toony export`
already produces all three targets (platform image sequence, stitched single
image, PlotLink-ready WebP + markdown + manifest; proven in the capstone). What
is missing is a **Studio UI** for it. Add an **Export screen** (the Open Design
"export-screen" mock): pick target(s), set width/format/quality, run, show the
manifest + validation results (incl. PlotLink constraint checks) and the output
location, with a re-export action. No engine rewrite — a UI over `@toony/export`.

### 4.6 Studio redesign via Open Design (item 5)
Current Studio reads flat/monotone; for a webtoon tool it should feel lively.
**Redesign through Open Design:**
- A **new design concept** with a brighter, more dynamic, higher-contrast color
  scheme (a vivid accent + energetic secondary, confident type, playful but
  legible) while keeping the "Production Scroll" priority on the canvas.
- New **app icon / logo / wordmark** ("Toony" branding) and an icon set.
- Refreshed **tokens.css**, library cards, reader chrome, editor panels, empty/
  loading/error states.
- Open Design renders for: library, reader, the full editor with all controls,
  export screen, settings, plus icon/logo + splash. Stored in
  `<LOCAL_DESIGN_PACKAGE>/toony-design/` (v2 set); tickets reference those assets;
  AI-rendered text in mocks is direction only.

### 4.7 ComfyUI as shared config (supporting item)
Move ComfyUI settings out of env vars into `.toony/config.json`: a Studio
**settings page** to view/edit endpoint/checkpoint/workflow + a "connection
status" badge; the **agent/CLI manages runtime** (checks/starts ComfyUI, runs
generation) off the same file. Skip in-UI ComfyUI install/process management
(over-engineering) — a `toony doctor` status/guide command covers it.

### 4.8 Distribution: one install gives both doors (supporting goal 3)
Bundle the built Studio into the CLI (Next.js `standalone`) so one install
provides `toony` (agent) and `toony studio` (human) under one brand. Start with
a local global link now; package for real distribution later (npm-global, or a
single binary / install script — same architecture either way). No npm lock-in.

### 4.9 (Optional) MCP server — strongest agent-first move
`toony mcp` exposing the same operations as structured tools so agents (Claude,
etc.) drive Toony natively without shelling out. Natural fit; can be a later
phase.

---

## 5. Design Section (redesign direction)

Per Toony's UX bar, the redesign is specified, not vibes — finalized via Open
Design, but the proposal sets the rules:

- **Concept (working name): "Toony Pop"** — Production Scroll's canvas-first
  layout, recolored to feel like a creative tool for comics: one vivid primary
  accent, an energetic secondary, warm neutrals, strong contrast, rounded/comic-
  adjacent shapes, confident display type for headers + highly legible UI text.
- **Five hard rules** (to be finalized with the design package), e.g.: canvas is
  always the protagonist; one primary accent used decisively; color signals state
  (draft/edited/final, connected/disconnected); panels are calm so artwork pops;
  motion is subtle and purposeful.
- **Tokens**: a full launch token set (color ramp + accents, type scale, spacing,
  radii, shadow/elevation) shipped as `tokens.css` v2.
- **Assets to generate**: app icon + logo/wordmark, library, reader, full editor
  (all controls), export screen, settings, empty/loading/error states, splash.

---

## 6. Phasing / MVP-of-v2

Ordered to deliver felt value early and keep risk low:

1. **Quick fixes** (small, high-signal): remove speaker label from bubbles (4.3);
   full-episode reader preview (4.4).
2. **Workspace library** (4.1) — open Studio → all works.
3. **Export UI** (4.5) — surface the existing engine.
4. **Redesign** (4.6) — Open Design package v2 → apply tokens/assets.
5. **Editor-grade controls** (4.2) — typography + color + styling + arrangement.
6. **Shared ComfyUI config + settings** (4.7).
7. **Single-install bundle** (4.8).
8. **(Optional) MCP server** (4.9).

---

## 7. Routing (per the PO workflow)
- **Direct (this Mac, browser-verified):** Studio UI work — library, reader,
  editor controls, export screen, settings, applying the redesign.
- **QuadWork (headless, fixture-tested):** `project-io` workspace + config
  helpers; additive `@toony/render`/schema style fields; export-UI's underlying
  contracts; the optional MCP server.
- **Open Design:** the v2 design package (icon/logo + all screens + tokens).
- Quick fixes (speaker label, reader route) can ride a small Direct batch first.

---

## 8. Risks / Judgment
- **Editor weight** is the main risk — mitigated by a curated font set, a light
  color picker, lazy-loaded editor chunks, and reusing the render core.
- **Schema additions** stay back-compatible (defaults), as proven with #38.
- **Redesign churn**: lock tokens v2 before re-skinning screens to avoid rework.
- **No new external gates** (no cloud/signing). ComfyUI remains a "bring your
  own / agent-managed" local dependency.

---

## 9. Decisions (resolved 2026-06-17)

1. **Editor scope** — CONFIRMED: §4.2 pro-lettering scope (not a design suite).

2. **Fonts — use free Google Fonts (OFL), self-hosted.** Feasible and ideal:
   nearly all Google Fonts ship under the **SIL Open Font License**, which permits
   commercial use, embedding, bundling, and redistribution — so Toony can ship
   them. **Self-host the `.woff2` files in the app (do NOT hit Google's CDN at
   runtime)** to stay local-first, offline, and private. Proposed curated set
   (all OFL):
   - **Dialogue (clean, legible):** Nunito or Inter (Latin); **Noto Sans KR** /
     **Noto Sans JP** (CJK).
   - **Comic / display (shout, titles):** Bangers, Anton.
   - **Handwriting / soft (thought, narration):** Patrick Hand or Comic Neue
     (Latin); **Gaegu** / **Nanum Pen Script** (Korean handwriting).
   - **CJK weight control:** CJK faces are large (multi-MB) — **subset to used
     glyphs at export/build and lazy-load in the editor** so the library/reader
     stay light. Variable fonts where available.
   - Final list is curated at build time; users pick from this set (no arbitrary
     upload, per §4.2).

3. **Workspace root** — default **`~/Documents/Toony/`** (most user-friendly on
   macOS: visible in Finder, included in Time Machine/standard backups, sits with
   the user's other creative work). Auto-created on first run; **configurable** in
   settings (first-run "where should your Toony works live?" defaults here). Note:
   if the user's `~/Documents` is iCloud-synced, large image folders sync too —
   acceptable default; power users can repoint it.

4. **Redesign** — left to Open Design to explore, **PO-directed with guardrails**
   so the core concept holds. The PO authors a written design brief fixing the
   non-negotiables (canvas-first "Production Scroll", one decisive accent, color-
   as-state, calm panels so artwork pops, webtoon-lively but legible) and curates
   Open Design output against it. Concept name to emerge from exploration.

5. **MCP server — DEFERRED.** Today Toony has **no** MCP server; agents drive it
   via the `toony` CLI (shell + files), which already satisfies "agent-first."
   An MCP server would *additionally* expose Toony's operations as structured
   tools an agent connects to directly (no shell parsing) — a future tightening,
   not needed for v2. Revisit once the workspace/editor land.
