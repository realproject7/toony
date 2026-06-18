# Toony planning heuristics

Concise, actionable guidance an author or planning agent follows when scaffolding
and laying out an episode. Distilled from [TOONY-WEBTOON-CRAFT.md](./TOONY-WEBTOON-CRAFT.md)
(§5 cut rhythm, §6 hooks, §9 tension arcs) and embodied by the
`toony init --genre <genre>` starter templates (see `packages/project-io/src/genres.ts`).

These are heuristics, not hard rules — but several are checked by `toony lint`
(e.g. `craft/rhythm-monotony`, `craft/bubble-density`, `craft/tail-attribution`),
so a scaffold that follows them stays lint-clean.

## Universal heuristics

- **Open a location with scale.** Lead a scene with an `establishing_wide` (or
  `impact_splash`) before any `close_up`, so the reader is oriented before they
  are drawn in. Scale juxtaposition (a tiny figure after a void) reads as a reveal.
- **One open question by the first screen.** The cold-open should raise exactly
  one question the reader wants answered — withhold the rest.
- **Vary the vertical rhythm.** Alternate tall/splash ↔ medium ↔ small/void cuts.
  Avoid a run of ≥4 cuts that share the same `shotType` with nothing breaking it
  (`craft/rhythm-monotony`); a non-`gutter` transition is a deliberate rhythm
  break, a plain `gutter` is not.
- **One idea per scroll-beat.** Keep ≤2 dialogue bubbles and short, attributed
  lines per cut; split longer dialogue across consecutive cuts.
- **Isolate the payoff.** Put the key reveal/impact on its own cut with nothing
  competing — an `impact_splash` for action, a `small_centered` quiet beat for
  drama.
- **Shift palette on a scene change.** Use a craft transition (`palette_shift`,
  `black_band`, `title_card`, `desaturate_repeat`, `fade`) and a fresh per-cut
  `palette` when the scene or tone turns, rather than a plain gutter.

## Tension arc

Lay beats against a **setup → escalation → payoff** curve: an atmospheric open,
a build, a kinetic turn, a single payoff, then a cut/hook. Comedy runs
setup → escalation → punchline and uses more, shorter beats (≈2× the vertical
real estate of romance).

## Per-genre cold-opens

The `--genre` templates seed these shapes (cold-open + a short beat curve):

| Genre | Cold-open | Default craft seeds |
|---|---|---|
| **romance** | Dialogue-first withhold over an `establishing_wide`, then draw into a `close_up`. | warm palette; `thought` tone for interiority; `fade`/`palette_shift`. |
| **comedy** | Tonal misdirect — a serious, ominous open the next beat undercuts. | bright palette; `impact_splash` reveal; `hand_lettered` SFX; `chibi` styleTag; `scene-break`/`beat`. |
| **action** | Desire/question montage (tight `medium`→`close_up`) that pulls back to a `establishing_wide` **scale reveal**, then an `impact_splash` payoff. | bold palette; short gutters for montage pace; `impact_band` SFX; `black_band` beat before the clash. |
| **thriller** | Threat-object `close_up` cold-open with a **sound-cue** `title_card`, pivoting darker. | dark palette; `whisper` tone; `desaturate_repeat` tonal pivot; `reality` layer. |
| **slice-of-life** | Gentle `establishing_wide` open into a quiet, warm beat. | muted palette; soft dialogue; `fade` close. |

Each template produces a VALID, lint-clean project; it is seed content to edit,
not a finished episode.
