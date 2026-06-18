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
           [--seed <n>] [--provider comfyui] [--allow-remote]
                           generates and ingests an image; the provider endpoint
                           and workflow come from local runtime config/env
                           (e.g. TOONY_COMFYUI_URL), never from webtoon.json
  export <platform|stitched|plotlink> [path] --episode <id>
         [--width <px>] [--format png|jpg] [--quality <0-100>]
                           writes into the project's exports/ folder + manifest
  lint [path] --json       emit findings as JSON instead of text
  lint-episode <id> [path] [--json]
                           lint only the named episode

exit codes (agent-readable):
  0   success; for \`validate\`, the project is valid; for \`lint\`, no error/warning findings
  1   domain error: validation errors (\`validate\`: schema errors), lint findings
      (\`lint\`: any error/warning finding), or generation failure
      (\`generate\`: endpoint unreachable, provider error, or timeout)
  2   usage error or IO failure (bad arguments, missing/unreadable files)
`;
