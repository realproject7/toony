# Pack Format

A **pack** is a local folder that adds content to Toony without changing Toony.
It can contribute four things:

| Kind | What it adds | How it is used |
|---|---|---|
| Named workflow | A ComfyUI workflow graph under a name | `toony generate --workflow <name> …` |
| Genre scaffold | A starter episode `toony init` seeds | `toony init <name> --genre <id>` |
| Export preset | A named engine + render options | `toony export <id> --episode <id>` |
| Craft band | The measured target its output should hit | `toony measure --against <id>` |

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

Installing a pack is copying a folder:

```sh
mkdir -p .toony/packs
cp -R path/to/my-pack .toony/packs/
```

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
    { "id": "noir", "title": "Noir", "file": "genres/noir.json" }
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

Toony writes the prompt, negative prompt, width, height, and seed into the graph
per request, using the injection map (node ids `6`, `7`, `5`, `5`, `3` by
default — see `packages/providers/src/comfyui-workflow.ts`). Keep those node ids,
or the map has nothing to write to. Whatever those inputs hold in your file is
overwritten on every generation; everything else — checkpoint, sampler, steps,
CFG, scheduler, LoRAs, extra nodes — is yours and is what the pack is really for.

### `genres[]`

| Field | Rule |
|---|---|
| `id` | The id `--genre` selects. Unique within the pack. |
| `title` | Human-readable genre name. |
| `file` | A complete **episode bundle**. |

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

Discovery checks the file is there and carries its path, exactly as it does for a
workflow graph; the band itself is parsed and validated by the command that
measures, so `@toony/packs` stays free of the measurement.

## When something is wrong

A malformed pack is **skipped and reported**; it never stops the command. Toony
prints one line per problem, naming the pack folder, the field, a stable code,
and what to fix:

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

The seam ships in the free core and is not privileged in any way: a paid pack and
a community pack are the same thing to Toony.
