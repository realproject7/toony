# Example: "Last Train"

A complete, original one-episode Toony project used as the MVP acceptance
capstone (see [`docs/CAPSTONE.md`](../../docs/CAPSTONE.md)). It exercises the full
workflow: an `episode.sequence` of cuts and transitions, per-cut image prompts,
lettering with bubble variety (narration, speech, thought, SFX), and transition
rhythm (gutter, scene-break, fade).

This seed ships with `image: null` on every cut — the artwork regenerates from
each cut's `imagePrompt` through a provider. Nothing is hard-coded.

## Reproduce it

From a checkout (after `pnpm install && pnpm -r build`), with a running
provider — e.g. a local ComfyUI at `http://127.0.0.1:8188` with an illustration
checkpoint:

```bash
cd examples/last-train

# point the CLI at your provider (runtime-only; never committed)
export TOONY_COMFYUI_URL=http://127.0.0.1:8188
export TOONY_COMFYUI_CHECKPOINT=<your-checkpoint>.safetensors

# generate each cut from its stored imagePrompt
for n in 001 002 003 004 005 006 007; do
  toony generate --episode ep-001 --cut cut-$n --slot clean \
    --width 832 --height 1216 --allow-remote
done

toony validate
toony lint
toony export platform --episode ep-001 --width 800 --format jpg
toony export stitched --episode ep-001 --width 800 --format png
toony export plotlink  --episode ep-001
```

Open the studio to preview/edit instead: `toony studio` (from this folder).

Provider-neutral: any configured provider (or manual import via
`toony import-image`) works — ComfyUI is just the example backend.
