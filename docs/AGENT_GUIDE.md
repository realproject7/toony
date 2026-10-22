# Agent guide

Read this first. It says, in order, how an agent takes a person's idea through
Toony to an exported episode, which command answers which question, and what the
tool enforces so you do not have to remember it.

Toony is a tool a person and an agent use together. You do the work, including
drawing and changing the cut art; the person directs, letters and signs off. Everything you do is a local file or a `toony` command, and every
command prints JSON with `--json` and exits 0 on success, 1 on a domain error, 2
on a usage or IO error. Nothing here needs a network, a credential or a model
choice of its own.

This guide is for an agent working with the `toony` command and the project
files. An agent connected inside Toony Studio works differently: see "Inside
Toony Studio" at the end.

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
5. **Draw the episode's cuts through the controller.**

   ```sh
   toony produce inspect --episode <id> --cut <cut> [--cut <cut> ...] --json
   toony produce run --episode <id> --cut <cut> [--cut <cut> ...] --accept <target-set> --provider comfyui
   ```

   Inspect shows what the run would touch and every reason it would stop, with
   no provider call. Run needs `--accept` with the target set inspect printed;
   it stops if the set resolves differently. A local engine (localhost or
   127.0.0.1) needs no `--allow-remote`. A run
   that changes a prompt, seed, workflow or size on cuts that recorded a render
   is a revision and needs `--reason`. The cut's own `imagePrompt` is the
   script's scene text; the story bible, the character lockstrings and the
   palette clause compose on top of it on every run, so never write them into
   the cut. A finished render records its prompt, seed and workflow on the cut
   and in the episode's ingest log, so a bare re-run repeats the accepted image.
   Ask for a different take with `--seed fresh`. A run that rewrites authored
   prompts says so on one line, with the ids. Import a person's own art with
   `toony produce run ... --from <file>`. `toony generate` and
   `toony import-image` work on single cuts, and
   `toony generate --cut <cut> --source current --strength 0.5 --prompt <text>`
   changes a cut's current image while keeping its composition; add
   `--region x,y,w,h` (fractions of the picture) to change only that part.
   Before a run, inspect the resolved provider inputs without submitting an
   image request:

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
  target set other than the one the inspect step printed.
- A rendered cut is repeatable from its record; a size the run does not pin is
  checked against the log before anything is sent.
- Packs are data. They add workflows, genre scaffolds, export presets, craft
  bands, lettering themes and style lexicons, and they never supply story or
  character facts during planning. Select a theme or a lexicon for the project
  in `webtoon.json` (`letteringTheme`, `styleLexicon`); `toony packs list`
  names what is installed.

## When to ask the person

Before apply, always. Whenever a conflict names a record you did not write.
Drawing with the person's local engine needs no question; ask before using a
paid remote provider. Whenever the brief would
change: revise it with a stated reason, and recompile every episode script that
reports `script.brief-stale`.

The exit codes, every flag and every subcommand: `toony --help`.

## Inside Toony Studio

When the person connects their Claude Code or Codex in Studio's agent panel,
the agent has no shell, file or web access. It works only through the Toony
tools Studio serves over MCP (server `toony`), and Studio checks every argument
and writes through its own write path. The rules arrive as a system prompt or
developer instructions; the person's message arrives with a line saying what
they are looking at.

- Start a new session with `get_status`: the work, cast, episodes with
  progress, your task list, the open question, remembered notes and what
  changed since your last turn.
