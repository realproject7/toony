// `toony validate [path]` — load and validate a project folder.

import { resolve } from "node:path";
import { EXIT_OK, EXIT_USAGE, EXIT_VALIDATION } from "../exit.js";
import { loadProject, ProjectLoadError } from "../loader.js";
import { jsonReport, textReport } from "../report.js";

export interface ValidateIo {
  cwd: string;
  out: (line: string) => void;
  err: (line: string) => void;
}

/** Run `toony validate`. Returns the process exit code. */
export async function runValidate(args: string[], io: ValidateIo): Promise<number> {
  let json = false;
  const positional: string[] = [];
  for (const arg of args) {
    if (arg === "--json") json = true;
    else if (arg.startsWith("-")) {
      io.err(`unknown option: ${arg}`);
      return EXIT_USAGE;
    } else positional.push(arg);
  }

  const root = resolve(io.cwd, positional[0] ?? ".");

  let loaded: Awaited<ReturnType<typeof loadProject>>;
  try {
    loaded = await loadProject(root);
  } catch (cause) {
    if (cause instanceof ProjectLoadError) {
      if (json) io.out(JSON.stringify({ root, valid: false, error: cause.message }, null, 2));
      else io.err(`load error: ${cause.message}`);
      return EXIT_USAGE;
    }
    throw cause;
  }

  if (json) {
    io.out(JSON.stringify(jsonReport(root, loaded.validation), null, 2));
  } else {
    io.out(textReport(root, loaded.validation));
  }
  return loaded.validation.valid ? EXIT_OK : EXIT_VALIDATION;
}
