# Style Guide — "Dead Air"

Clean modern webtoon lineart with soft cel shading; a noir, high-contrast read.

## Palette

A cold drift: the per-cut `palette` darkens from muted teal (the calm open) toward
near-black (the blackout) as dread builds. Wren carries teal-and-amber; the Caller
is desaturated near-monochrome.

## Lettering & rhythm

- ≤ 2 dialogue bubbles per cut; short attributed lines (one idea per scroll-beat).
- Bubble grammar carries emotion: borderless narration captions, plain speech,
  cloud thought, a `beat` "…", a scalloped `tone=shout`, low-emphasis `ambient`,
  and SFX in two modes (`hand_lettered`, `impact_band`).
- `shotType` alternates every cut so no monotony run forms; transitions vary
  (title_card / gutter / scene-break / palette_shift / black_band / fade) with
  `color` where the band should read as a deliberate beat.

Asset files live under each episode's `assets/` folder and are referenced by
project-relative path only; nothing here is hard-coded — artwork regenerates from
each cut's `imagePrompt` plus the character lockstrings.
