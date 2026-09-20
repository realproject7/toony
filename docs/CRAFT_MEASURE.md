# Craft Measurement

`toony measure` reads a rendered episode back as numbers, so a style pack has an
exit condition. A pack sets craft knobs — the transition gutter budget, the cut
height distribution, cut density, palette, and whether art reads full-bleed or
inset — and every one of them is visible on the page. Without a measurement,
"this pack is done" is a judgement; with one, it is a range.

```sh
toony measure my-story --episode ep-001                        # the table
toony measure my-story --episode ep-001 --json                 # for diffing
toony measure my-story --episode ep-001 --against band.json    # graded
toony measure my-story --episode ep-001 --against noir-band    # a pack's band
```

Exit codes: `0` measured (and in band, when a band was given), `1` out of band,
`2` a usage or IO failure.

## How it measures

It composes the episode exactly the way `toony export stitched` does — the same
cuts, gutters, transitions, and lettering, stacked into one page — and reads the
pixels of that page. So:

- **no image provider is involved**, and no prior export is needed;
- what is measured is what a reader would see, not a model of it;
- the same episode always measures identically. Run it twice, diff the JSON.

A cut with no image asset yet composes a flat neutral background, which honestly
measures as empty space. That would read as a very high gutter ratio and a very
light page, so the report says how many cuts are still without art rather than
letting that pass for craft. Measure an episode after its art is in.

## What is measured

Every run length is a share of the **render width**, so the numbers do not change
when you render wider. The page they read is width-invariant too: a transition's
`gutterHeight` is px on the project's `referenceWidth` column and is scaled to
whatever column the export renders at, so a band grades the work rather than the
file. A screen is `width × screenAspect`, and `--screen-aspect`
(default `2`) is the reading viewport the measurement assumes. Only
`panelsPerScreen` and `gutterIntrusionsPerScreen` read it, and they scale
linearly with it: double the aspect and both counts double. Every other metric
measures the same at every aspect, so a band file pins an aspect to give its two
count ranges a meaning, not to make the rest comparable.

| Metric | What it reads | The knob it grades |
|---|---|---|
| `gutterRatio` | share of the page that is inter-panel space | the transition `gutterHeight` budget |
| `gutterMedian` | the typical gutter run | the pack's default `gutterHeight` |
| `panelHeightMedian` | the typical cut run | cut height |
| `panelHeightSpread` | how much cut heights vary | whether the rhythm is even or ragged |
| `panelsPerScreen` | cuts per screen of scrolling | cut density — how fast the eye moves |
| `gutterIntrusionsPerScreen` | elements floating in empty space | `placement: gutter` lettering and SFX |
| `panelInset` | flat margin at a panel's two edges, summed | full-bleed art versus art floating in a column |
| `valueMean` | luminance of the panel interiors (0–255) | cut `palette` |
| `valueSpread` | how far that luminance ranges | the light/dark arc |
| `saturationMean` | colour intensity (0–1) | palette intensity |
| `hueBias` | mean hue in degrees, or `null` with no colour at all | the pack's colour identity |

### The row rule

A row is **flat** when its luminance barely varies across the width — it carries
no art, so it reads as inter-panel space. Two floors then clean up the runs:

- a flat run shorter than **1.6% of the width** is a seam inside the art, not a
  reading pause, so it is absorbed into the art around it;
- a non-flat run shorter than **16% of the width** is not a cut. It is something
  floating IN the gutter — a bubble or an SFX over the empty space between cuts.
  It is folded back into the gutter for rhythm and counted as
  `gutterIntrusionsPerScreen` instead, so a run of floating bubbles cannot
  masquerade as a burst of tiny panels.

Both floors are shares of the width, never of the screen. They decide which runs
exist, and every metric is read off the surviving runs, so keying them to the
screen quietly moved all of the metrics above with `--screen-aspect` even after
their own units were fixed.

Colour is sampled from the panel **interior**: each sampled row's flat margins
are trimmed before its pixels count. That is not a detail. Sampling whole rows
makes every genre come back the same near-white, because an inset panel leaves
flat page background at both edges and the margin dominates the average.

