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

Exports write image files and a manifest; they are never the source of truth
for webtoon production.

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

## Generation and validation

Reading a project returns its validation report alongside its records. The
commands listed below use exit 1 when refusing an invalid project. For example, a project
whose only defect is a bad `shotType` produces:

| command | exit | on an invalid project |
|---|---|---|
| `toony validate` | 1 | prints the report |
| `toony generate` | 1 | prints the report, sends nothing |
| `toony lint` | 1 | prints its findings |
| `toony export` | 1 | one line: "project does not pass validation" |
| `toony measure` | 1 | the same one line |
| `toony studio` | 0 | opens it with a note — the studio is where it gets fixed |
| `toony import-image` | 1 | prints the report, reads no source image and writes nothing |

`generate` and `import-image` share an authoring gate in
`packages/cli/src/generate-gate.ts`. Both print the validation report and the
authored values before refusing. Export and measurement require a fully valid
project, including its wiring; they keep their shorter diagnostic. IO, parse,
and usage failures remain exit 2. A completed measurement outside its requested
band also returns 1, with an out-of-band verdict rather than a validation error.

### Why authoring commands refuse rather than warning

Generation is the command that spends real time and then writes art back into
the project, and its inputs — the prompt, the character lockstrings, the
palette, the panel shape — are all read out of records it does not otherwise
check. Two failures it now prevents, both reproduced on the tree before it: a
registry character whose `lockstring` key is misspelled crashed prompt
composition with an uncaught `TypeError`, and a `--transition` run against a
project that could not be loaded at all submitted its request first and failed
afterwards.

Manual import also writes an asset and rewrites its cut or transition record.
It applies the same gate before asking its provider to read the source image,
so a malformed project receives no new files or changed records.

There is no `--force`. An override flag buys back exactly the behaviour the gate
exists to remove, and lives in a shell alias forever after.

### Why it warns instead for unwired references

"Incomplete" and "invalid" are not the same thing here, and the difference is
not only field-level. A cut with no image and no prompt validates — that is why
`toony validate --require-images` is opt-in. But a **fully written cut that is
not yet in the episode's `sequence` does not validate**, and refusing on that
makes the whole project unreachable while any one part of it is mid-edit: a new
`cut-003` appended to `cuts.yaml` blocks generating cut-003, cut-001, and every
transition, until it is sequenced.

The same is true one level up. Create `episodes/ep-002/` correctly — all four
files, right shapes, `sequence: []` — and the **finished** episode 1 becomes
unreachable, with no edit that fixes it short of writing the new episode.

So both authoring commands treat six codes as wiring rather than data. They
warn on stderr, naming what is unwired, and the run proceeds:

| code | state |
|---|---|
| `cut.orphan` | a cut record the sequence does not name yet |
| `transition.orphan` | a transition record the sequence does not name yet |
| `sequence.missing-cut` | the sequence names a cut not yet written |
| `sequence.missing-transition` | the sequence names a transition not yet written |
| `overlay.missing-cut` | a lettering overlay points at a cut that does not exist |
| `sequence.empty` | an episode nobody has sequenced anything into yet |

The first five are emitted only by the validator's reference checks, which
compare id sets — none of them inspects a record's own fields, so a project
whose only issues are these has every record intact. `sequence.empty` is
stronger still: it fires on a zero-length array, so it reads nothing at all.
Generation reads `cuts`, `transitions` and `webtoon.characters`; import locates
its target cut or transition directly. Neither requires `episode.sequence` or
`lettering` to be wired, which is where all six codes apply.

The list is by exact code, so it **fails closed**: a validation code added later
is not on it and refuses. One consequence worth knowing, chosen deliberately and
pinned by test — the other four reading-order *shape* rules are off the list, so
sequencing a transition at the very end of an episode, or two in a row, still
refuses until the next cut is sequenced. Unlike an unwritten episode, each of
those has an edit that fixes it on the spot.

Any single blocking issue refuses the whole run, even when wiring issues are
present too. The refusal prints the report `toony validate` prints, and then one
line per issue naming **the value as authored** — because `panelAspect: "1.4"`
answers "must be a number between 0.1 and 10" with a number between 0.1 and 10,
and the quotes are the entire defect. A field whose key is misspelled reads as
`absent`, which its "must be a non-empty string" message cannot say.

