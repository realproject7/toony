// Public API for @toony/cli.
//
// Exposes the command runners, the validation report helpers, and `run` for the
// bin entry point. The shared on-disk data layer (loadProject, writeProject,
// the format/paths) lives in `@toony/project-io`; consumers import it from there
// directly rather than through the CLI.

export { runExport } from "./commands/export.js";
export { runGenerate } from "./commands/generate.js";
export { runImportImage } from "./commands/import-image.js";
export { runInit } from "./commands/init.js";
export { runLint, runLintEpisode } from "./commands/lint.js";
export { runStudio } from "./commands/studio.js";
export { runValidate } from "./commands/validate.js";
export { EXIT_OK, EXIT_USAGE, EXIT_VALIDATION } from "./exit.js";
export { HELP_TEXT } from "./help.js";
export { jsonReport, textReport, type ValidateJsonReport } from "./report.js";

import { runExport } from "./commands/export.js";
import { runGenerate } from "./commands/generate.js";
import { runImportImage } from "./commands/import-image.js";
import { runInit } from "./commands/init.js";
import { runLint, runLintEpisode } from "./commands/lint.js";
import { runStudio } from "./commands/studio.js";
import { runValidate } from "./commands/validate.js";
import { EXIT_OK, EXIT_USAGE } from "./exit.js";
import { HELP_TEXT } from "./help.js";

export interface RunIo {
  cwd: string;
  out: (line: string) => void;
  err: (line: string) => void;
  /** Process environment, used by providers configured via env (e.g. ComfyUI). */
  env?: Record<string, string | undefined>;
}

/** Dispatch a full argv (without node/script) to the right command. */
export async function run(argv: string[], io: RunIo): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    io.out(HELP_TEXT);
    return command === undefined ? EXIT_USAGE : EXIT_OK;
  }

  switch (command) {
    case "init":
      return runInit(rest, io);
    case "validate":
      return runValidate(rest, io);
    case "studio":
      return runStudio(rest, io);
    case "import-image":
      return runImportImage(rest, io);
    case "generate":
      return runGenerate(rest, io);
    case "export":
      return runExport(rest, io);
    case "lint":
      return runLint(rest, io);
    case "lint-episode":
      return runLintEpisode(rest, io);
    default:
      io.err(`unknown command: ${command}`);
      io.err(HELP_TEXT);
      return EXIT_USAGE;
  }
}
