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
| `panelInset` | flat margin at a panel's edges | full-bleed art versus art floating in a column |
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
coefficients, the interior colour sampling, and the rounding. They differ in
exactly one place, recorded here so it is never mistaken for an accident: the
reference side also requires a flat row to be **light**, because a Korean webtoon
page sets its panels on white. Toony transitions are authored colour fields that
are usually dark, so keeping that clause makes the gutter metric blind to the
knob it exists to grade — on `examples/dead-air` it reports a gutter ratio of
`0.0` and one panel spanning the whole episode. Dropping it moves the reference
captures' own numbers by at most 0.006 of the gutter ratio and changes none of
their conclusions, so "flat" alone is the definition both sides use.

## Where this lives in the code

Measurement is `packages/export/src/craft.ts` — it belongs with export because
export owns the composition it reads. The command is
`packages/cli/src/commands/measure.ts`, and pack-contributed bands come through
the same discovery seam every other pack contribution uses.