The colour trim uses an **older margin rule than `panelInset` does**, and the
difference is set out under [What counts as a margin](#what-counts-as-a-margin)
below. If your pack reserves a band on the right of its cuts, read that section
before you read its colour numbers.

### What counts as a margin

`panelInset` is the flat page margin an inset panel leaves beside the art. It is
measured on the middle row of every panel run, and reported as the **sum of both
edges** as a share of the width — a page with a tenth of the column left blank on
each side reports about `0.2`, not `0.1`.

A margin is, per edge: **how far one colour reaches inward from that edge before
it changes**, where "one colour" allows 10 per RGB channel of drift, and the
colour it has to keep is **that edge's own outermost pixel**.

**On a render this measures something else than on a reference capture, and a
band author has to know which.** A captured page's margin is reserved: the artist
left it. A rendered page's art fills its panel edge to edge, so the run is
whatever the model drew flat near the border. Three composed pages of one pack,
identical in every geometric respect and differing only in their art, measured
`0.1932`, `0.1470` and `0.1232` — a spread of 0.070, wider than either shipped
band's whole range, against a pack-side lever (one more gutter-placed line) worth
about 0.016. Both shipped packs therefore record this metric and neither grades
it (#263). Grade it on a render only once that ticket separates a reserved band
from a flat art edge.

What follows from the margin rule, and what a band author needs to know:

- **The two edges are independent, and are not clipped against each other.**
  Neither run is required to match the other and neither is shortened by it, so
  the sum is **not bounded by 1**: a row of two flat tones reports essentially
  the whole width, `0.9967` measured on drawn art. Where the two edges come from
  differs too — `examples/dead-air` is a page whose two edges are different
  colours because the ART is, not because anything was reserved.
- **A page and its mirror image measure the same number.** That is the property
  the per-edge rule exists to give. Until #255 both runs were compared against
  the **left-most** pixel, so a reserved band on the left registered at its full
  width and the identical band on the right registered as nothing: the same
  seven-cut page measured `0.1801` one way and `0.0013` the other. Through the
  real `placement: "gutter"` path, a band reserved on the left measured `0.1800`
  and the same band on the right `0.0100`; both now measure `0.1900`.
- **Anything drawn in the margin ends it.** The run stops at the first pixel that
  differs, so a bubble floating in a reserved band is where the margin stops, not
  where the art starts. Measured on drawn art: a band a fifth of the column wide
  reports `0.2100` empty, and `0.0733` with a bubble sitting a sixteenth of the
  way into it.
- **Whatever is AT the edge is what the margin is made of.** The anchor is the
  outermost pixel, so a bubble that reaches the edge is not an interruption —
  it becomes the colour the run follows, and the empty band behind it then ends
  the run. The same band with that bubble pushed flush to the edge reports
  `0.1567`. Keep lettering off the outermost column if you want the margin read
  as page.
- **Art that happens to be flat at its own edge counts, and there is no ceiling
  on how much.** Nothing here distinguishes page background from a wide flat
  passage of the drawing, so a page with no reserved band at all still reports an
  inset: `0.0663` on `examples/dead-air`, `0.0233` on drawn full-bleed art,
  `0.0750` on a drawn full-bleed gradient. Those are **readings, not margins**.
  How large they get is a property of the art: on a gradient the two runs are the
  same length, so the reading is twice what the left-anchored rule gave —
  `0.0367` → `0.0750` here, and a reviewer flipped verdicts in both directions
  with gradient pages at `0.0488` → `0.0977`, `0.0957` → `0.1914` and `0.1367` →
  `0.2734`. Do not treat any figure as a safe noise floor. Re-measure.
- **Gutters do not count.** Only the middle row of a **panel** run is measured, so
  inter-panel space never contributes, whatever colour it is.
- **The two rules agree when each margin is a single constant colour and the
  right one is within the tolerance of the left-most pixel.** That is the case
  the reference captures were read under: art inset in one page background on
  both sides. A margin that eases off rather than stopping reads differently
  even when both edges look the same: a page whose edge pixels sit 7 levels
  apart, inside the tolerance, measures `0.1983` left-anchored and `0.5767`
  per edge.

**The colour metrics do not use this rule.** `valueMean`, `valueSpread`,
`saturationMean` and `hueBias` trim each sampled row through the **pre-#255**
pair, both runs anchored on the left-most pixel. So a reserved band on the right
is not trimmed out of the palette: drawn art that measures a mean luminance of
`76.4` with its band on the left measures `110.0` with the identical band on the
right. It is kept because it is one of the definitions this side is built to
share with the reference analyzer, which anchors both runs the same way. The two
sides already differ in **two** places (see
[The loop this closes](#the-loop-this-closes)); changing the trim would make
three, and would put every shipped colour range on a convention its numbers were
never read at. #257 carries that re-basing.

#### Which side to reserve, until #257 lands

The lever is **`placementSide`** on each `placement: "gutter"` lettering overlay:
`"left"` or `"right"`, and **its schema default is `"right"`** — so a gutter
bubble written without the field reserves the side the colour trim cannot see.

- **One side:** set `placementSide: "left"` on every gutter overlay of the cut.
  This is the workaround #257 removes, and it exists only for colour now:
  `panelInset` reads either side the same since #255.
- **Both sides:** a cut with gutter overlays on both sides reserves **two** white
  bands, one per side. That is the arrangement with nothing side-dependent left
  in it — measured `0.3600` inset (two bands of `0.18`) under both the old rule
  and the new one, and identical on every metric including `valueMean` when the
  art is mirrored. Prefer it when a cut needs lettering on both sides anyway.

Do not change the schema default to get this; `placementSide` is a lettering
field with readers outside the measurement.

#### What this change did to the bands measured before it

Both shipped `panelInset` ranges were read while the reference analyzer anchored
**both** runs on the row's left-most pixel — the convention this side replaced.
Its captures include full-bleed pages, so that convention read one side of a
banded page as zero and the per-edge rule reads **higher**.

The reference analyzer now measures per edge too, and both ranges were re-derived
from the same episodes:

| Band | Pack | Left-anchored | Per-edge, since #255 |
|---|---|---|---|
| `panelInset` | Muted Court Romance | `0.092`–`0.131` | `0.125`–`0.171` |
| `panelInset` | Cold Revenge Mystery | `0.166`–`0.200` | `0.184`–`0.218` |

Both packs **record** these ranges rather than grading them, for a reason that has
nothing to do with the rule above — see the next section.

No other metric moved on either side. The pilot's kept page reads `0.1253` under
the new rule and still grades in band on all eight of its graded metrics. The
lane-by-lane before-and-after numbers are on #255.

**Both sides still classify the same rows.** The row rule is untouched — the
flat-row threshold, both run-length floors and what counts as a panel all
measure exactly as they did. The margin rule reads a row the run rule has
already called a panel; it never decides which rows those are. See
[The loop this closes](#the-loop-this-closes) for both recorded differences.

## What is deliberately NOT measured

**Bubble size, line count, text density, and font.** Those are language-dependent
and this measurement is not.

The reference material this yardstick was calibrated against is Korean; Toony's
default is English. Korean sets syllables in near-square blocks and fits far more
meaning into the same bubble, so a text-density figure carried across languages
would size English bubbles wrongly — bubbles too small, lines overflowing.

Text fit is covered instead by lints that run on **our own English content**:
`craft/bubble-density`, `craft/line-wrap`, and the overflow lint, all in
`toony lint`. Keep the two concerns apart: the visual rhythm can be borrowed
across languages, and how much text fits inside it cannot.

## Band files

A band is the target: a range per metric. Only the metrics it declares under
`metrics` are graded, so a band can start with one number and grow.

```json
{
  "bandFormat": 1,
  "name": "Noir",
  "screenAspect": 2,
  "metrics": {
    "gutterRatio": { "min": 0.15, "max": 0.45 },
    "panelHeightMedian": { "min": 0.1, "max": 0.7 },
    "valueMean": { "max": 140 }
  }
}
```

| Field | Required | Rule |
|---|---|---|
| `bandFormat` | yes | Must be `1`. |
| `name` | no | Shown in the verdict. One line, at most 80 characters. |
| `screenAspect` | no | The viewport the band was measured at. The measurement adopts it, unless `--screen-aspect` says otherwise. |
| `metrics` | yes | **At least one metric**, each `{ "min": n }`, `{ "max": n }`, or both — inclusive. Every one of them is **graded**. |
| `recorded` | no | Ranges the band measured and does not grade. |
| `provenance` | no | What the band's numbers were measured from. |

`metrics` is required and an empty `metrics` is an **error**. A band is a
target; one that grades nothing is not a band, and `recorded` cannot stand in
for it — a band consisting only of recorded ranges is rejected.

Like a pack manifest, a band is checked against a strict allowlist: an unknown
key or an unknown metric name is a **rejection**, not something quietly ignored,
so a typo in a metric name can never silently grade nothing. A metric with no
measurable value (an episode with no colour at all has no `hueBias`) fails its
range rather than passing by absence.

A pack ships its band in the manifest's `craftBands`, and `--against` then takes
the band **id** instead of a path. See
[`PACK_FORMAT.md`](./PACK_FORMAT.md#craftbands).

### Band files and toony versions

`bandFormat` is `1` and an optional field added to a band does **not** bump it.
That is the deliberate trade, and it has a consequence worth knowing before you
ship: because unknown keys are rejected, a toony older than a field does not
skip that field — it rejects the **whole band**, and `--against` fails with a
usage error naming the key.

So a band file is readable by every toony from the one that introduced its
newest field onwards, and by none before it. A pack that uses a field added
after its readers' toony should say which minimum toony version it needs; a band
that must be read by older toony should leave the newer fields out.

That trade cuts the other way for a **measurement** definition, and #255 is the
case: a `panelInset` range grades one way on a toony from before it and another
way on a toony after, **silently**, because `bandFormat` is still `1` and the
band file is byte-identical — so a pack that ships a `panelInset` range should
say which minimum toony version its numbers were measured at.

### Metrics a band records without grading

A metric the band measured but should not grade goes in `recorded` rather than
`metrics`:

```json
{
  "bandFormat": 1,
  "metrics": { "gutterRatio": { "min": 0.34, "max": 0.48 } },
  "recorded": { "gutterIntrusionsPerScreen": { "min": 0.4, "max": 3.1 } }
}
```

The range shape is the same. What differs is that a recorded metric is measured
against nothing: `--against` prints it beside the graded rows marked
`recorded, not graded`, and it moves neither the verdict nor the exit code. In
`--json` it is a separate `band.recorded` list whose entries carry no `inBand`
field at all, so a reader cannot fold the two lists together by accident.

The alternative is deleting the range, and deleting it throws away the only
record of what was measured. `gutterIntrusionsPerScreen` is the standing case:
it moves by up to 1.7x between two episodes of one work, so no band should fail
a render on it — and a reader of the band still needs to see what the studied
pages did.

A metric is graded or recorded, never both. An empty `recorded`, an unknown
metric name, and an empty range are rejected here exactly as they are under
`metrics`.

### Where a band's numbers came from

`provenance` says what was measured. The same ranges read off two sampled
episodes and off twenty contiguous ones are not the same claim, and nothing in
the numbers themselves says which one is on screen:

```json
{
  "bandFormat": 1,
  "metrics": { "gutterRatio": { "min": 0.34, "max": 0.48 } },
  "provenance": {
    "works": [
      {
        "label": "thriller work A",
        "episodes": 2,
        "captureMode": "contiguous",
        "constantColumnWidth": true,
        "language": "eng",
        "pageLengthInWidths": 118.4
      },
      {
        "label": "thriller work C (KOR)",
        "episodes": 2,
        "captureMode": "sampled",
        "constantColumnWidth": false,
        "language": "ko"
      }
    ]
  }
}
```

| Field | Required | Rule |
|---|---|---|
| `works` | yes | 1 to 100 studied works. |
| `works[].label` | yes | The neutral label the work is studied under. One line, 1 to 80 characters, unique within the band. |
| `works[].episodes` | yes | Episodes of that work measured. A whole number, 1 to 10000. |
| `works[].captureMode` | yes | `contiguous` — every frame of an episode, in order — or `sampled`. |
| `works[].constantColumnWidth` | yes | Whether every page captured from this work was one column width. |
| `works[].language` | no | A language tag: a primary tag, an optional script, an optional region — `ko`, `eng`, `ko-KR`, `ko-Hang-KR`. Nothing wider. |
| `works[].pageLengthInWidths` | no | How much page that work contributed, as one extent in column widths (summed episode height ÷ column width), up to 1000000. |

**The capture facts sit on the work, not on the band.** They are facts about a
capture, and a band can hold several: a band built from one contiguous set and
one sampled set would otherwise have to state one answer and be wrong about one
of them, silently, since neither fact is visible in the numbers.

Both are required on every work, because each one moves the numbers. Every
length here is a share of the column width, so a capture set of mixed widths
normalizes each page by a different number and inflates lengths across the whole
set while no single number looks wrong. A median over run heights is read off
whole regions of a page, so dropping part of an episode moves it further than
the differences such medians are used to argue about. `pageLengthInWidths` is
the sample size behind every median, and two works at the same episode count can
differ four-fold in it.

**No field holds a title, the place the pages came from, or a link, and there is
no free-text field either.** A band ships inside a pack, so a field that invites
one of those is how one gets published. That absence is the guarantee: a key
like `title` or `source` is rejected as an unknown key, because there is nowhere
for one to go.

The label is checked for a link or a domain on top of that, and **that check is
a backstop, not a guarantee**. It catches the obvious forms and misses an IP
address, an internationalized host, and any of the ways a domain can be written
to get past a pattern. Do not read a passing label as a cleared one; read it as
a label nobody wrote a source into by accident.

`--against` prints the provenance above the metric table, one line per work with
that work's own capture facts, and carries it in `--json` as `band.provenance`.

## The loop this closes

```txt
  1. COLLECT     reference captures of the genre
  2. MEASURE     the same signals, off the reference
  3. TRANSLATE   the numbers into a pack: gutter budgets, cut heights, palette
  4. GENERATE    build a test episode with the pack, render it
  5. COMPARE     toony measure --against the band
  6. ITERATE     adjust the pack, re-render, until every metric is in band
  7. SHIP        the pack is done when its own output measures inside the band
```

Steps 2, 5, and 6 are mechanical. Step 3 is the craft judgement, and it is the
part worth paying for. This command is step 5 — and it produces the same metric
set as step 2, deliberately, because a comparison between two different
definitions means nothing.

The two sides share the row rule, both run-length floors, the Rec. 709 luminance
coefficients, the interior colour sampling, and the rounding. One difference is
left, recorded so it is never mistaken for an accident.

**The row rule.** The reference side also requires a flat row to be **light**,
because a Korean webtoon page sets its panels on white. Toony transitions are
authored colour fields that are usually dark, so keeping that clause makes the
gutter metric blind to the knob it exists to grade — on `examples/dead-air` it
reports a gutter ratio of `0.0` and one panel spanning the whole episode.
Dropping it moves the reference captures' own numbers by at most 0.006 of the
gutter ratio and changes none of their conclusions, so "flat" alone is the
definition both sides use.

**`panelInset`'s margin rule** was the second difference, and it is closed. #255
made this side measure each edge against its own outermost pixel; the reference
side had anchored both runs on the row's left-most pixel, and it now measures
per edge as well. Both keep the left-anchored margins for the interior colour
sample only. The cost of the gap was the two shipped ranges, re-derived above.
Rows were classified identically throughout: the margin rule reads a row the run
rule has already called a panel, and changes nothing about which rows those are.

Holding the count down is why the colour trim was left on the left-anchored rule
on both sides (#257): a difference here would be a difference in every colour
metric, and that is not a comparison a band can carry.

## Where this lives in the code

Measurement is `packages/export/src/craft.ts` — it belongs with export because
export owns the composition it reads. The command is
`packages/cli/src/commands/measure.ts`, and pack-contributed bands come through
the same discovery seam every other pack contribution uses.
