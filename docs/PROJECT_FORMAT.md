# Project Format

Status: Founding draft

```txt
my-webtoon/
  webtoon.json
  story-bible.md
  style-guide.md
  characters/
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
