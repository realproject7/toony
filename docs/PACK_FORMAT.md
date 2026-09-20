# Pack Format

A **pack** is a local folder that adds content to Toony without changing Toony.
It can contribute four things:

| Kind | What it adds | How it is used |
|---|---|---|
| Named workflow | A ComfyUI workflow graph under a name | `toony generate --workflow <name> …` |
| Genre scaffold | A starter episode `toony init` seeds | `toony init <name> --genre <id>` |
| Export preset | A named engine + render options | `toony export <id> --episode <id>` |
| Craft band | The measured target its output should hit | `toony measure --against <id>` |

A genre scaffold also carries the craft settings the genre needs, which
`toony init` writes into the new project. See
[the gutter strip](#the-gutter-strip-a-genre-letters-in).

A working example lives at
[`packages/packs/examples/example-pack`](../packages/packs/examples/example-pack).
Copy it to start your own.

## A pack is data, never code

This is the format's central rule, and it is enforced, not just documented.

There is no manifest field for a module, a script, a command, or a hook, and
every key at every level is checked against an allowlist — an unknown key is a
**rejection**, not something quietly ignored. So a pack cannot execute anything
when it is installed, discovered, or used.

That matters because Toony is local-first and a ComfyUI workflow is already an
executable graph the operator chose to run on their own machine. One such surface
is a considered trade; a second one that ships arbitrary JavaScript with
downloaded content is not.

Concretely, a pack cannot:

- name a JavaScript module, a binary, or a shell command,
- reference a file outside its own folder (no absolute paths, no `..`, no URLs),
- reference anything but a `.json` data file,
- reach the network — pack resolution reads local files and nothing else,
- add a new export engine (a preset selects one of the three Toony ships),
- redefine a built-in genre or export target (the core always wins).

## Layout

```txt
my-pack/
  toony-pack.json          the manifest (required)
  workflows/
    high-detail.workflow.json
  genres/
    noir.json
  bands/
    noir.json
```

File names are up to you; the manifest says which file is what.

## Where packs are found

Toony looks in these places, in order. The first pack to claim a name keeps it.

1. every directory listed in the `TOONY_PACKS` environment variable
   (path-separated, like `PATH`) — each is a folder that *holds* pack folders;
2. `<project>/.toony/packs`;
3. `<workspace>/.toony/packs`, the folder your project sits in — so a pack
   installed once for a workspace works from inside every project in it.

With no packs installed, Toony behaves exactly as it does without this seam.

## Installing a pack

A pack is a folder, and installing one is copying that folder into a pack root.
The CLI does it, so you never have to know which root wins:

```sh
toony packs install path/to/my-pack              # into <project>/.toony/packs
toony packs install path/to/my-pack --workspace  # into <workspace>/.toony/packs
toony packs list                                 # what is installed, and where from
toony packs remove my-pack                       # delete an installed pack
```

`install` copies a directory that is already on your machine. Nothing is
downloaded and there is no registry; how the folder got there is your business.
It refuses a directory that is not a valid pack, reporting the same codes
discovery would have, so a folder that could never load is not copied into place
first.

`install` writes only to the project and workspace roots, so `remove` deletes
only from those two. A `TOONY_PACKS` directory is a collection you maintain, and
these commands never delete inside one.

`toony packs list` names, for every installed pack, the root it was found in and
what it contributes after the merge. A workflow name or genre id an earlier pack
already claimed is missing from that list rather than quietly counted.

## `toony-pack.json`

```json
{
  "packFormat": 1,
  "id": "example-pack",
  "name": "Toony Example Pack",
  "description": "One of each kind of contribution.",
  "workflows": [
    { "name": "high-detail", "file": "workflows/high-detail.workflow.json" }
  ],
  "genres": [
    { "id": "noir", "title": "Noir", "file": "genres/noir.json", "gutterBandWidth": 0.24 }
  ],
  "exportPresets": [
    {
      "id": "webtoon-tall",
      "target": "platform",
      "options": { "width": 1600, "format": "jpeg", "quality": 88 }
    }
  ],
  "craftBands": [
    { "id": "noir-band", "file": "bands/noir.json" }
  ]
}
```

| Field | Required | Rule |
|---|---|---|
| `packFormat` | yes | Must be `1`. |
| `id` | yes | A safe single path segment. Namespaces the pack in messages. |
| `name` | yes | Human-readable pack name. |
| `description` | no | One line about the pack. |
| `workflows` | no | Named workflow graphs. Absent means none. |
| `genres` | no | Genre scaffolds. Absent means none. |
| `exportPresets` | no | Export presets. Absent means none. |
| `craftBands` | no | Craft bands. Absent means none. |

Every `file` is a path **inside the pack folder** and must end in `.json`.

### `workflows[]`

| Field | Rule |
|---|---|
| `name` | The name `--workflow` selects. Unique within the pack. |
| `file` | A ComfyUI **API-format** workflow graph: a JSON object keyed by node id, each node `{ "class_type": …, "inputs": … }`. |

Toony writes the prompt, negative prompt, and seed into the graph per request,
using the injection map (node ids `6`, `7`, `5`, `5`, `3` by default — see
`packages/providers/src/comfyui-workflow.ts`). Keep those node ids, or the map
has nothing to write to. Whatever those inputs hold in your file is overwritten
on every generation; everything else — checkpoint, sampler, steps, CFG,
scheduler, LoRAs, extra nodes — is yours and is what the pack is really for.

**Size is different: your latent is the default.** Toony writes width and height
only when something asks for a size — a `--width`/`--height` flag, or a cut that
declares a [panel shape](#panel-shape-panelaspect). Otherwise your
`EmptyLatentImage` stands untouched, so the column and the default panel height
your pack draws at are the pack's decision, not Toony's.

### `genres[]`

| Field | Rule |
|---|---|
| `id` | The id `--genre` selects. Unique within the pack. |
| `title` | Human-readable genre name. |
| `file` | A complete **episode bundle**. |
| `gutterBandWidth` | Optional. The gutter strip this genre letters in, as a fraction of the cut width, between `0.05` and `0.5`. Absent means the default `0.18`. |

#### The gutter strip a genre letters in

A `placement: gutter` bubble sits in a strip reserved beside the artwork, and
`gutterBandWidth` is how much of the column that strip takes. It is the one
craft number a genre can be *defined* by: a thriller runs two or three gutter
intrusions per screen where a slice-of-life runs half of one, so how much room
that dialogue gets is part of what the pack is selling — and a genre whose
dialogue is set in a script that reads narrow needs less of it than one that
does not.

It is a number, like everything else here. `toony init --genre <id>` writes it
into the new project's `webtoon.json`, and from then on the **project** owns it:
the studio preview, `toony export`, and `toony lint` all read it there. Nothing
looks at a pack again to render, so an episode reads the same whether or not the
pack that started it is still installed, and an author can change the strip
afterwards by editing the field.

##### What changed for gutter bubbles, and what did not

A gutter bubble's auto-fit used to stop shrinking at a size derived from the
cut's **height**, while the strip is cut from its **width**. On a tall cut that
stop was above anything the strip could letter, so the bubble reported overflow
whatever you did to its box, and the only way out was to pin a `fontSize`. The
stop now comes off the width instead, capped at the default strip.

What moves is **gutter bubbles that were reporting overflow**, and only those.
Two shapes of it:

- a bubble whose text did not fit at any size now fits, at a smaller one — the
  bug this exists to fix;
- a bubble whose text still does not fit is now drawn at the new stop, which is
  much smaller than the old one. On an 800x1600 cut with the default strip that
  is 8.64px where it was 35.20px; on 1200x1275, 12.96px where it was 28.05px.
  It is still flagged, so `toony lint` still tells you to fix it, but the
  best-effort drawing under the warning is smaller than it used to be.

A bubble that already fitted keeps the exact size it had: the auto-fit returns
the largest size that fits and reads the stop only as a stop, so lowering the
stop can only add candidates below a size that was already rejected. Nothing
outside a gutter strip moves at all — measured over 210 composed cuts, 45
differed and every one of them was a gutter bubble.

Declaring a **different** strip width is a separate thing, and it moves more than
the bubbles in the strip: the artwork rect is what is left over, so widening the
strip narrows the art, and anything sized from the art moves with it — a
full-width `impact_band` SFX most visibly. On an 800px cut, going from `0.18` to
`0.40` takes the artwork from 656px to 480px.

A wider strip buys room for a longer line, not larger minimum text: the stop
does not climb as the strip grows. Below the default strip it scales down with
it. Two caveats worth knowing before you size a strip:

- **The stop is not a promise that any line fits.** It is set so a strip-filling
  bubble with squared corners holds a line of the ~24 characters the craft check
  allows. A rounded balloon's corner arcs take a further bite out of its first
  and last lines, growing with the corner radius, so in a default rounded
  balloon the measured worst case is nearer 16. If a line still will not fit,
  shorten it, square the corners with `cornerRadius: 0`, give the box more
  height, or pin a `fontSize`.
- **A single unbreakable token can behave oddly across widths.** The corner
  radius grows with the box and so with the strip, while the vertical padding
  the arcs are measured from does not, so there is a window where a token that
  fits a narrower strip stops fitting and then fits again above it. Sweeping
  realistic cut sizes and box heights, that window ran from about `0.06` to
  about `0.25` — it can start well below the default strip and continue above
  it — and every affected case fitted again by `0.30`. It takes a token of
  roughly 16 to 24 glyphs; shorter ones always fit and longer ones never did.
  Wrappable prose does not hit this at all; a long unhyphenated word or an
  SFX-like run of glyphs can.

A scaffold file is one episode's records:

```json
{
  "episode": {
    "schemaVersion": 1,
    "id": "ep-001",
    "title": "Episode 1",
    "sequence": [
      { "type": "cut", "id": "cut-001" },
      { "type": "transition", "id": "tr-001" },
      { "type": "cut", "id": "cut-002" }
    ]
  },
  "cuts": [ … ],
  "transitions": [ … ],
  "lettering": [ … ]
}
```

The record shapes are the ones in [`PROJECT_FORMAT.md`](./PROJECT_FORMAT.md), and
a scaffold is checked by the **same validators a project goes through** — so if
`toony validate` would reject it, the pack is rejected first, with the same error
codes. Two rules the validators enforce that are easy to miss: a transition must
sit between two cuts (never first, last, or adjacent to another), and every cut,
transition, and overlay must be referenced by the sequence.

Aim for a scaffold that also passes `toony lint`: keep at most two dialogue
bubbles per cut, vary `shotType` so no run of four identical shots forms, give
attributed bubbles a `speaker`, and use wide, short bubble boxes so short lines
never overflow. See [`TOONY-PLANNING-HEURISTICS.md`](./TOONY-PLANNING-HEURISTICS.md).

#### Panel shape (`panelAspect`)

A cut may declare its own panel shape, and that is how a scaffold paces. Panel
height is what a vertical-scroll comic controls time with: a tall panel is a held
moment, and a run of short ones is a fast exchange. A scaffold whose cuts are all
one height cannot do either.

```json
{ "id": "cut-003", "image": null, "imagePrompt": "…", "negativePrompt": "",
  "shotType": "close_up", "panelAspect": 0.62 }
```

`panelAspect` is the cut's **height as a multiple of its own width**, between 0.1
and 10. Those are authoring bounds, not runnable ones: at an 832px column a
`panelAspect` of 10 is an 8320px latent most local setups cannot sample, and the
tallest panel in the worked example is 3.45. Width-multiples, not pixels, for two
reasons:

- it is the unit a craft band grades panel height in (`panelHeightMedian`, and
  `panelHeightSpread` for how much the heights vary), so what a scaffold declares
  and what `toony measure` reads back are the same number;
- the width belongs to the column the episode is read at, never to the cut, so a
  px height would be right at one export width and wrong at every other.

It is not metadata. `toony generate` resolves it against the column the workflow's
own latent declares — `panelAspect` 0.62 on an 832px latent generates at
832×512, snapped to ComfyUI's 8px latent grid — and the composed page takes each
panel's height from the image it generated. So declared height and rendered
height are one number for art made under the declaration, and a run reports the
size it resolved:

```txt
generated episodes/ep-001/assets/clean/cut-003.png for cut cut-003 (clean) at 832x512 in ep-001 — …
```

`shotType` and `panelAspect` are independent on purpose. The pilot pack declares
1.43, 2.1 and 2.6 on three `medium` cuts and 0.44, 0.58 and 0.74 on three
`close_up` cuts, because one shot word spans 1.8x of height in the work it was
measured from. There is no table from one to the other, here or in the code.

Rules worth knowing before you author a whole episode of them:

- **A cut that declares nothing is untouched.** No size is injected for it at
  all, so your workflow's own latent stands, exactly as before this field existed.
- **The shape binds when the art is made.** A cut that already carries art
  composes at that art's aspect, whatever it declares: nothing re-cuts an image
  to match a declaration made after it. Re-generate the cut
  (`toony generate --cut <id>`) to bind the new shape. Until then the page is the
  page, and the declaration describes the next render of it — and `toony lint`
  **blocks on it**, with a `cut/panel-aspect-mismatch` warning naming both
  shapes. Warnings are blocking (exit 1, `"clean": false`), so an episode whose
  declaration and art disagree does not pass until you re-generate the cut or
  drop the declaration. Finding out no longer means measuring an export.
- **A declared cut's BUBBLES are measured at the shape it declares.** Before its
  art exists — which is every cut in a scaffold — the overflow check
  (`lettering/overflow`) stages the cut at its `panelAspect` rather than at a
  fixed portrait canvas, and the export raster and the studio reader stage it
  there too. Bubble text that does not fit the panel your pack asks for is a lint
  finding without a GPU round trip. A cut declaring nothing is staged exactly as
  before.

  The `craft/` checks are the exception, deliberately: line-wrap, line count and
  the rest count wrapped lines on ONE fixed reference canvas for every cut in
  every project (#154), so that a craft finding is reproducible and not a
  property of one cut's shape. They read a declared 0.3 strip exactly as they
  read a portrait cut.
- **`--width` re-columns it; `--height` overrides it.** A pinned width becomes
  the column the shape is a multiple of. A pinned height replaces the shape for
  that run, and the run says on stderr which cuts it overrode. A column off the
  8px latent grid is passed through as given while the height is snapped, so the
  rendered aspect can differ from the declared one by up to 7px of height.
- **A shape that cannot be resolved fails the run before anything is generated,**
  rather than falling back to the latent and quietly removing the pack's pacing.
  A value outside the bounds above makes the project invalid, so `toony generate`
  refuses the whole run (exit 1) and prints the report `toony validate` prints —
  which names the field by its path, `episodes[0].cuts[2].panelAspect`, the cut's
  position in `cuts.yaml` rather than its id — followed by a line naming the cut
  id and the value as authored, so a quoted `"1.4"` reads as the string it is. A
  workflow whose latent declares no width exits 2 and names the cut by id.
- **A node mapping that points at a missing INPUT is not an error.** Only a
  missing node, or a node with no `inputs` object, fails; an input key the graph
  does not have is created with the injected value. So a mapping that names the
  right node and the wrong input silently adds a field the sampler ignores, and
  the run generates at the workflow's own size. Point the mapping at the input
  the graph actually declares.

### `exportPresets[]`

| Field | Rule |
|---|---|
| `id` | The id `toony export <id>` selects. Unique within the pack. |
| `target` | The engine that runs: `platform`, `stitched`, or `plotlink`. |
| `options.width` | Optional. Render width in px, 1–100000. |
| `options.format` | Optional. `png` or `jpeg`. Ignored by `plotlink` (always WebP). |
| `options.quality` | Optional. Lossy quality 0–100. |

An option you omit keeps the engine's own default. An explicit CLI flag beats
whatever the preset pins:

```sh
toony export webtoon-tall --episode ep-001              # the preset's width
toony export webtoon-tall --episode ep-001 --width 900  # 900 wins
```

### `craftBands[]`

| Field | Rule |
|---|---|
| `id` | The id `toony measure --against <id>` selects. Unique within the pack. |
| `file` | A **band file**: the per-metric target range the pack was built to hit. |

A pack that sets craft knobs can ship the measurement it was aiming for, so its
output can be graded instead of eyeballed:

```sh
toony measure my-story --episode ep-001 --against noir-band
```

`--against` takes a band id first and a file path otherwise, so a pack's band is
named rather than located. The band file's own format — every metric, what is
deliberately not measured, and why the language split matters — is documented in
[`CRAFT_MEASURE.md`](./CRAFT_MEASURE.md).

A band can also keep a range it measured without grading it (`recorded`) and say
what its numbers were measured from (`provenance`: each studied work by neutral
label, with its episodes, capture mode, whether its column width was constant,
its language, and how much page was measured). Both are optional and neither
changes a verdict. Because a band rejects unknown keys, a band using either one
is refused outright by a toony older than the field, so a pack that ships one
should state the minimum toony version it needs. Both are documented in
[`CRAFT_MEASURE.md`](./CRAFT_MEASURE.md#band-files).

A band can further declare the **transition vocabulary** of the work it was
measured from — which kinds of gap it puts between its cuts, in what proportion,
at what heights — and that one **does** decide the verdict:

```json
"transitionVocabulary": [
  { "kinds": ["gutter"], "share": { "min": 0.46, "max": 0.57 }, "height": { "min": 0.41, "max": 0.52 } },
  { "kinds": ["narration_card", "dialogue_card"], "share": { "min": 0.18, "max": 0.33 } }
]
```

It sits on the band, and not on the manifest or on a genre entry, because it is a
**grading target** measured from the same episodes of the same work as the band's
own metrics — the thing `provenance` already makes one statement about — rather
than a render knob a project edits. A genre entry's `gutterBandWidth` is the
other shape: a number `toony init` writes into the new project, which the project
then owns. Nothing consults a vocabulary to render.

**A pack selects kinds; it never adds one.** Every name in `kinds` must be one of
the core's transition types, and a name the core does not have is a rejection.
This is the same rule an export preset lives under: a preset picks one of the
built-in engines, and a vocabulary picks from the built-in kinds. The full field
reference, and what the comparison can and cannot see, are in
[`CRAFT_MEASURE.md`](./CRAFT_MEASURE.md#the-transition-vocabulary-a-band-declares).

Discovery checks the file is there and carries its path, exactly as it does for a
workflow graph; the band itself is parsed and validated by the command that
measures, so `@toony/packs` stays free of the measurement.

## When something is wrong

`toony packs doctor` is how you ask. It prints the roots that were searched in
precedence order, marking the ones that are not there yet, the packs that
loaded, and every problem grouped by the folder it is in:

```txt
packs for my-story
roots searched, first claim winning:
  1  project    /w/my-story/.toony/packs  (1 pack(s))
  2  workspace  /w/.toony/packs  (not created yet)
loaded: example-pack
problems: 1
/w/my-story/.toony/packs/my-pack
  [pack.genre.claimed] genres.noir: genre id "noir" is already provided by an
  earlier pack; rename it in this pack.
```

It exits 1 when it finds a problem and 0 when it does not, so it can gate a
build, and `--json` gives the same report as data.

A malformed pack is **skipped and reported**; it never stops the command. Every
other command prints one line per problem, naming the pack folder, the field, a
stable code, and what to fix:

```txt
pack warning [pack.unexpected-field] /w/.toony/packs/my-pack pack.main: a pack
manifest allows only "packFormat", "id", "name", "description", "workflows",
"genres", "exportPresets", "craftBands"; remove unexpected field "main". A pack
is data — it can never declare code, a module path, or a command.
```

Common codes:

| Code | Meaning |
|---|---|
| `pack.manifest-missing` | The folder has no `toony-pack.json`. |
| `pack.manifest-parse` | The manifest is not valid JSON. |
| `pack.unexpected-field` | A key that is not in the allowlist. |
| `pack.format-version` | `packFormat` is not `1`. |
| `pack.file.unsafe` | A `file` escapes the pack folder or names a URL. |
| `pack.file.extension` | A `file` is not `.json`. |
| `pack.workflow.file-missing` / `pack.genre.file-missing` / `pack.craft-band.file-missing` | A named file is not there. |
| `pack.workflow.claimed` / `pack.genre.claimed` / `pack.export-preset.claimed` / `pack.craft-band.claimed` | An earlier pack already uses that name. |
| `pack.duplicate` | Another installed pack declares the same `id`. |

A scaffold that fails validation reports the project validator's own codes
(`sequence.missing-cut`, `overlay.missing-cut`, `episode.id.unsafe`, …).

## Where this lives in the code

`@toony/packs` (`packages/packs`) owns the format: the manifest types, the
validators, and local discovery. It depends only on `@toony/schema`, and nothing
in the core depends on it — the CLI discovers packs once per command and passes
the resolved content down to the registries in `@toony/project-io` (genres),
`@toony/export` (presets), and `@toony/providers` (workflows, injected as a plain
name-to-path map so that package stays dependency-free). Registry lookups return
Promises. Craft bands travel the same way as workflows, as a name-to-path map the
measuring command reads.

`toony packs` (`packages/cli/src/commands/packs.ts`) is the surface over that:
it reports what discovery found and copies local directories in and out of the
pack roots. It adds no way to fetch one.

The seam ships in the free core and is not privileged in any way: a paid pack and
a community pack are the same thing to Toony.
