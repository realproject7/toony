# Example: "Last Train"

A complete, original one-episode Toony project used as the MVP acceptance
capstone (see [`docs/CAPSTONE.md`](../../docs/CAPSTONE.md)). It exercises the full
workflow: an `episode.sequence` of cuts and transitions, per-cut image prompts,
lettering with bubble variety (narration, speech, thought, SFX), and transition
rhythm (gutter, scene-break, fade).

This seed ships with `image: null` on every cut — the artwork regenerates from
each cut's `imagePrompt` through local ComfyUI. Nothing is hard-coded.

## Reproduce it

From the checkout root (after `pnpm install && pnpm build`), with ComfyUI running
locally at `http://127.0.0.1:8188` with an illustration checkpoint:

```bash
alias toony="node $PWD/packages/cli/dist/bin.js"
cd examples/last-train

# point the CLI at your local ComfyUI (runtime-only; never committed)
export TOONY_COMFYUI_URL=http://127.0.0.1:8188
export TOONY_COMFYUI_CHECKPOINT="<your-checkpoint>.safetensors"

# generate each cut from its stored imagePrompt
for n in 001 002 003 004 005 006 007; do
  toony generate --episode ep-001 --cut cut-$n --slot clean \
    --width 832 --height 1216
done

toony validate
toony lint
toony export ep-001 --output cuts --width 800 --format jpg
toony export ep-001 --output strip --width 800
toony export ep-001 --output instagram
```

Open the studio to preview or edit instead: `toony studio .` from this folder.
The example opens as a single work, with its parent folder shown as the library.

The drawing path uses your local ComfyUI. You can also bring your own artwork
with `toony import-image`.
