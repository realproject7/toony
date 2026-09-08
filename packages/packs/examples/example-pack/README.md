# Toony Example Pack

A complete, working pack. It contributes one of each kind of content a pack can
add, so it doubles as the reference for the format:

| Kind | This pack adds | Use it with |
|---|---|---|
| Named ComfyUI workflow | `high-detail` | `toony generate --workflow high-detail …` |
| Genre scaffold | `noir` | `toony init my-story --genre noir` |
| Export preset | `webtoon-tall` (platform, 1600px JPEG q88) | `toony export webtoon-tall --episode ep-001` |

## Try it

```sh
mkdir -p .toony/packs
cp -R <toony>/packages/packs/examples/example-pack .toony/packs/
toony init my-story --genre noir
toony export webtoon-tall my-story --episode ep-001
```

Or point `TOONY_PACKS` at any directory that holds pack folders:

```sh
TOONY_PACKS=<toony>/packages/packs/examples toony init my-story --genre noir
```

## Author your own

Copy this folder, change `id` and `name` in `toony-pack.json`, and edit the
files it points at. The full format — every field, every rule, and what a pack
deliberately cannot do — is documented in [`docs/PACK_FORMAT.md`](../../../../docs/PACK_FORMAT.md).
