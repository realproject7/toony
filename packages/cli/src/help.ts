// `toony --help` text. Exit codes are documented here so agents can rely on them.

export const HELP_TEXT = `toony — local-first webtoon production CLI

usage:
  toony init <name>        scaffold a new project folder (passes \`toony validate\`)
  toony validate [path]    validate a project folder (default: current directory)
  toony studio [path]      launch the local web studio for a project
  toony import-image ...   import/ingest an image asset for a cut or transition
  toony export <target> ...  export platform/stitched/plotlink for an episode
  toony lint [path]        lint a whole project (schema, images, overflow, manifests)
  toony lint-episode <id>  lint a single episode by id
  toony --help             show this help

options:
  validate --json          emit a structured JSON report instead of text
  studio --port <n>        port for the local studio dev server (default 4477)
  import-image --episode <id> (--cut <id> [--slot clean|final] | --transition <id>)
               --from <file> [--provider manual]
                           strips image metadata at ingest; provider-neutral
  export <platform|stitched|plotlink> [path] --episode <id>
         [--width <px>] [--format png|jpg] [--quality <0-100>]
                           writes into the project's exports/ folder + manifest
  lint [path] --json       emit findings as JSON instead of text
  lint-episode <id> [path] [--json]
                           lint only the named episode

exit codes (agent-readable):
  0   success; for \`validate\`, the project is valid; for \`lint\`, no error/warning findings
  1   findings found (\`validate\`: schema errors; \`lint\`: any error/warning finding)
  2   usage error or IO failure (bad arguments, missing/unreadable files)
`;
