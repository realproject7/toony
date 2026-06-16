// `toony --help` text. Exit codes are documented here so agents can rely on them.

export const HELP_TEXT = `toony — local-first webtoon production CLI

usage:
  toony init <name>        scaffold a new project folder (passes \`toony validate\`)
  toony validate [path]    validate a project folder (default: current directory)
  toony studio [path]      launch the local web studio for a project
  toony --help             show this help

options:
  validate --json          emit a structured JSON report instead of text
  studio --port <n>        port for the local studio dev server (default 4477)

exit codes (agent-readable):
  0   success; for \`validate\`, the project is valid
  1   validation errors found (\`validate\` only)
  2   usage error or IO failure (bad arguments, missing/unreadable files)
`;
