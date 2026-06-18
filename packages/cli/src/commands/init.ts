// `toony init <name>` — scaffold a new local project folder.

import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  buildInitialProject,
  GENRES,
  type Genre,
  isGenre,
  slugify,
  writeProject,
} from "@toony/project-io";
import { EXIT_OK, EXIT_USAGE } from "../exit.js";

const USAGE = `usage: toony init <name> [--genre <${GENRES.join("|")}>]`;

export interface InitIo {
  cwd: string;
  out: (line: string) => void;
  err: (line: string) => void;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Run `toony init`. Returns the process exit code. */
export async function runInit(args: string[], io: InitIo): Promise<number> {
  // Parse a single positional <name> plus an optional `--genre <g>` flag. Unknown
  // flags are a usage error (consistent with the other commands).
  let name: string | undefined;
  let genre: Genre | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === "--genre") {
      const value = args[i + 1];
      if (value === undefined) {
        io.err(`missing value for --genre; expected one of: ${GENRES.join(", ")}`);
        return EXIT_USAGE;
      }
      if (!isGenre(value)) {
        io.err(`unknown genre "${value}"; expected one of: ${GENRES.join(", ")}`);
        return EXIT_USAGE;
      }
      genre = value;
      i++;
      continue;
    }
    if (arg.startsWith("-")) {
      io.err(`unknown option: ${arg}\n${USAGE}`);
      return EXIT_USAGE;
    }
    if (name === undefined) {
      name = arg;
      continue;
    }
    io.err(`unexpected argument: ${arg}\n${USAGE}`);
    return EXIT_USAGE;
  }

  if (name === undefined || name.length === 0) {
    io.err(USAGE);
    return EXIT_USAGE;
  }

  // The folder name is derived from the provided name unless it is already a
  // path; this keeps the on-disk id and the folder name in sync.
  const slug = slugify(name);
  const target = isAbsolute(name) ? name : resolve(io.cwd, slug);

  if (await exists(target)) {
    io.err(`target already exists: ${target}`);
    return EXIT_USAGE;
  }

  const project = buildInitialProject(name, genre);
  try {
    await writeProject(target, project);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    io.err(`init failed: ${reason}`);
    return EXIT_USAGE;
  }

  const flavor = genre ? ` (${genre} template)` : "";
  io.out(`created project "${project.webtoon.projectId}"${flavor} at ${target}`);
  io.out(`next: cd ${target} && toony validate`);
  return EXIT_OK;
}
