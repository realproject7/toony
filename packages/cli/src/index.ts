// Public API for @toony/cli.
//
// Exposes the command runners and the reusable project loader so other packages
// (notably the studio app and issue #6) can consume the data layer directly,
// and exposes `run` for the bin entry point.

export { runInit } from "./commands/init.js";
export { runStudio } from "./commands/studio.js";
export { runValidate } from "./commands/validate.js";
export { EXIT_OK, EXIT_USAGE, EXIT_VALIDATION } from "./exit.js";
export { HELP_TEXT } from "./help.js";
export {
  type LoadedProject,
  loadProject,
  ProjectLoadError,
} from "./loader.js";
export { jsonReport, textReport, type ValidateJsonReport } from "./report.js";
export { buildInitialProject, slugify, writeProject } from "./scaffold.js";

import { runInit } from "./commands/init.js";
import { runStudio } from "./commands/studio.js";
import { runValidate } from "./commands/validate.js";
import { EXIT_OK, EXIT_USAGE } from "./exit.js";
import { HELP_TEXT } from "./help.js";

export interface RunIo {
  cwd: string;
  out: (line: string) => void;
  err: (line: string) => void;
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
    default:
      io.err(`unknown command: ${command}`);
      io.err(HELP_TEXT);
      return EXIT_USAGE;
  }
}