That line is printed only when the issue's path resolves to a single value. It
is left out rather than guessed at, because a wrong line is worse than no line:
the validator addresses an episode's sequence through the bundle
(`episodes[0].sequence`) while the loaded project keeps it at
`episodes[0].episode.sequence`, and read naively that reported a present
sequence as missing.

### What a render records

Generation is the one step in the pipeline that costs minutes and is not
deterministic, and it used to be the only one that wrote down nothing about its
own inputs. The provenance entry said what the file was — path, provider, size,
digest — and nothing about how it was made. So no render could be repeated, and
the prompt an agent converged on over a hundred panels lived in shell history.

A finished cut render now writes four fields back onto the cut — `imagePrompt`,
`negativePrompt`, `imageSeed`, `imageWorkflow` — and appends the same inputs, as
submitted, to the episode's ingest log. Each flag falls back to the recorded
value, so `toony generate --episode ep-001 --cut cut-004` with nothing else
repeats the image the operator accepted. `PROJECT_FORMAT.md` has the fields.

Three choices in that are worth knowing:

- **The seed is chosen by the command, not by the provider.** A seed rolled
  inside `produce` is gone by the time the result comes back, and a seed nobody
  recorded is a render nobody can repeat.
- **The prompt on the cut is the cut's OWN.** The character lockstrings (#92) and
  the palette clause (#207) compose on top of it on every run, so recording the
  composed string there would compound it. The composed string is what the ingest
  log keeps, because that is the string the model was given.
- **The workflow is a NAME, never a path.** Because the name lives per cut, one
  batch can span several workflows, and a run resolves one provider per distinct
  name rather than making the first cut's choice the whole run's.
- **The record describes the `clean` plate.** A cut has one prompt and one seed
  and two images. A `--slot final` render that wrote the record replaced the
  clean plate's inputs, and the next default run — no flags, `--slot clean` —
  redrew the accepted plate from the final pass's prompt and seed. So `final`
  neither writes the record nor reads it; its inputs are in the ingest log,
  whose entries are per asset path.

A style lexicon (#335) is read off `webtoon.json`'s selection and composed into
every prompt after the palette clause, with its negative base before the cut's
own negative prompt. The log records the lexicon's id and both strings as
submitted; the cut's own prompt and negative prompt stay its own. A changed
selection or changed words are named in the repeat instruction as an input no
flag can restore.

A character reference sheet (#327) is the one input that is neither on the cut
nor in a flag: it is read off the registry. The ingest log records which
character's sheet the run conditioned on and the sha256 of the bytes uploaded,
and the repeat instruction names a changed or newly attached sheet as an input
nothing can ask for, the way a changed palette is named.

Size is deliberately not recorded on the cut. A cut's shape already has a home in
`panelAspect`, and re-rendering a batch at export resolution is a thing to do,
not a thing to prevent; the size a run submitted is in the ingest log.

That leaves one gap, and the log closes it. A dimension a run does not pin takes
the workflow's own latent — which is not what produced the image on disk if that
image was rendered at another size. Everything else replays, so the run reads as
a faithful repeat while replacing the plate the operator approved. `generate`
therefore compares the size it is about to render at against the size the log
recorded for that asset, and refuses before the first request when they differ,
naming the flags that would repeat it.

The comparison is per dimension, because a run that pins one of them has said
nothing about the other: `--width 640` after a `640x960` render is checked on its
height, and is refused rather than quietly re-rendered at `640x1216`. A dimension
the run pins, or that the cut's `panelAspect` declares, is left alone.

The instruction it prints is built from the record, field by field, and names
**every input this run would not arrive at by itself** — not a list of fields
someone remembered. A repeat at the right size from a different seed, through a
different graph, or from a different prompt is not a repeat, and an operator who
follows an incomplete instruction destroys the plate they were keeping. That
list is `REPEAT_INPUTS` in the generate command, keyed on `RenderInputs` so a
field added to the record and not decided there does not compile.

Two things fall out of building it that way rather than by hand. The `final`
slot replays nothing — no prompt, no negative prompt, no seed, no workflow — and
is covered without the instruction knowing about slots, because each of those
fields simply differs. And a transition, which has no record of its own at all,
is covered the same way.

The prompt is the one input recorded twice, and it takes two questions rather
than one. WHETHER to name a prompt is decided by the SUBMITTED one, the only
string the model ever saw. WHAT to say comes from the base prompt, because
`--prompt` is composed again with the lockstrings and the palette clause on the
way in. Neither answers the other's question: asking the base prompt's own
question prints a flag whenever an ingredient merely MOVED between the authored
prompt and a craft field — the #92 migration is exactly that — and the flag then
composes the ingredient in twice.

The value is only an instruction if composing it NOW still produces what was
submitted, so the refusal composes it and checks. When the cut's own characters
or palette changed under the record, nothing a flag can say restores that
prompt, and the field is named as unrestorable rather than guessed at.

A failed write-back is reported as itself, never as a failed generation. The two
states differ in what is on disk — one has no image, the other has the image and
its reference — and reporting the second as the first sends an operator to redo
a render that succeeded, which a re-run would draw differently.

## Compile, show, apply

An authored episode script (`script/episodes/<id>.json`) says what an episode
does. The project stores episodes as cuts, transitions, lettering and a reading
sequence. `toony draft` is the path between the two, and it is three separate
steps on purpose.

| command | writes | refuses when |
|---|---|---|
| `toony draft compile --episode <id>` | `.toony/drafts/<id>.json` | the script does not validate, or the compiled episode would not validate with its project |
| `toony draft show --episode <id>` | the draft's `reviewedAgainst` | there is no valid draft |
| `toony draft apply --episode <id>` | the episode's four files | any conflict, a project that changed since the last report, a project that does not validate, a result that would not validate |

Compile and show never write project data. They report, together: every
required field the compiler filled from a default, the craft and overflow
findings a draft can carry before any art exists, the page geometry the shipped
plan measurement gives it, and the diff against the episode the project holds
now, as per-kind counts and per-record changed fields. The geometry is measured
through the same function `toony plan --episode` uses after apply, so the two
numbers agree by construction.

**The conflict rule is keyed on presence.** Apply writes a record the project
does not hold, and reports as a conflict every field it would change on a record
the project already holds, and every record it would drop. Any conflict refuses
the whole apply, with all of them listed. The review marks and the recorded
render inputs are in that report as the reason a conflict cannot be cleared by
redrafting; they are not the detection rule, because a hand-written prompt on a
cut nobody has generated carries neither a mark nor a seed, and that is the
record this rule exists to protect. An existing sequence may be extended; a
sequence whose entries the draft drops or reorders is a conflict too.

Because apply only ever adds records, its four writes go cuts, transitions,
lettering, sequence. After any single interrupted rename every reference on disk
resolves: overlays and the sequence name cuts already written, the sequence
names transitions already written. The worst window is an orphan record, which
validation reports non-fatally and the next apply clears. There is no force
flag, for the reason the authoring commands have none.

A compiled cut's `imagePrompt` is the script's scene text and nothing else. The
story bible, the character lockstrings and the palette clause compose on top of
it at generate time, exactly as they do for a hand-authored cut.

The compile orchestration (script read and refusals, the project's lettering
theme, validation with the project, the draft lints, plan geometry, diff and
conflicts, and the written draft) lives in `@toony/authoring`. `toony draft
compile` formats its result; Studio uses the same function to create a new
episode from an agent-written script and then applies the draft with the same
`applyDraft`, so both paths produce the same records.

## Controlled production

`toony produce` is how an agent spends provider time without starting anything
a person has not seen. It adds no planning model, no provider and no second
store: it resolves targets with the selectors `toony generate` already accepts,
reads review state through the project loader and craft results through the
shipped `--json` reports, and drives `generate` or `import-image` in-process
with explicit `--cut` ids.

| command | provider call | writes |
|---|---|---|
| `toony produce inspect --episode <id> --cut ...` | none | nothing |
| `toony produce run --episode <id> --cut ... --accept <set>` | after the disclosure | `episodes/<id>/logs/produce.json`, then whatever `generate` writes |

**The disclosure comes first.** Both subcommands print the resolved ids, how
many already carry an image, how many carry recorded render inputs, and how many
carry a non-draft review the run would reset, plus every reason the run would
stop. `run` also needs `--accept` to name the exact target set `inspect`
printed; a set that resolves differently stops, so a `--review-status` selector
that moved under the operator never runs on cuts they did not see.

**Revision, repeat, render.** A run that changes an input (`--prompt`,
`--negative`, `--seed`, `--workflow`, `--width`, `--height`) on cuts that
recorded a render is a revision and must state `--reason`, once, for the whole
run. A run that changes nothing is a repeat and is reported as one. A run onto
cuts that recorded nothing is a first render. The controller never invents a
reason, a prompt, a character or a seed.

**Stops.** A target with no usable prompt, a target naming a character the
registry does not define, and a repeat refusal from `generate` each stop the
run with a non-zero exit, naming the target and what could not be determined. A
refusal is surfaced as `generate` printed it and never re-issued with the flags
it listed. An empty selector match is a successful no-op, as it is for
`generate`.

**One writer per record.** The controller writes no cut field, no review state
and no ingest entry. Ingest still resets a regenerated cut to `draft`; Studio is
still the only writer that marks one reviewed. The controller's own log records
what it resolved and from which selectors, the run's kind and reason, what each
target came back as (`generated`, `failed`, `unrecorded`, `imported`,
`not-reached`), which cuts had an authored prompt replaced, and the refusal
text when the run stopped before its first call. The planned entry is written
before the first provider call and replaced by the finished one.

Two `generate` behaviours decided under #286 land here as well. `--seed fresh`
rolls a new seed per cut and records it, so a different take needs no invented
number. A run whose write-back replaces an authored prompt prints one line with
the count and the ids, however many cuts it touched.

## Export Outputs

Three engines draw from one composition path (`composeCut` and
`composeTransitionBand`), planned by one pure layout module that the Studio
preview also uses:

- **strip**: the episode as one tall PNG or JPEG, preserving cuts, gutters,
  transitions and lettering. With a part height it writes parts that break
  between whole cuts and restack to exactly the same pixels; a cut taller than a
  part is split at exact rows. An optional byte cap per part is met by real
  encodes, never by lowering width or quality. Parts never allocate the whole page.
- **cuts**: one opaque image per cut at the chosen width, with an optional margin,
  and optionally each text-card transition as its own image.
- **social**: fixed frames with content inside safe insets and whole cuts per
  frame. A cut taller than the frame is split into rows, or fitted whole when its
  lettering stays legible. Frames are grouped into posts.

Built-in outputs: `strip`, `cuts`, `instagram` (1080 x 1350), `instagram-square`
(1080 x 1080), `x` (1600 x 900, up to 4 images per post) and `webtoon` (800 px
wide, 1280 px JPEG parts at quality 90). Each writes
`episodes/<id>/exports/<output>/` with a manifest that maps every file to the
sequence items it shows and records the options, warnings (for example cuts
without artwork) and a hash of the inputs. A folder is replaced atomically, and
only files the previous manifest owns are removed. `stitched` and `platform`
remain names for `strip` and `cuts`. Export folders written by earlier versions
are left on disk and never read.

Toony writes files only. It does not post or publish anywhere.

## Packs

Content can be contributed from outside the repository by a **pack**: a local
folder that adds a named ComfyUI workflow, a genre scaffold, an export preset, or
a craft band. The core owns registries; packs contribute entries; consumers read
the merged registry. Extending Toony's content therefore never requires a fork.

A pack is DATA — a JSON manifest plus the JSON files it names. It cannot carry
code, reach the network, add an export engine, or redefine a built-in. With no
packs installed the core behaves exactly as it does without the seam. Besides
workflows, scaffolds, presets and bands, a pack may ship a lettering theme,
applied where a bubble is created, and a style lexicon, composed into prompts at
generation; neither is read during planning.

`toony packs` is the operator surface over that seam: it lists what is installed
and which root each pack came from, copies a local pack directory into the right
root, removes one, and reports why a pack that is present is not loading.
Installing is a local copy, so the seam gains a command without gaining a
network.

The format is documented in [PACK_FORMAT.md](./PACK_FORMAT.md).

## Craft measurement

A pack's own output can be graded rather than eyeballed. `toony measure` composes
an episode exactly as the strip export does and reads the page back as craft
signals — the geometry and colour of the composed page, plus the transition
vocabulary read off the episode's declared records — so a pack is finished when
its output lands inside a target band. The measurement is provider-free and
deterministic, and language-dependent craft (bubble size, line count, text
density) is deliberately left to the lints that run on our own content.
`CRAFT_MEASURE.md` carries the signal list; this paragraph does not, because a
list in prose goes stale the next time one is added. See
[CRAFT_MEASURE.md](./CRAFT_MEASURE.md).

## Direct Studio lettering

The focused editor uses the shared SVG render plan for presets, movement, sizing,
tails, ordering, text and fills. Native rich input follows the same positioned
lines and effective font runs. Source offsets distinguish authored hard breaks
from visual wraps. Plain text and validated ranges remain authoritative; editable
DOM/HTML is never stored. IME owns its DOM during composition and reconciles the
resulting literal text afterward.

An existing legacy overlay keeps its layout until the user explicitly enables
direct editing. New presets use the versioned reference-width contract. Movement
and resizing use document coordinates across zoom and pan. Locks persist as editor
metadata; group alignment and optional guides do not change rendering semantics.

Modern cut saves include a `baseRevision` content hash for that cut's lettering.
The project write lock compares it with current saved content before merging. A
stale save returns HTTP409 without writing. Successful saves return the new
revision, including saves that leave newer local edits dirty. The UI preserves a
failed draft and offers copy/reload. Legacy API callers may omit the revision;
this is not a multi-process lock or a guarantee against unconditional external
writers. The one-external-writer project rule remains.

Explicit bubble copy writes a clipboard envelope to the system clipboard and to
the tab session, which survives reloads and cut navigation. Paste reads the system
clipboard when it holds copied bubbles and falls back to the tab copy; it validates
the envelope, inserts new objects and never replaces existing lettering
automatically. Native system paste is handled through the clipboard event; text
fields keep their normal text paste. Reload/discard
confirmation stays inside the editor so its focus, recovery and cancellation
remain accessible without a blocking browser dialog.

The selected-object inspector groups text, bubble appearance and layout separately.
Rare text options and exact positions use explicit disclosures. A native text
selection exposes range formatting in place of whole-bubble typography. The Bubble
tab's type choice (speech, thought, shout, whisper, narration, free text) preserves
content, position, colors and text ranges when explicitly changing a kind;
incompatible tails and shape overrides are reset. New or explicitly selected shout presets use a sharp outline.
Saved overlays are never restyled automatically.

Palette and type-picker thumbnails consume the same preset/type-change factories,
render plans and SVG body as the artwork. Thumbnail strokes use a fixed display
weight for legibility; the body/tail path and themed colors are shared. No separate
illustrative icon geometry represents a different generated silhouette.

## Human workspace

The left side of Studio is for checking results and for the craft a person does
best: lettering and the rhythm between cuts. Everything else is reachable by
asking the agent, so the pages read calmly and carry few controls.

- Rail: Library, then the open webtoon's Story, Characters and Episodes, then
  Settings. The last opened webtoon is remembered per browser, so the rail keeps it
  on Settings and the library offers "Continue". The theme follows the system
  unless chosen in Settings; a head script applies it before the first paint.
- Pages report what the person is looking at (page, episode, cut or transition,
  selected bubbles) to the agent panel through the shared focus store.
- Every write goes through the guarded routes and the single write path, so it is
  journaled and undoable. Episode create, rename and delete, cut add, remove and
  move, and one-character cast edits (`POST /api/cast`, merged by id so a stale
  page never overwrites another character) answer with a change id the page
  offers as Undo.
- The episode editor follows the live feed. A clean editor picks up saved changes
  in place: the cut editor is keyed by the lettering revision it started from
  (its own saves keep the key, so undo history survives), and the transition
  editor adopts a new saved revision. An editor with unsaved work shows a banner,
  "Reload it" or "Keep editing"; keeping edits leaves the save to the existing
  revision check (HTTP 409).
- A cut without artwork shows its scene text and takes an image by upload or
  drop (`POST /api/artwork`). "Mark as final" is the person's sign-off on a cut's
  artwork; the agent never sets it. Scene text is read-only here; the agent edits
  it.
- New dialogue bubbles start with a speaker (the last one used, a character the
  cut names, or the only cast member), and the editor points at a bubble that
  still has none before it saves.

## Connected creative workspace

Studio keeps a project conversation beside the human workspace. Story, characters,
episodes and lettering share the shell. The object inspector is part of the cut
editor. Hiding or expanding the conversation does not unmount the editor. Cut
navigation uses client routing; unsaved lettering has a session-local recovery
copy with its original save revision, so recovery still uses the existing save
conflict guard.

The initial agent adapter is read-only. It runs the user's installed Claude Code
or Codex CLI from an empty private directory with native tools, hooks, plugins,
MCP and project discovery restricted. It passes only allowlisted environment
variables. Authentication remains with the official CLI. Toony neither collects
credentials nor initiates login. Compatibility is currently pinned to inspected
CLI versions: Codex 0.158.0 and Claude Code 2.1.293, with required restriction flags
checked before inference. Other versions fail closed until verified.

`POST /api/agent` requires a loopback host, matching browser origin, a custom JSON
header and a strict HTTP-only local session cookie. Run Studio bound to loopback.
The development scripts and CLI launcher bind to loopback by default. Do not
override that binding or expose this local account adapter through a public proxy. Native output is
bounded and validated as events arrive; prohibited actions stop the process
group. Raw diagnostic output is never sent to the browser. Timeout, cancellation
and disconnect reject late responses.

Toony owns conversation IDs and replays a bounded conversation plus an allowlisted
snapshot of saved story, character and selected-scene text. This is application
history, not a resumed native CLI session. Images, unsaved editor changes and
provider configuration are excluded. A context switch never redirects an admitted
request. Saved conversation files live in `.toony-agent` under the workspace,
outside individual projects, with private file permissions. Retention can be
disabled for new conversations. Interrupted responses are not restarted after a
server restart. Provider retention is separate.

Project mutations, image editing and generation are not agent tools in this
increment. Conversation results cannot automatically become project canon.

## Studio write path and live feed

Every change Studio makes to a project, whether a person's save, another tab's
or the agent's, runs through one function, `withProjectWrite`
(`apps/studio/src/lib/ops/`):

1. take the project's lock (one per canonical project root, in this process);
2. load the project as the validation baseline;
3. snapshot every file and folder the change plans to write into
   `.toony/history/<changeId>/`, with a manifest of what existed;
4. run the change;
5. if no planned file changed, drop the snapshot and record nothing;
6. reload and refuse any new validation error in the touched scope;
7. write the manifest, append `.toony/agent/journal.jsonl`, keep the newest 50
   snapshots and publish a `project` event on the live bus.

A failure in steps 4 to 6 restores the snapshot before the error surfaces.
`undoChange` reverses a change from its snapshot only while every file it wrote
still holds exactly what it wrote; otherwise it answers "Newer edits depend on
this change. Undo those first." (a later Studio change wrote them) or that the
files changed elsewhere. The lettering, transition, cut field, cut review,
character, draft and art revision routes run inside this path with their
original revision checks and HTTP 409 conflicts unchanged. Atomic writes stage
into unique sibling files, so two writers never share a staging file. The CLI
and other tools are still separate processes: the one-external-writer rule
remains.

Every mutating Studio route uses one request guard (`lib/request-guard.ts`): a
loopback host, an Origin equal to that host, `x-toony-agent: 1`, the declared body
type (JSON, or an image for uploads), same-origin fetch metadata when sent, and
the HTTP-only, SameSite=Strict session cookie (path `/api`) this server process
issued through `POST /api/session`. Browser code calls `studioFetch`, which
bootstraps the session once and retries once after a server restart. Reads
that reveal local state (`GET /api/live`, `GET /api/workspace`) require the
header, the cookie, a loopback host and same-origin metadata.

Project operations shared by agent tools and the left workspace (create and
rename a work, update the story, merge characters by id, create an episode from
a script, add or edit cuts with sequence integrity, set dialogue, set
transitions, import artwork bytes) are plain functions over this path. Setting
dialogue on a cut that already has lettering never writes: it returns a
replacement for a person to approve.

`GET /api/live` is one NDJSON stream per tab: `hello`, the events the tab missed
since `?since=<seq>` (or `resync` when they are no longer held; the bus keeps
2000), then every new event, with a `ping` every 15 seconds. The browser's
`LiveProvider` keeps the stream open and reconnects. Pages call
`useProjectSync(workId, scopes)`: a project change that touches the page refreshes
it, unless an open editor registered with `useEditorScope` holds unsaved edits
the change overlaps; then the hook reports `changedWhileDirty` so the editor can
offer "Reload it" or "Keep editing", and the editor's own revision check still
guards its next save.

