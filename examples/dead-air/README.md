# Example: "Dead Air"

A complete, original one-episode Toony project used as the **v3 craft capstone**
(see [`docs/CAPSTONE.md`](../../docs/CAPSTONE.md)). A late-night radio host is
hijacked on air by an unknown caller who describes her own booth in real time.

It exercises the v3 **craft skills** end to end:

- a **character registry** (`webtoon.characters`) with strong lockstrings for
  **Wren** and **The Caller**, referenced from cuts via `cut.characters` —
  `toony generate` injects each lockstring verbatim so the character stays
  on-model across cuts;
- the full **bubble grammar**: narration (borderless), speech, thought, a `beat`
  "…", a `tone=shout` (scalloped), `ambient`, and SFX in two `sfxMode`s
  (`hand_lettered`, `impact_band`);
- **transition rhythm** across six panels: `time_card`, `color_field`,
  `narration_card`, `dialogue_card`, `void`, then a `color_field` with a fade;
- **visual rhythm** via per-cut `shotType` / `palette` / `layer` / `styleTag`.

This example ships with seven clean cut images. You can redraw them from each
cut's stored `imagePrompt` plus the injected character lockstrings.

## Reproduce it

From the checkout root (after `pnpm install && pnpm build`), with ComfyUI running
locally at `http://127.0.0.1:8188` with an illustration checkpoint:

```bash
alias toony="node $PWD/packages/cli/dist/bin.js"
cd examples/dead-air

# point the CLI at your local ComfyUI (runtime-only; never committed)
export TOONY_COMFYUI_URL=http://127.0.0.1:8188
export TOONY_COMFYUI_CHECKPOINT="<your-checkpoint>.safetensors"

# generate each cut from its stored imagePrompt + character lockstrings
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