- Read with `read_story`, `read_characters`, `read_episode`, `view_cut` (the
  cut as an image with its lettering, and the prompt and seed that drew it),
  `view_training_set` (a character's drawn training set as one numbered sheet)
  and `check_episode`.
- Write with `create_work` (from a library chat only), `update_story`,
  `save_characters`, `remove_character`, `create_episode`, `rename_episode`,
  `delete_episode`, `edit_cuts`, `set_dialogue`, `set_transitions`,
  `draw_character`, `train_character`, `draw_cuts`, `edit_cut_art`,
  `import_artwork` (a file the
  person points to), `export_episode` (files only) and `undo_change`.
- Teach the engine a main character with `train_character` once their portrait
  is kept, in two calls. The first draws about 22 pictures from the portrait in
  the background (views held closely, poses at the usual balance), captions each
  with a trigger word and the lockstring, and stops. The agent checks the set
  with `view_training_set`. When most pictures miss the same detail of the
  portrait (a mustache the lockstring does not mention), it draws a new set with
  `redraw` and `prompt` naming it, at most twice; the detail is drawn into every
  picture but left out of the captions, so the LoRA learns it as part of the
  character. Then it calls `train_character` again with `drop`, the numbers of
  pictures that clearly break the portrait's design, show two figures or are
  broken (small differences of shape or shade stay; an empty list keeps them
  all; the portrait stays, and at least 10 pictures must remain). That call runs
  the training command the person set up
  (`TOONY_LORA_TRAIN_COMMAND`: a command with `{character}`, `{dataset}`,
  `{name}` and `{steps}` placeholders, run without a shell, that writes
  `{name}.safetensors` into the engine's LoRA folder). When it succeeds the
  character's `lora` is recorded (one undoable change) and every picture of them
  is drawn with it: the whole frame for one person, each person's own half in a
  two-person cut drawn side by side (and both lightly on the pass that joins
  them), and every portrait, which the agent then redraws and keeps. Both jobs
  wait in the drawing queue, so drawing and training never share the engine;
  `art_status` follows it and `stop_drawing` stops it. Without the command,
  `check_art_engine` reports no training and the tool says so.
- Draw portrait candidates with `draw_portraits` (a drawing read: three plain
  portraits from the lockstring, each with its own seed, shown to the agent and
  kept in the work's private agent files; the project does not change).
- Keep the cast on model with `draw_character`: the candidate the agent picks
  (`choose`, its seed) becomes that character's first reference picture; the
  agent keeps the lockstring as written (rewording it to describe the picture
  pulled the cuts away from the picture in testing). Without `choose`
  it draws one portrait and keeps it at once. A character's `avoid` tags (what
  the engine tends to draw instead of their look) go into the negative of every
  picture that shows them; none may name what the lockstring asks for or implies
  (with "shaved head" in the lockstring, "bald head" in the avoid tags left no
  candidate shaved in testing). Every cut that shows the character, every edit and every
  redraw is then drawn with it (the engine needs the IP-Adapter nodes; without
  them the cut is drawn from the lockstring alone and the tool says so). A cut
  with two people is drawn side by side: each person first alone in their half
  with their portrait, then the whole picture. List the cut's characters left
  to right, and keep place and light in phrases of their own, apart from what
  the people do.
- Draw cuts with `draw_cuts`: an English image prompt per cut, sent on its
  own (the story bible does not wrap it), and the engine adds the cast's
  lockstrings. Set a wide or tall cut's shape first with `edit_cuts` (`shape`,
  height as a multiple of width, 0.5 to 2.5). `edit_cuts` can also frame a cut
  that has a picture (`view`, the part it shows in fractions of the picture, or
  null for all of it); the person frames cuts and reuses another cut's picture
  from the cut editor's Frame button. Change a cut's art with
  `edit_cut_art`, which starts from the current image (`strength` 0.1 to 0.9).
  For a change inside the picture (a face's expression, a hand, a prop) give
  `region`, the part it is about boxed on the picture `view_cut` shows: only
  that part is redrawn, larger so a small face can change, and pasted back with
  a soft edge, so nothing outside it changes (`strength` defaults to 0.7 there).
  The prompt then says how that part should look, naming what each feature
  does for an expression ("close-up of her face, laughing out loud, mouth wide
  open, eyes squeezed shut"): in testing a bare "laughing" came out as a grin,
  and naming the features carried every request where a higher strength did
  not. In a two-person cut the part is drawn with the person on its side only.
  Without a region the whole picture is redrawn; on three test edits that left
  every expression unchanged or half changed and re-rendered the whole cut.
  A `draw_cuts` item with `fromCutId` starts from another cut's finished
  picture, for the next moment in the same place and a similar framing.
  Both run as a background job on the person's local ComfyUI: the tool waits a
  few minutes, returns while the rest is drawn, and a follow-up message reaches
  the agent when the job ends. `art_status` follows a job, `stop_drawing` stops
  one and `check_art_engine` says whether the engine is ready. Each finished
  image is one undoable change.
- `create_episode` takes the episode script described above (beats, cuts,
  dialogue, `transitionAfter`) without the format, id and brief revision
  fields; Studio fills them, compiles the draft and applies it as the next
  episode.
- Plan with `update_tasks`, ask with `ask_user` (2 to 6 options, then end the
  turn), keep durable decisions with `remember` and drop them with `forget`.
- Offer lines with `suggest_dialogue`: two to five short alternatives for one
  cut (speech, thought, narration, or silent when the art carries the beat).
  They appear beside the cut's art; the person edits, copies or inserts one.
  Nothing is lettered by the tool, and new suggestions replace the cut's
  earlier ones.
- `set_dialogue` on a cut that already has lettering, and every write while the
  person has "Let the agent make changes without asking" off, becomes a
  proposal the person applies or dismisses. Do not repeat it; end the turn and
  you will hear the decision.
- There is no way to set review status; the person marks a cut final.
