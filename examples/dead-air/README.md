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
- **transition rhythm** across six kinds (`title_card`, `gutter`, `scene-break`,
  `palette_shift`, `black_band`, `fade`) with `color`;
- **visual rhythm** via per-cut `shotType` / `palette` / `layer` / `styleTag`.

This seed ships with `image: null` on every cut — the artwork regenerates from
each cut's `imagePrompt` plus the injected character lockstrings. Nothing is
hard-coded.

## Reproduce it

From a checkout (after `pnpm install && pnpm -r build`), with a running provider —
e.g. a local ComfyUI at `http://127.0.0.1:8188` with an illustration checkpoint:

```bash
cd examples/dead-air

# point the CLI at your provider (runtime-only; never committed)
export TOONY_COMFYUI_URL=http://127.0.0.1:8188
export TOONY_COMFYUI_CHECKPOINT=<your-checkpoint>.safetensors

# generate each cut from its stored imagePrompt + character lockstrings
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
