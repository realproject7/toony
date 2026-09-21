# Project Format

Status: Founding draft

```txt
my-webtoon/
  webtoon.json
  story-bible.md
  style-guide.md
  episodes/
    ep-001/
      episode.yaml
      cuts.yaml
      transitions.yaml
      lettering.json
      review.md
      assets/
        clean/
        final/
      exports/
        plotlink/
        platform/
        stitched/
      logs/
  assets/
  logs/
```

`story-bible.md` carries authored premise, cast and world context into image
generation. An absent, blank or untouched scaffold has no effect. The generator
reads it once per invocation and composes it with the scene, character lockstrings
and palette. `--prompt` overrides the base scene text; the bible remains context.
Stored cut prompts stay as authored so repeated generation never accumulates
context. Other bible read errors stop the run before a provider is called.

The character registry is `webtoon.json`'s `characters` array, edited by agents or
CLI workflows. New scaffolds do not create an unused `characters/` folder; old
folders remain untouched. `style-guide.md` is unchanged by this composition path.

## `webtoon.json`

```json
{
  "schemaVersion": 1,
  "projectId": "my-webtoon",
  "title": "My Webtoon",
  "referenceWidth": 800,
  "gutterBandWidth": 0.18,
  "languages": {
    "defaultLanguage": "en",
    "supportedLanguages": ["en"],
    "dialogueLanguage": "en",
    "promptLanguage": "en"
  },
  "imageProviders": {
    "defaultProvider": "manual",
    "providers": []
  }
}
```

`referenceWidth` is the reading column, in px, the project's vertical
measurements are written against. A transition's `gutterHeight` is a length on
that column, and an export at any other width scales it by the ratio, so the
episode reads the same at every resolution. Optional: a project without it
declares the 800px standard canvas the spacing vocabulary is calibrated to.

`gutterBandWidth` is how much of the cut's width the strip a `placement: gutter`
bubble sits in takes — a fraction between `0.05` and `0.5`. The studio preview,
`toony export`, and `toony lint` all read this one field, so what is read is what
is exported. Optional: a project without it uses `0.18`, the strip the feature
has always had. `toony init --genre <id>` writes the value a pack's genre
declares (see [PACK_FORMAT.md](PACK_FORMAT.md)); after that the number belongs to
the project and can be edited here. Changing it moves the bubbles in the strip
AND the artwork: the art rect is whatever the strip leaves, so a wider strip
means a narrower art layer, and anything sized from the art — a full-width
`impact_band` SFX above all — moves with it. An `in_panel` bubble's own box is
unaffected, since it is still mapped over the whole canvas.
[PACK_FORMAT.md](PACK_FORMAT.md#what-changed-for-gutter-bubbles-and-what-did-not)
describes what a gutter bubble renders as differently than it did before this
field existed.

## Recorded render inputs

A cut records what produced its current image, so the render can be repeated:

```yaml
- id: cut-004
  image:
    clean: episodes/ep-001/assets/clean/cut-004.png
    final: null
  imagePrompt: a hero on a rooftop, webtoon style
  negativePrompt: lowres
  imageSeed: 91723
  imageWorkflow: high-detail
```

`toony generate` writes all four after a successful render and reads each one
back when the run does not pass the matching flag, so re-running a cut with no
flags at all returns the image the operator accepted instead of rolling a new
seed. An explicit flag still wins for the run it is given on, and what that run
produced is what the cut then holds.

`imageWorkflow` is a workflow NAME (see [PACK_FORMAT.md](PACK_FORMAT.md)). A
workflow reached through local runtime config has no name to record — that run
reproduces through the same local config, and a path on the operator's machine
does not belong in a project file.

`imageSeed` and `imageWorkflow` are optional and absent until something is
generated: a cut that has never been generated carries neither, and a project
written before they existed loads, renders and exports exactly as it did.

**The record describes the cut's `clean` plate.** A cut carries one prompt and
one seed but two images, so one record cannot describe both: a `--slot final`
render neither writes it nor reads it back, and a final pass is regenerated the
way it always was — from `imagePrompt` and a fresh seed unless the run pins one.

The same inputs are appended to the episode's `logs/ingest.json` entry for the
asset, for BOTH slots, and there the prompt is kept twice: `prompt` is the one
that was SUBMITTED, with the character lockstrings and the palette clause
composed in, and `basePrompt` is the one the run was given, which is the value
`--prompt` takes. The entries are
per asset path, so that is where a final pass's inputs live, and any panel can
answer what produced it. A manually imported asset records no render inputs,
having none.

The size is not recorded on the cut: a cut's shape belongs to `panelAspect`, and
re-rendering at export resolution is a thing to do. The size a run submitted is
in the log, and `toony generate` uses it to refuse a run that would replace an
image rather than repeat it — see
[ARCHITECTURE.md](ARCHITECTURE.md#what-a-render-records).

## Canonical Episode Sequence

Cuts and transitions must appear in reader order.

```yaml
schemaVersion: 1
id: ep-001
title: Episode 1
sequence:
  - type: cut
    id: cut-001
  - type: transition
    id: tr-001
  - type: cut
    id: cut-002
```
