# @toony/generate

The image generation run shared by the `toony generate` command and Toony
Studio's agent tools, so the CLI and the in-app agent draw a cut the same way.
`runGenerate(args, io)` takes the command's arguments and:

1. refuses a project that does not validate (the six wiring codes only warn);
2. plans every target before the first request: the prompt (story bible, the
   characters' identity descriptions or structured art direction, palette and
   the pack's style words), the seed, the workflow and the panel shape;
3. builds one ComfyUI provider per workflow, refusing a non-local engine
   without `--allow-remote`;
4. attaches a character's reference sheet when the workflow takes one, and the
   cut's current image when the run edits it (`--source current --strength`);
5. checks the prompts (preflight) and refuses a run that would silently replace
   an image at a different size;
6. renders each target, then ingests it and records what produced it.

A caller that runs it in-process can pass `report` (per-target events,
including `started`), `commit` (wraps each image's writes, so Studio takes its
project lock and undo snapshot only around the write, not the render) and
`keepCutPrompt` (keep the cut's authored scene text; the submitted prompt is in
the ingest log).

The package also exports the helpers the run is built from: prompt
composition, preflight findings, the validation gate and its report, pack
discovery, shell quoting and the CLI exit codes.
