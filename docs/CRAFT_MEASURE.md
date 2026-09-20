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
**pixels** of that page. So:

- **no image provider is involved**, and no prior export is needed;
- the eleven craft metrics are what a reader would see, not a model of it;
- the same episode always measures identically. Run it twice, diff the JSON.

**One thing this command reports is not read off pixels.** The transition mix —
which kind of gap sits between each pair of cuts — comes from the declared
`type` on each transition record, because the episode declares it and a
re-derivation from the page would be lossy. That is a different kind of evidence
from everything above, and it is deliberate; the reasons and the cost are in
[the transition vocabulary a band declares](#the-transition-vocabulary-a-band-declares).
Read a geometry number as a claim about the page and a mix number as a claim
about the script.

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

Beside those eleven, `toony measure` reports the episode's **transition mix**:
which kinds of gap it puts between its cuts, how often, and how tall each runs.
That one is read off the declared transition records rather than off the page —
see [the transition vocabulary a band declares](#the-transition-vocabulary-a-band-declares).

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
share with the reference analyzer, which anchors both runs the same way. Moving
the trim on one side alone would end that, and would put every shipped colour
range on a convention its numbers were never read at. #257 carries that
re-basing, on both sides together.

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
[The loop this closes](#the-loop-this-closes) for the differences that were
recorded between the two sides, and how each was closed.

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
| `transitionVocabulary` | no | Which kinds of gap the work uses, in what proportion, at what heights. **Graded.** |
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

### The transition vocabulary a band declares

Everything above grades how much page is spent on empty space and how tall the
runs are. None of it asks **what is in a gap**: a band grades gutter heights and
never looks at whether the gutter is page background, a black void, a mood field,
or a card carrying a line. That is a separate convention of a work, and
`transitionVocabulary` is where a band declares it (#236).

```json
{
  "bandFormat": 1,
  "metrics": { "gutterRatio": { "min": 0.34, "max": 0.48 } },
  "transitionVocabulary": [
    {
      "kinds": ["gutter", "hard-cut"],
      "share": { "min": 0.407, "max": 0.856 },
      "height": { "min": 0.306, "max": 0.523 }
    },
    {
      "kinds": ["narration_card", "dialogue_card", "time_card"],
      "share": { "min": 0.144, "max": 0.242 },
      "height": { "min": 0.626, "max": 0.971 }
    },
    { "kinds": ["void"], "share": { "min": 0, "max": 0.389 } }
  ]
}
```

| Field | Required | Rule |
|---|---|---|
| `kinds` | yes | 1 or more transition kind names, **from the core's own vocabulary**. A kind belongs to at most one entry across the whole band. |
| `share` | yes | The combined share of the episode's gaps these kinds take. A range inside 0..1. |
| `height` | no | The median drawn height of those gaps, in column widths. A range from 0. |

**The kinds are a set, not one name.** That is the granularity the reference was
measured at: a captured page is classified by colour and content, and a card is a
card — nothing in it says whether the words are narration or dialogue. An entry
per kind name would force a pack to invent a split that was never measured. A
single-kind entry is the same thing with a set of one.

**`share` is required and `height` is not.** A height range says how tall a gap of
these kinds runs *when one occurs* and says nothing when none does, so an entry
carrying only a height range grades nothing at all against an episode that uses
none of its kinds. Requiring the share forces the band to **state** how often,
so zero is an answer the band gave rather than one it never addressed. It forces
a range, **not a floor**: `{ "max": 0.3 }` is a share range and is satisfied by
zero of the kind. A band that means "this kind must appear" writes a minimum.

When the episode draws no gap of an entry's kinds, `--against` prints the height
row as `no gap of these kinds` rather than as a pass, and `--json` gives it no
verdict field at all.

**A share is a share of every gap the episode drew**, not of the gaps the band
happened to name. Kinds no entry claims are legal and are not an error — a band
grades what it declares, exactly as `metrics` does — and their gaps still count
in the denominator. The measured mix prints in full beside the verdict, so what
was left ungraded is visible.

The shares are also checked against each other, because a vocabulary no episode
can satisfy is a defect that is invisible entry by entry. Minimums that add past
1 describe an episode that is more than all of itself. And when the entries
between them claim **every** kind, every gap falls in some entry, so the shares
must add to exactly 1 and maximums adding to less than 1 grade every episode
out. With one kind left unclaimed the remainder has somewhere to go, and no sum
of maximums is impossible. Both ends are compared at the four decimal places a
measured share is rounded to, so a floor that only floating point puts over 1 —
`0.197 + 0.687 + 0.116` is `1.0000000000000002` — is not refused.

#### What the comparison reads, and what it cannot see

**The episode side reads the declared `type`, not the pixels.** The reference
analyzer classifies a gap by colour and content because a capture is an image
with no metadata; a toony episode declares its transitions, so the kind is read
rather than inferred. Three things follow:

- It is **exact**. The classifier is the part of this measurement that has
  already been wrong without anything catching it: requiring a flat row to be
  light as well as flat made `void` undetectable by construction on a white-page
  work and reported 0% void for a whole genre. A re-derivation would put the
  pack's verdict back behind that classifier.
- It **separates kinds pixels cannot**. `narration_card` and `dialogue_card` are
  the same rectangle with different words in it, and a `color_field` authored
  dark is a `void` to any luminance threshold.
- It grades the **pack**, not the art. A page-derived mix would move with
  whatever the image provider returned, and this measurement already counts a
  flat region inside a panel as page structure (#230), so blank sky would arrive
  as extra empty gutter.

The cost is the other half of the same fact: **this grades the script, not the
page.** A declared `void` whose band the renderer draws light is still counted
as a void here. The geometry metrics are the page-side check and they are read
off pixels; the two sit side by side in one report because neither is the other.

**Heights are the height a band occupies, not the number authored.** A card or a
solid band authored below the legibility floor renders at the floor, and grading
the authored number would grade a height nobody sees. A transition that draws no
band at all — a plain gutter at zero height — is not a gap: it is counted and
reported separately, so an episode whose transitions mostly vanish does not look
like an episode that has few of them.

#### Which bucket a kind belongs in, and what that rests on (#267)

The ranges above were measured by sorting reference pixels into four buckets —
**page background, void, color field, card** — so an entry that groups kinds is
asserting which bucket those kinds fall in. That assertion used to live in each
band and be checked nowhere. It now has one home,
`declaredBandAppearance` in `@toony/render`, which resolves it from the same
precedence chain and the same default fills the renderer fills a band with, so
the grouping a band is written against cannot drift from what gets drawn.

**The mapping is only true of a kind's DEFAULT rendering.** That is the whole of
the assumption, and it is not a small one: `Transition.color` and
`Transition.gradient` win over a kind's default, so an authored fill can move a
band into a different bucket than the one the band counts it in — a `void`
filled `#ffffff`, or a `color_field` filled at a value any luminance rule reads
as a void. `toony lint` reports that as **`craft/transition-appearance`**, an
`info` finding naming what the kind's default draws and what the authored fill
draws; the grading here neither sees it nor is changed by it.

| Bucket | Kinds, at their default fill |
|---|---|
| page background | `gutter`, `hard-cut`, `fade`, and `scene-break` while it carries no text |
| void | `void`, `black_band`, and `beat`, `time-skip`, `title_card`, `narration_card`, `dialogue_card`, `time_card` while they carry no text |
| color field | `color_field`, `palette_shift` |
| card | `beat`, `time-skip`, `scene-break`, `title_card`, `narration_card`, `dialogue_card`, `time_card` — once they carry text |
| none of the four | `desaturate_repeat` |

**`desaturate_repeat` is in no bucket, and that is an answer rather than a
gap.** Its neutral grey default is over the void ceiling and under the
colour-field saturation, so the reference's own rule puts it nowhere, and both
shipped bands leave the kind unclaimed on exactly that ground. A band that
claimed it would be claiming a bucket its pages never showed.

**Seven kinds appear twice, and a table from kind to bucket cannot be written
because of them.** The card and break treatments are the ones that DRAW the
transition's text, so what they read as depends on whether there is any: a
text-bearing one is a card, and a text-less one is the bare ground it sits on —
the dark card fill for six of them, the reading white for `scene-break`, which
falls through to it. Both of this repo's own `examples/last-train` scene-breaks
carry a label, so both are cards; a scene-break without one is not.

Nothing a band draws for its own sake counts as carrying a line. `beat`,
`time-skip` and `title_card` draw a small type LABEL with no detail at all, and
it names the kind rather than carrying a line — a dark rectangle with a small
label on it is a void to anything reading the page. The other four draw even
less: a text-less `narration_card`, `dialogue_card` or `time_card` composes a
single flat colour, and a text-less `scene-break` its divider and nothing else.

The text a card kind draws is its `detail`, which is `text`, then `sfx`, then
`humanNote`, then `agentNote` — so a `beat` with only a production note on it is
grouped as a card and one without it as a void. The renderer really does draw
that note, so the grouping is faithful to the page rather than a quirk of this
rule, but it does mean an annotation moves a bucket.

**Two of the three boundaries are the reference analyzer's own, recorded
verbatim** in the transition-vocabulary note in `packages/export/src/craft.ts`:
*flat under luminance 60 is a void, flat over saturation 0.18 is a colour
field*. `BAND_VOID_VALUE` and `BAND_COLOR_FIELD_SATURATION` are those two
numbers and are not tunable here — moving one makes this classifier disagree
with the measurement whose buckets it names, which is this ticket's own defect
one level up. Value is Rec. 709 luminance on 0..255 and saturation is
`(max - min) / max`, both the definitions `sampleColor` grades a page with, and
the tests order them as the rule lists them: a dark saturated fill is a void
before it is anything else.

The third is not the reference's. Its rule says *flat and page-coloured is an
empty gutter* and records no number for page-coloured, so
`BAND_PAGE_BACKGROUND_MIN_VALUE` is chosen here — against the renderer's own
defaults rather than freely. Every default has to land in the bucket its kind is
grouped under, which leaves a window of (149.4, 233.7]: above `#9a958c`, which
must stay unclassified, and at or below the fade treatment's default gradient,
the **darkest** page ground the renderer draws (its ends average 233.7; the
`#ffffff` of a plain gutter is the palest at 255 and constrains nothing). 190 is
the round value nearest that window's middle.

What it does not see, in full:

- **A band's `fade` overlay.** It covers part of the band rather than filling
  it, so a fill and a fade that disagree pass.
- **A fill the core cannot parse** — a named CSS colour, a paint server. It
  yields no bucket and no finding, because a colour nothing can measure is one
  nothing should make claims about. A card kind carrying a line is a card before
  any colour is read, so an unparseable fill on one still reads as a card.
- **A transition the reading sequence never reaches.** Like the mix above, this
  reads the sequence, so an orphan transition record is never classified.
- **A transition that draws no band.** A zero-height plain gutter is counted
  `undrawn` by the mix and graded against nothing, so no band counts it in any
  bucket and there is nothing for a fill to contradict; the lint skips it
  through the same `resolveBandHeight` the mix resolves it with.
- **Anything but the band's fill.** Text colour, the scene-break divider and the
  card label are not read.
- **Whether the reference analyzer would agree in the cases it records no rule
  for.** Its thresholds are not in this repository; the two numbers above are
  quoted from a record of them, and the third is this side's own definition.

#### `gutterMedian` and a gutter entry's height are different numbers

Both are printed under the word "gutter" and they measure different populations.

`gutterMedian` is the median over **every flat run on the page** — every gap
whatever kind it is, plus any flat region inside the art. A vocabulary entry's
height is the median over **only the gaps its own kinds account for**. On a page
whose gaps are mostly one kind the two land close together, which is how they
coincide in both shipped packs; on a page with a wide mix they do not, and
neither is wrong.

They also round differently in one respect worth knowing: `median` here is the
reference analyzer's `sorted(xs)[len(xs) // 2]`, taken element-wise and never
averaged, so on an **even** count it returns the **upper** of the two middles.
An entry covering four gaps is graded on the third-smallest, which leaves the
tallest unbounded by the range; an entry covering two is graded on the taller.
Both sides of the comparison use that rule, so it is not a divergence — but a
band author who reads "median" as the average of two middles will expect a
different number than this returns.

#### What `--json` carries

`transitions` is the measured mix: `gaps`, `undrawn`, and `kinds`, one entry per
kind the episode draws. Each kind carries `count`, `share`, `heightMedian`, and
`heights` — **every one of that kind's gap heights, in reading order**. That
last field grows with the episode, so a report is not a fixed-size record; it is
there because a multi-kind entry's height is the median over its kinds pooled,
and pooling needs the gaps rather than the per-kind medians.

`band.transitions` carries one verdict per declared entry. A height range with
no gap to measure appears with `"value": null` and `"graded": false` and **no
`inBand` field at all**, the same device `band.recorded` uses: a reader diffing
two reports cannot mistake "there was nothing to grade" for "it passed".

`toony measure` prints the measured mix with or without a band, because that mix
is what you read to author a range in the first place.

## Planning an episode before it exists

`toony measure` grades a page it composes, which costs what the art costs. A
hundred-panel episode (#233) is three to four hours of generation against a local
GPU, and that is one attempt. Everything the measurement says about **page
structure** is arithmetic on the cut and transition lists and needs no pixels at
all, so it can be answered in a second, before a prompt is chosen.

```sh
toony plan my-story --episode ep-001                    # an episode's own lists
toony plan --spec plan.yaml                             # a structure, as beats
toony plan my-story --episode ep-001 --against noir-band  # graded
toony plan --spec plan.yaml --json                      # for diffing
```

Exit codes match `measure`: `0` planned (and in band on what it checked), `1`
outside a range it **could** check, `2` a usage or IO failure.

### It checks five metrics, and says so every time

| | |
|---|---|
| **Checked** | `gutterRatio`, `gutterMedian`, `panelHeightMedian`, `panelHeightSpread`, `panelsPerScreen` |
| **Not checked** | `gutterIntrusionsPerScreen`, `panelInset`, `valueMean`, `valueSpread`, `saturationMean`, `hueBias` |

The four colour metrics are sampled from panel interiors; a `palette` field is
not a pixel, and no arithmetic on one produces a luminance. `panelInset` on a
render is whatever the art left flat near its border — three pages of one pack,
identical in every geometric respect, spread it `0.070` — so nothing declared
decides it. `gutterIntrusionsPerScreen` counts short non-flat runs inside empty
space: a card's own text, a break's divider, a bubble over an art-less cut. All
three are *drawn*, and a plan models regions rather than what is drawn in them.

Every run names those six with the reason, in text and in `--json`, band or no
band, in band or out. A band's verdict line names them again, so
`plan verdict: IN BAND ON WHAT A PLAN CHECKS` can never be read as
`verdict: IN BAND`. A plan report carries **no `inBand` field at all** — only
`checkedInBand` — so a consumer cannot sum a partial check into a whole verdict,
the same device a recorded metric and an ungraded height already use.

**A band that grades nothing a plan can check gets no verdict at all.** A band
whose every graded range is colour, `panelInset` or `gutterIntrusionsPerScreen`,
and which declares no vocabulary, leaves both verdict lists empty — and an empty
list of verdicts is trivially "all in band". So that report carries `graded:
false` and **neither** `checkedInBand` nor `inBand`, and the command exits `2`:

```txt
plan verdict: NOT GRADED — band "colour only" grades 4 metric(s) and a plan can
check none of them (valueMean, valueSpread, saturationMean, hueBias).
Run `toony measure --against` once the art exists.
```

Nothing checked is the most partial verdict there is, and the chain it protects
is `toony plan --against <band> && toony generate`: a green light there costs the
hours this command exists to save. It is the rule `validateCraftBandValue`
already applies to a band with an empty `metrics`, one level up.

**A plan that names a page too tall to grade is an error, not a crash.** The run
rule reads a page one row at a time, and a plan can validate while naming more
rows than can be held — `PLAN_PAGE_ROWS_MAX` is 20,000,000, about 16,667 column
widths at the default column where a measured episode runs 138. Over it, and over
the 2000 cuts a plan may name in all, the command fails with exit `2` and a
message. It never exits `1`, which is the code reserved for an out-of-band
verdict.

The **transition mix** is the exception in the other direction: it is read off
declared records, needs no pixels, and goes through the same function
`toony measure` uses. A band's `transitionVocabulary` is therefore graded in
full, and the answer does not change when the art arrives.

### A cut that declares no shape

A cut's height comes from `resolveCutAspect` (`packages/render/src/panel-shape.ts`)
— its `panelAspect` declaration, else its image, else `FALLBACK_CUT_ASPECT`. A
plan asks with **no image**, on purpose, so the same episode plans identically
before and after generation; that is the only way a plan figure and a rendered
one are comparable.

The resolver always answers, so an undeclared cut still produces a panel figure —
one that describes the constant `1.4` rather than the pack. The report counts
those cuts and names the fallback:

```txt
  note: 7 of 7 cuts declare no panelAspect; they were graded at the fallback 1.4,
  not at a shape the pack asked for.
```

Declare `panelAspect` on the cuts, or read the panel rows as a statement about
Toony's default instead of about your episode.

`examples/dead-air` declares `panelAspect: 1.4615385` on all seven cuts, and that
declaration is **load-bearing for the comparison below**, not cosmetic: without
it the plan gives that episode 13635px against the rendered 14153px, and a
`panelHeightMedian` of `1.4` — the fallback constant — instead of `1.4617`.

It is also worth knowing what does **not** establish that the value is right.
The composed output is unchanged, but `measureEpisodeCraft` is structurally
insensitive to `panelAspect` on a cut that has art: `composeCut` reaches the
resolver only on its art-less branch, so declaring `0.5` against 832x1216 art
would leave every measured figure identical too. What establishes it is the
arithmetic and the lint. The art is 832x1216, so `1216 / 832 = 1.46153846…`
against the declared `1.4615385` is a delta of `3.8e-8`, against the `0.02`
tolerance `cut/panel-aspect-mismatch` allows — and that lint **does** fire on a
deliberately wrong value, so its silence here is a pass rather than an absence.

### A structure spec: beats with lengths

`--spec` takes a plan file, which states an episode as **beats** rather than as a
flat list of a hundred cuts. A beat is a label, how many cuts it runs, the shape
those cuts are declared at, and the gaps around them — structure and nothing
else. Who the characters are and where the twist sits are not geometry.

```yaml
planFormat: 1
name: episode one
referenceWidth: 800
beats:
  - label: cold open
    cuts: 11
    panelAspect: 1.4
    gap: { type: gutter, gutterHeight: 157 }
  - label: the call
    cuts: 4
    panelAspect: 2.2
    openWith: { type: gutter, gutterHeight: 314 }   # a scene break
    gap: { type: gutter, gutterHeight: 157 }
  - label: the drop
    cuts: 1
    panelAspect: 0.5
    openWith: { type: void, gutterHeight: 300 }
```

| Field | Required | Rule |
|---|---|---|
| `planFormat` | yes | Must be `1`. |
| `name` | no | One line, at most 80 characters. |
| `referenceWidth` | yes | The column the gap heights are px on, as `webtoon.json`'s own `referenceWidth` is. |
| `beats` | yes | 1 to 500 beats, each with `label` and `cuts` (1–1000), and optional `panelAspect`, `gap`, `openWith`. |

Like a band, a plan is checked against a **strict allowlist**: an unknown key is
a rejection, so a misspelled `panelAspect` can never quietly grade a beat on the
fallback.

**Size it like a real episode, not like an act structure.** The one contiguous
capture of a measured episode came to **19 beats over 103 panels**, and their
lengths ran from **0.50 to 17.18 column widths** inside that single episode.
Nothing in the format normalises a beat against its neighbours or caps the count
at three: each beat carries its own length, its own shape and its own spacing,
and the report gives every beat's length back rather than a median over them —
a median across a thirty-fold spread says almost nothing.

```txt
  beats — 3, in column widths
    cold open   11 cut(s)   17.3625
    the call     4 cut(s)    9.3888
    the drop     1 cut(s)       0.5
```

`lengthInWidths` covers the beat's cuts and the gaps between them, and **not**
the gap it opens on: that gap separates this beat from the one before and belongs
to neither, which is where a beat map cuts too.

**A scene break is not a kind.** It is an ordinary gutter at about twice the
episode's own median, so it is a larger number in the same `gutterHeight` field.
`TRANSITION_TYPES` already carries `scene-break` for an author who wants the
label, and neither needs a field of its own.

### How far a plan is from the render

Both grades resolve a cut through `resolveCutAspect` + `cutHeightAt` and a gap
through `resolveBandHeight`, and both classify rows through the same
`classifyPageRows`. So the **page height is identical**, and on art that is
non-flat throughout, every checked metric is identical too.

Real art is not non-flat throughout, and that is the whole of the difference.
Measured on `examples/dead-air` at a 1200px column — seven cuts of real art, six
gaps of five kinds:

| | plan | rendered | rendered − plan |
|---|---|---|---|
| page height | 14153px | 14153px | **0** |
| `gutterRatio` | 0.1325 | 0.1974 | +0.0649 |
| `gutterMedian` | 0.25 | 0.305 | +0.0550 |
| `panelHeightMedian` | 1.4617 | 1.3492 | −0.1125 |
| `panelHeightSpread` | 0 | 0.3986 | +0.3986 |
| `panelsPerScreen` | 1.19 | 1.36 | +0.17 |
| transition mix | identical | identical | **0** |

Every one of those differences is **flat rows inside the art**. That page has
12278 rows of art, of which 919 are flat enough to read as empty space — dark
night frames with no variation across the width — and `2794 − 1875 = 919` is
exactly the gap between the two gutter-row counts. One cut carries a flat band
long enough to split it in two, which is why the render finds 8 panel runs where
the plan declares 7, and why the spread is non-zero at all.

The card text inside three of the gaps — 23, 34 and 29 rows — moves none of the
five. Each is a non-flat run far shorter than the 16%-of-width panel floor, so
the render folds it straight back into the gutter and counts it under
`gutterIntrusionsPerScreen`, which is one of the six a plan does not check.

So a plan figure is what the **declarations** come to, and the render adds
whatever the art leaves flat. Art can add empty space to a page; it cannot take
any away. Treat a plan's `gutterRatio` as a floor, its `panelHeightMedian` as a
ceiling, and re-run `toony measure` once the art is in — the plan grade never
substitutes for it.

## The loop this closes

```txt
  1. COLLECT     reference captures of the genre
  2. MEASURE     the same signals, off the reference
  3. TRANSLATE   the numbers into a pack: gutter budgets, cut heights, palette
  4. PLAN        toony plan --against the band, before any image exists
  5. GENERATE    build a test episode with the pack, render it
  6. COMPARE     toony measure --against the band
  7. ITERATE     adjust the pack, re-render, until every metric is in band
  8. SHIP        the pack is done when its own output measures inside the band
```

Steps 2, 4, 6, and 7 are mechanical. Step 3 is the craft judgement, and it is the
part worth paying for. This command is step 6 — and it produces the same metric
set as step 2, deliberately, because a comparison between two different
definitions means nothing.

Step 4 is the cheap half, and it exists because step 5 is the expensive one: a
geometry the plan already misses is a render nobody needed to pay for. It checks
five of the eleven metrics and never stands in for step 6.

The two sides share the row rule, both run-length floors, the Rec. 709 luminance
coefficients, the interior colour sampling, and the rounding. `craft.ts` states
the convention in its own header: where this side deliberately differs, the
comment beside the code says so and says why. That comment is the record. No
count is kept here, because a count is exactly the thing that goes stale while
the code under it moves.

Two differences were recorded, and both are now closed. They are kept below so
neither is read as an accident, and so neither is re-introduced as a fix.

**The row rule.** Flatness alone decides an empty row, on both sides. The
reference side once also required a flat row to be **light**. That clause is
gone, and it must not come back. A lightness test measures page colour, and page
colour is not what makes a row empty: Toony transitions are authored colour
fields and a dark one is not light, so the clause reads every dark gap as art,
and an episode whose gaps are all dark collapses to no gutters and one panel
spanning the page. The same clause made `void` undetectable by construction in
the transition classifier. Both failures follow from the rule itself, so neither
depends on which captures happened to be measured. #245 closed the last
statement of this difference, which had also carried a measured impact figure
the collection had long since outgrown.

**`panelInset`'s margin rule** was the other difference, and it is closed. #255
made this side measure each edge against its own outermost pixel; the reference
side had anchored both runs on the row's left-most pixel, and it now measures
per edge as well. Both keep the left-anchored margins for the interior colour
sample only. The cost of the gap was the two shipped ranges, re-derived above.
Rows were classified identically throughout: the margin rule reads a row the run
rule has already called a panel, and changes nothing about which rows those are.

Opening no new one is why the colour trim was left on the left-anchored rule on
both sides (#257): a difference here would be a difference in every colour
metric, and that is not a comparison a band can carry.

## Where this lives in the code

Measurement is `packages/export/src/craft.ts` — it belongs with export because
export owns the composition it reads. The command is
`packages/cli/src/commands/measure.ts`, and pack-contributed bands come through
the same discovery seam every other pack contribution uses.

The plan-level grade is `packages/export/src/plan.ts`, beside it and for the same
reason: it has to reach the same resolvers and the same run rule. The two share
`classifyPageRows` and `pageGeometryMetrics`, so the run rule and the five
geometry figures have one definition, and `measureTransitionMix`, so the mix does
too. The command is `packages/cli/src/commands/plan.ts`.
