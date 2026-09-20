# Toony Architecture

Status: Founding draft

## Core Thesis

Toony is cut-first, transition-first, and lettering-first. The canonical object
is the episode reading sequence, not markdown.

```yaml
sequence:
  - type: cut
    id: cut-001
  - type: transition
    id: tr-001
  - type: cut
    id: cut-002
```

Markdown can be generated as a support artifact for export targets, but it is
not the source of truth for webtoon production.

## Local-First Model

Projects are ordinary folders that agents and humans can inspect, edit, validate,
and export without a server account.

## Language

The default project language is English, but language is project-level
configurable.

```json
{
  "defaultLanguage": "en",
  "supportedLanguages": ["en", "ko", "ja"],
  "dialogueLanguage": "en",
  "promptLanguage": "en"
}
```

## Provider-Neutral Image Workflow

Toony core must not make one provider's policy or capability limits the product
boundary. It must support constrained cloud models, hosted cloud image APIs,
local or remote ComfyUI, custom providers, manual import, and agent-produced
image files.

Toony is not an image-generation model. It coordinates project structure,
prompts, assets, validation, lettering, and export.

## Validation is a precondition for output

Reading a project returns its validation report alongside its records. Every
command that turns a project into something — art, an export, a measurement —
**refuses to run when that report is not clean**, prints the same report
`toony validate` prints, and exits 1 having produced nothing. `toony validate`
and `toony lint` report; `toony studio` opens a broken project with a note,
because the studio is where a project gets fixed.

There is no flag to override the refusal. Two reasons:

- **Incomplete is not invalid.** A cut with no image, no prompt, and no
  lettering validates. That is why `toony validate --require-images` is opt-in:
  `image: null` is a normal state mid-production. So the gate does not fire on
  work in progress — it fires when a record is malformed, and the report names
  the field and the path.
- **One rule beats one rule with an exception.** `toony generate` is the command
  where an override is most tempting, because generation is the slow middle of
  the authoring loop and an author fixing one broken overlay would rather not be
  blocked. But its inputs — the prompt, the character lockstrings, the palette,
  the panel shape — are all read out of records the command does not otherwise
  check, and the run then writes art back into the project. An override flag
  would buy back the exact behaviour this rule exists to remove, and would live
  in a shell alias forever after.

Before this rule, `toony generate` was the one loader that discarded the report:
a project `toony validate` rejected still generated, and the run exited 0. The
author found out at export or lint, after the cost.

## Export Targets

Platform export:

- ordered JPG or PNG files
- configurable width
- compression options

Stitched export:

- one long JPG or PNG
- preserves cuts, gutters, transitions, and lettering

PlotLink-ready export:

- WebP images
- max 20 images per episode
- max 1MB per image
- reading order preserved
- generated markdown between 500 and 10,000 characters
- manifest included

Toony prepares PlotLink-ready content only. It does not upload or publish.

## Packs

Content can be contributed from outside the repository by a **pack**: a local
folder that adds a named ComfyUI workflow, a genre scaffold, an export preset, or
a craft band. The core owns registries; packs contribute entries; consumers read
the merged registry. Extending Toony's content therefore never requires a fork.

A pack is DATA — a JSON manifest plus the JSON files it names. It cannot carry
code, reach the network, add an export engine, or redefine a built-in. With no
packs installed the core behaves exactly as it does without the seam.

`toony packs` is the operator surface over that seam: it lists what is installed
and which root each pack came from, copies a local pack directory into the right
root, removes one, and reports why a pack that is present is not loading.
Installing is a local copy, so the seam gains a command without gaining a
network.

The format is documented in [PACK_FORMAT.md](./PACK_FORMAT.md).

## Craft measurement

A pack's own output can be graded rather than eyeballed. `toony measure` composes
an episode exactly as the stitched export does and reads the page back as craft
signals — the geometry and colour of the composed page, plus the transition
vocabulary read off the episode's declared records — so a pack is finished when
its output lands inside a target band. The measurement is provider-free and
deterministic, and language-dependent craft (bubble size, line count, text
density) is deliberately left to the lints that run on our own content.
`CRAFT_MEASURE.md` carries the signal list; this paragraph does not, because a
list in prose goes stale the next time one is added. See
[CRAFT_MEASURE.md](./CRAFT_MEASURE.md).
