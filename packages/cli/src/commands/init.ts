// `toony init <name>` — scaffold a new local project folder.

import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { buildInitialProject, slugify, writeProject } from "@toony/project-io";
import { EXIT_OK, EXIT_USAGE } from "../exit.js";

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
  const name = args[0];
  if (name === undefined || name.length === 0) {
    io.err("usage: toony init <name>");
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

  const project = buildInitialProject(name);
  try {
    await writeProject(target, project);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    io.err(`init failed: ${reason}`);
    return EXIT_USAGE;
  }

  io.out(`created project "${project.webtoon.projectId}" at ${target}`);
  io.out(`next: cd ${target} && toony validate`);
  return EXIT_OK;
}
