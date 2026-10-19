# Agent guide

Read this first. It says, in order, how an agent takes a person's idea through
Toony to an exported episode, which command answers which question, and what the
tool enforces so you do not have to remember it.

Toony is a tool a person and an agent use together. You propose; the person
decides. Everything you do is a local file or a `toony` command, and every
command prints JSON with `--json` and exits 0 on success, 1 on a domain error, 2
on a usage or IO error. Nothing here needs a network, a credential or a model
choice of its own.

## The loop

1. **Agree on the work.** Talk with the person. Write `script/brief.json`: what
   the work is, who it is for, the world, the story goals, content constraints,
   and a cast note per character. Characters themselves live in
   `webtoon.json` under `characters`, each with an `id`, a `name` and a
   `lockstring`, the short invariant description that keeps them on model.
   Format: `docs/PROJECT_FORMAT.md`, "Planning artifacts".
2. **Write the episode.** One `script/episodes/<id>.json` per episode: beats,
   each with cuts, each cut with its intent, its scene text, its characters, its
   dialogue, its shot type, and the gap after it. From the second episode on,
   state `continuity`: the episode it follows and where the story stands as it
   opens, so the hand-off is written down rather than remembered. Read it back with
   `toony validate` for the project and check the script's own warnings when you
   compile. A character id that resolves nowhere is a warning, not an error.
   Craft guidance for pacing and hooks: `docs/TOONY-PLANNING-HEURISTICS.md`.
3. **Compile and show.**

   ```sh
   toony draft compile --episode <id> --json
   ```

   This writes `.toony/drafts/<id>.json` and changes nothing in the project. The
   report carries every field the compiler defaulted, the lint findings a draft
   can have (`craft/transition-monotony`, `lettering/overflow`, and the rest that
   need no art), the page geometry, and the diff against the project. Show the
   person the diff. Fix the script and recompile until the report is what you
   both want. `toony draft show --episode <id> --json` reprints the diff against
   the project as it is now.
4. **Apply on approval.**

   ```sh
   toony draft apply --episode <id>
   ```

   Apply is the only step that writes project data. It refuses, writing nothing,
   when the draft would change or drop any record the project already holds,
   when the project changed since the last report, or when the project does not
   validate. There is no force flag. A conflict means a person or a previous run
   authored that record; ask before you redraft around it.
5. **Generate the cuts the person selected, through the controller.**

   ```sh
   toony produce inspect --episode <id> --cut <cut> [--cut <cut> ...] --json
   toony produce run --episode <id> --cut <cut> [--cut <cut> ...] --accept <target-set> --provider comfyui --allow-remote
   ```

   Inspect shows what the run would touch and every reason it would stop, with
   no provider call. Show that to the person. Run needs `--accept` with the
   target set inspect printed; it stops if the set resolves differently. A run
   that changes a prompt, seed, workflow or size on cuts that recorded a render
   is a revision and needs `--reason`. The cut's own `imagePrompt` is the
   script's scene text; the story bible, the character lockstrings and the
   palette clause compose on top of it on every run, so never write them into
   the cut. A finished render records its prompt, seed and workflow on the cut
   and in the episode's ingest log, so a bare re-run repeats the accepted image.
   Ask for a different take with `--seed fresh`. A run that rewrites authored
   prompts says so on one line, with the ids. Import a person's own art with
   `toony produce run ... --from <file>`. `toony generate` and
   `toony import-image` remain available for a single cut when the person has
   already said yes.
   Before approving generation, inspect the resolved provider inputs without
   submitting an image request:

   ```sh
   toony generate --episode <id> --cut <cut> --dry-run --json
   ```

   This shows the composed prompt, effective negative prompt, resolved canvas,
   reference attachment and authoring findings. It reads local configuration and
   assets but writes no project data and contacts no provider. A nonzero exit may
   accompany a complete JSON report when a preflight finding blocks generation.
   Inspection skips repeat/replacement checks, which still run before a real render.

   Use `--framing detail` for hands, body-part or object inserts. This records
   `imageFraming: detail`, omits full-character descriptions and automatic portrait
   references, and keeps the authored detail prompt. Scene framing remains the
   default. In multi-character tag prompts, standalone singular count tags are
   removed from separate identity descriptions; the scene must state its cast.
   No text template guarantees subject binding or professional artwork.

   A panel ratio may no longer silently reduce generation below the workflow's
   default canvas area. Inspect the proposed size, then choose an explicit width
   or height if the smaller canvas is deliberate. The warning remains visible.
   The baseline is an input-budget check, not a universal image-quality threshold.
   A display slot, generation resolution and future source crop are separate
   decisions. Existing images and display geometry are unchanged.

6. **Read review and craft results.** `toony validate --json`,
   `toony lint-episode <id> --json`, `toony plan --episode <id> --json`, and
   after art exists `toony measure --episode <id> --json`. Each cut carries a
   `reviewStatus` (`draft`, `human-edited`, `final`) that the person sets in
   Studio. You never set it. Propose targeted revisions: name the cut, say what
   changes, and compile a new draft or re-run the one cut.
7. **Letter, measure, export.** The person letters in Studio. You check with
   `toony lint-episode` and `toony measure --against <band>` when a pack band is
   installed, then export:

   ```sh
   toony export <id> --output strip                       # one tall image
   toony export <id> --output strip --slice-height 1280   # parts that restack exactly
   toony export <id> --output cuts --margin 40            # one image per cut
   toony export <id> --output instagram                   # 1080 x 1350 carousel frames
   toony export <id> --output x                           # 1600 x 900, 4 per post
   toony export <id> --output webtoon                     # 800 px JPEG parts
   ```

   Files land in `episodes/<id>/exports/<output>/` with a manifest. Cuts without
   artwork export as plain panels and are listed as a note. Measurement and the
   strip default to the project's `referenceWidth` (800 px when absent); an
   explicit `--width` or preset width wins. A flag that does not apply to the
   output is a usage error. Toony never posts anything.

## Files you write, files you never touch

Write by hand: `script/brief.json`, `script/episodes/<id>.json`,
`webtoon.json` (the character registry and project settings), `story-bible.md`.

Write only through commands: everything under `episodes/<id>/`. Cuts,
transitions, lettering and the sequence come from `toony draft apply` and the
Studio editors. Render records (`imagePrompt` after a run, `imageSeed`,
`imageWorkflow`), ingest logs and assets are written by `toony generate` and
`toony import-image`; the controller's own log by `toony produce`. Hand-editing
them breaks replay.

## What the tool enforces

- A project that does not validate is refused by every writing command. Fix it
  with `toony validate` first.
- A draft never calls a provider and never writes an image.
- Apply never silently replaces an authored record.
- No provider is reached before the run's disclosure exists, and never on a
  target set the person did not accept.
- A rendered cut is repeatable from its record; a size the run does not pin is
  checked against the log before anything is sent.
- Packs are data. They add workflows, genre scaffolds, export presets, craft
  bands, lettering themes and style lexicons, and they never supply story or
  character facts during planning. Select a theme or a lexicon for the project
  in `webtoon.json` (`letteringTheme`, `styleLexicon`); `toony packs list`
  names what is installed.

## When to ask the person

Before apply, always. Before any generation run that costs more than one cut.
Whenever a conflict names a record you did not write. Whenever the brief would
change: revise it with a stated reason, and recompile every episode script that
reports `script.brief-stale`.

The exit codes, every flag and every subcommand: `toony --help`.
