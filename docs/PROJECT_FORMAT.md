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

The character registry is `webtoon.json`'s `characters` array, edited by agents,
CLI workflows or Studio. Each entry is `{ id, name, lockstring }` and may carry
`references`: project-relative image paths under `characters/<id>/`, in
preference order (#327). A reference sheet is a file the person put there or
accepted from a render; Toony never sources one. `toony generate` hands the first
sheet of the first character a cut names to a workflow that declares a reference
input, and records the sheet's sha256 with the render in the episode's ingest
log. A workflow that declares none ignores the sheets, and the request it sends
is unchanged. Whether a sheet is on disk and decodes is a lint check
(`character/reference-unreadable`), so a registry may name a sheet before it is
drawn. New scaffolds do not create an unused `characters/` folder; old
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

Two optional fields select an installed pack's style data by id (#334, #335):
`letteringTheme` names a pack lettering theme, applied where a bubble is created
and on request in Studio; `styleLexicon` names a pack style lexicon, composed
into every prompt at generation. Whether an installed pack provides the id is
the consumer's question: a missing theme is said and the defaults stand, a
missing lexicon refuses generation. See `PACK_FORMAT.md`.

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

`imageFraming` is optional: `scene` (also the absent default) composes character
identity descriptions; `detail` keeps a hands/body-part/object insert focused by
omitting full-character descriptions and automatic character-reference attachment.
Set it through `toony generate --framing scene|detail` or the corresponding
`produce run` flag. It is recorded in the ingest log as `renderInputs.framing`
and written back for clean renders. It does not change existing image pixels,
cut display geometry, or lettering. Detail prompts must supply their own visible
identity cues. This is a framing instruction, not a regional-conditioning guarantee.

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

## Planning artifacts

A project may carry two authored files: one production brief for the project and
one script per episode. Both are optional. A project without them loads,
validates, scaffolds, exports and round-trips exactly as it always did, and
`toony init` does not create them — the folder appears only when one of them is
written.

```txt
my-webtoon/
  script/
    brief.json
    episodes/
      ep-001.json
```

Nothing applies a script on its own. `toony draft compile` reads a script and
writes a draft under `.toony/drafts/`; `toony draft apply` is the separate step
that writes project data, and it refuses on any conflict. Writing a script
changes no existing project file.

**They are not the episode plan.** `toony plan --spec <file>` grades an episode
plan, which decides how tall a page is. These files decide nothing about the
page: they carry no panel aspect and no gutter height. A cut's shape stays on
its own `panelAspect`, and `toony plan --episode <id>` grades the real cuts once
they exist.

### `script/brief.json`

What the work is and what it is for.

```json
{
  "briefFormat": 1,
  "intent": "A quiet harbour story about a debt nobody wrote down.",
  "audience": "Adult readers who want a slow burn.",
  "world": "A working harbour town, late autumn.",
  "storyGoals": ["Make the debt feel physical."],
  "contentConstraints": ["No on-page violence."],
  "cast": [
    { "characterId": "mira", "role": "The one who owes.", "continuity": "Never removes her coat." }
  ],
  "revisionPolicy": "Revise a goal only with a named reason.",
  "planningProfile": {
    "geometry": "Tall cuts at the harbour, square cuts indoors.",
    "transitions": "Gutters between beats, one scene break at the turn.",
    "lettering": "Narration in the gutter, dialogue in panel."
  }
}
```

`briefFormat`, `intent`, `audience`, `world` and `storyGoals` are required; the
rest are optional. `cast` keys story-level notes to characters that are already
in `webtoon.json`'s registry. It mints no second identity and carries no
lockstring: the registry says who a character is, and the brief says what the
character is for.

The brief carries no episode length. Length belongs to the episode that has it.

### `script/episodes/<episode-id>.json`

What one episode does, beat by beat and cut by cut.

```json
{
  "scriptFormat": 1,
  "episodeId": "ep-001",
  "briefRevision": "8fd7b10ccd557752983acfdf4d50a56d0688e35dcbc1905af1befeb8d4da9b89",
  "beats": [
    {
      "id": "beat-001",
      "purpose": "Establish the harbour and the debt.",
      "goals": [{ "characterId": "mira", "goal": "Get through the morning unseen." }],
      "cuts": [
        {
          "id": "sc-001",
          "intent": "Open on the thing the episode is about.",
          "scene": "The harbour before dawn, nets still wet.",
          "characters": ["mira"],
          "shotType": "establishing_wide",
          "palette": "#9fb4c7",
          "dialogue": [
            { "speaker": null, "text": "The tide keeps its own books." },
            { "speaker": "mira", "text": "Not today.", "kind": "whisper" }
          ],
          "letteringIntent": "One narration box, low in the frame.",
          "transitionAfter": { "type": "scene-break", "gutterHeight": 120, "text": "Noon" }
        }
      ]
    }
  ]
}
```

`title`, `shotType`, `palette`, `transitionAfter` and a line's `kind` are
optional and were added for the compiler (#312). `continuity` is optional too
(#329): `{ "previousEpisodeId": "ep-001", "startsFrom": "Mira has not paid." }`
says what the episode continues from, in the author's words. The read reports
`script.previous-episode-missing`, a warning, when the named episode has neither
an episode directory nor a script yet. The compiler carries the hand-off onto
the draft, with whether the previous episode exists, so the report and Studio
show it; it changes no record. `shotType` and `palette` take
the values a `Cut` takes. `transitionAfter` is the one place a script states a
transition: which device separates two moments is a storytelling decision, so
it belongs here. Its `type` is a `Transition` type, its `gutterHeight` is
optional and in px on the reference column, and its `text` is for the kinds that
draw one. The last cut of an episode cannot carry one. A line's `kind` is a
bubble kind; absent, a spoken line letters as `speech` and an unattributed one
as `narration`.

The filename and `episodeId` must name the same episode, so a copied or renamed
file cannot silently describe a different one. The id need not name an episode
that exists yet. Beats and cuts read in array order; there is no separate order
field. A cut id is unique within its script and is not required to match a real
cut id. `speaker` is a character id, or `null` for narration. A character id
that resolves in neither `webtoon.json`'s registry nor the brief cast is
reported when the script is read, the way an unresolved cut character ref is
reported rather than refused: it is a warning, and the script stays valid, exactly
as a project whose cut names an unresolved character stays valid and gets a
`character/unknown-ref` lint warning. A reader tells three states apart. A
malformed file, or one whose filename and recorded id disagree, reads with
`validation.valid` false and no script. A sound file with an unresolved reference
reads valid, with the reference in `warnings`. A sound file written against a
brief that has since changed reads valid, with the brief's state in `warnings`.

Two episodes of one project are independent. They may run to different lengths
and name different casts, and writing one never reads or rewrites another.

### `.toony/drafts/<episode-id>.json`

What `toony draft compile` writes, and `toony draft apply` reads: one complete
episode compiled from the episode script, kept outside the project data until it
is applied.

```json
{
  "draftFormat": 1,
  "episodeId": "ep-001",
  "scriptRevision": "3c5e...",
  "briefRevision": "8fd7...",
  "bundle": { "episode": {}, "cuts": [], "transitions": [], "lettering": [] },
  "defaults": [
    { "kind": "transition", "id": "tr-sc-001", "field": "gutterHeight", "value": 48 }
  ],
  "reviewedAgainst": {
    "webtoon": "9b1c...",
    "episode": null,
    "cuts": null,
    "transitions": null,
    "lettering": null
  }
}
```

`bundle` is a schema-valid episode bundle. `defaults` names every required field
the compiler filled from a default rather than from the script, with the record
it was written on; the compiler invents nothing silently. `reviewedAgainst` is
the sha256 of each project file an apply would read or replace, as they were when
the draft was last reported by `compile` or `show`. Apply refuses when they no
longer match, so a draft reviewed against one project state never lands on
another.

The folder is `.toony/`, which is project local and gitignored, and not
`episodes/`: the project loader walks only `episodes/`, so a draft is invisible
to every read path until it is applied. A project with a draft, or with a
malformed draft, loads, validates, lints, plans, measures, generates and exports
exactly as the same project without one. Nothing applies a draft on its own.

Compiled ids are the script's own: a script cut `sc-001` becomes cut `sc-001`,
its transition `tr-sc-001`, its lines `ov-sc-001-1` and so on. Recompiling the
same script gives the same records, so a draft applied once and compiled again
reads as unchanged.

### `episodes/<episode-id>/logs/produce.json`

What `toony produce run` records about its own runs, beside the ingest log. One
array, one entry per run, each entry replaced by its finished form when the run
ends:

```json
[
  {
    "run": 1,
    "state": "finished",
    "kind": "revision",
    "episodeId": "ep-001",
    "targetSet": "9f3a1c0e5b7d2a44",
    "targets": ["cut-003", "cut-004"],
    "selectors": { "cuts": ["cut-003", "cut-004"], "reviewStatus": null },
    "changed": ["--seed fresh"],
    "reason": "the first take cropped the face",
    "draft": { "scriptRevision": "3c5e...", "briefRevision": "8fd7..." },
    "disclosure": { "withImage": 2, "withRecordedInputs": 2, "willResetReview": ["cut-003 (final)"] },
    "outcomes": { "cut-003": "generated", "cut-004": "failed" },
    "rewrotePrompt": [],
    "exit": 1,
    "stopped": null
  }
]
```

It is a record of the controller's decisions, not of what produced an image:
the four cut render fields and the ingest log stay the single source for that,
and this file never duplicates them. `targetSet` is the first sixteen hex
characters of the sha256 over the episode id and the sorted target ids, and is
what `--accept` names. `draft` is the revision pair of the episode's draft when
one is present. The log carries no path, endpoint, account or model identifier.

### Revisions

A revision's durable name is the sha256 of the bytes the file is persisted as,
written as 64 lowercase hex characters.
A byte-identical rewrite keeps the name; any change of content changes it. A
script records the brief revision it was written against.

The brief can be revised at any time, including once scripts exist. Editing it
never rewrites a script and never makes one unreadable: every script still
reads, and each one reports that its recorded brief revision no longer matches.
The same holds when the brief is removed, and when it is left in a state nothing
can read: the script still reads, and the unusable input is reported against the
field that records it.

Two ids that differ only by case, or only by Unicode normalization form, fold to
one name on a filesystem that folds either one. A script whose id collides that
way with a script already on disk is refused before anything is written, and the
episode ids in `episodes/<id>/episode.yaml`, which are the directory names as
well, carry the same guarantee: validation reports two episode ids that fold
together, naming both. Both guards compare one fold, and each compares it itself
rather than leaving it to the filesystem, so the answer is the same on a
filesystem that folds and on one that does not, and an id pair one of them
refuses is an id pair the other refuses.

That fold is normalization to NFC followed by lowercasing, and it is narrower
than the table a case-insensitive filesystem folds by. Lowercasing is not
Unicode case folding: an APFS volume folds `ep-ſ` onto `ep-s`, `ep-ß` onto
`ep-ss`, `ep-ﬁ` onto `ep-fi`, `ep-ς` onto `ep-σ` and `ep-Σ` onto `ep-ς`, and
these guards hold every one of those pairs distinct. Those are the pairs that
have been checked against such a volume, not the whole of its table, so the gap
is at least that wide.

The gap is left open deliberately: it refuses nothing, and no rule the platform
offers closes it. Compatibility normalization merges `ep-ſ` with `ep-s` and
`ep-ﬁ` with `ep-fi` and leaves the other three apart. A locale collator at
accent sensitivity merges `ep-ﬁ` with `ep-fi` and both sigma pairs and leaves
the other two apart. Each also merges ids the filesystem keeps apart, `ep-²`
with `ep-2`, so adopting either would close part of this gap by refusing work
an author has no way to rephrase.

### The read rule this format depends on

Nothing else in a project reads this folder, and that is a property of how the
project is read rather than a coincidence. The project loader reads named paths
only — `webtoon.json` and each file under `episodes/<id>/` — and the only walk of
a project directory walks `episodes/`. One level up, the project validator reads
exactly two fields of the object it is handed, `webtoon` and `episodes`; it does
not enumerate keys and does not reject unknown ones. That is what lets the
on-disk format grow without touching either.

If the project loader is ever made to walk the project root, or the project
validator is ever made strict about unknown keys, that is a breaking change to
this contract and has to be handled as one.
