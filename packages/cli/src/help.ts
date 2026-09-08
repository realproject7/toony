// `toony --help` text. Exit codes are documented here so agents can rely on them.

export const HELP_TEXT = `toony — local-first webtoon production CLI

usage:
  toony init <name> [--genre <romance|comedy|action|thriller|slice-of-life>]
                           scaffold a new project folder (passes \`toony validate\`); --genre seeds a genre-tuned starter
  toony validate [path]    validate a project folder (default: current directory)
  toony studio [path]      launch the web studio over a workspace (or a single project)
  toony import-image ...   import/ingest an image asset for a cut or transition
  toony generate ...       generate a cut/transition image via a provider (comfyui)
  toony export <target> ...  export platform/stitched/plotlink for an episode
  toony lint [path]        lint a whole project (schema, images, overflow, manifests)
  toony lint-episode <id>  lint a single episode by id
  toony measure [path] --episode <id>
                           measure a rendered episode's craft signals, and grade
                           them against a target band
  toony --help             show this help

options:
  validate --json          emit a structured JSON report instead of text
  studio --port <n>        port for the studio server (in-repo dev default 4477;
                           installed: a free port is chosen automatically)
  import-image --episode <id> (--cut <id> [--slot clean|final] | --transition <id>)
               --from <file> [--provider manual]
                           strips image metadata at ingest; provider-neutral
  generate --episode <id> (--cut <id> [--slot clean|final] | --transition <id>)
           --prompt <text> [--negative <text>] [--width <px>] [--height <px>]
           [--seed <n>] [--workflow <name>] [--provider comfyui] [--allow-remote]
                           generates and ingests an image; the provider endpoint
                           and workflow come from local runtime config/env
                           (e.g. TOONY_COMFYUI_URL), never from webtoon.json;
                           --workflow selects a workflow a pack contributed
  export <platform|stitched|plotlink|preset> [path] --episode <id>
         [--width <px>] [--format png|jpg] [--quality <0-100>]
                           writes into the project's exports/ folder + manifest;
                           the first argument is an export preset — the three
                           built-ins, or one an installed pack contributes
  lint [path] --json       emit findings as JSON instead of text
  lint-episode <id> [path] [--json]
                           lint only the named episode
  measure [path] --episode <id> [--against <band-id|band.json>] [--json]
          [--width <px>] [--screen-aspect <n>]
                           renders the episode the way \`export stitched\` does —
                           no provider, no prior export — and reports gutter,
                           panel, and colour signals; --against grades them
                           against a band file or a band an installed pack ships
                           (docs/CRAFT_MEASURE.md)

packs (docs/PACK_FORMAT.md):
  a pack is a local folder of DATA that adds named workflows, genre scaffolds,
  export presets, and craft bands without editing Toony. Packs are read from
  <project>/.toony/packs, the workspace folder above it, and every directory
  named by TOONY_PACKS. Nothing in a pack can run code.

exit codes (agent-readable):
  0   success; for \`validate\`, the project is valid; for \`lint\`, no error/warning findings
  1   domain error: validation errors (\`validate\`: schema errors), lint findings
      (\`lint\`: any error/warning finding), an out-of-band measurement
      (\`measure --against\`), or generation failure
      (\`generate\`: endpoint unreachable, provider error, or timeout)
  2   usage error or IO failure (bad arguments, missing/unreadable files)
`;
