// `toony studio [path]` — launch the local web studio over a workspace.
//
// Toony Studio v2 opens over a WORKSPACE root (a parent folder of many works)
// and shows a library at `/`; each work's pages live under `/w/<id>/...`. This
// command resolves what to open and starts the Next.js dev server in
// `apps/studio`, handing it the path through env vars. No network account is
// involved.
//
// Resolution:
//   - `toony studio` (no path) → opens the default/explicit workspace; the studio
//     reads `TOONY_WORKSPACE_DIR` (default `~/Documents/Toony`).
//   - `toony studio <workspace>` → opens that directory as the workspace.
//   - `toony studio <project>` → BACK-COMPAT: if the path is itself a single
//     project (has a readable `webtoon.json`), open it via `TOONY_PROJECT_DIR`;
//     the studio treats the parent as the workspace and still lists/opens it.

import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProject, ProjectIoError } from "@toony/project-io";
import { EXIT_OK, EXIT_USAGE } from "../exit.js";

export interface StudioIo {
  cwd: string;
  out: (line: string) => void;
  err: (line: string) => void;
}

/** Default dev-server port; overridable with `--port`. */
const DEFAULT_PORT = 4477;

/** Whether a directory is itself a single Toony project (has a webtoon.json). */
async function isProjectDir(dir: string): Promise<boolean> {
  try {
    await access(join(dir, "webtoon.json"));
    return true;
  } catch {
    return false;
  }
}

/** Walk up from a directory to find the monorepo root (has pnpm-workspace.yaml). */
async function findRepoRoot(from: string): Promise<string | null> {
  let dir = from;
  for (;;) {
    try {
      await access(join(dir, "pnpm-workspace.yaml"));
      return dir;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }
}

/** Run `toony studio`. Resolves on the dev server's exit code. */
export async function runStudio(args: string[], io: StudioIo): Promise<number> {
  let port = DEFAULT_PORT;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--port") {
      const value = args[++i];
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
        io.err(`invalid --port value: ${value ?? "(missing)"}`);
        return EXIT_USAGE;
      }
      port = parsed;
    } else if (arg?.startsWith("-")) {
      io.err(`unknown option: ${arg}`);
      return EXIT_USAGE;
    } else if (arg !== undefined) {
      positional.push(arg);
    }
  }

  // A path argument is resolved; with no argument, default to opening the
  // configured/default workspace (the studio resolves it from the environment).
  const explicitPath = positional[0];
  const studioEnv: Record<string, string> = {};

  if (explicitPath !== undefined) {
    const target = resolve(io.cwd, explicitPath);
    if (await isProjectDir(target)) {
      // Back-compat: the path is a single project. Open just that one; the studio
      // treats its parent as the workspace.
      try {
        const loaded = await loadProject(target);
        io.out(`project: ${loaded.project.webtoon.title} (${loaded.project.webtoon.projectId})`);
        if (!loaded.validation.valid) {
          io.out(`note: project has ${loaded.validation.issues.length} validation issue(s)`);
        }
      } catch (cause) {
        const reason = cause instanceof ProjectIoError ? cause.message : String(cause);
        io.err(`cannot launch studio: ${reason}`);
        return EXIT_USAGE;
      }
      studioEnv.TOONY_PROJECT_DIR = target;
    } else {
      // The path is a workspace root (a parent of many works). The studio scans
      // it for works; a non-existent dir is treated as an empty workspace.
      studioEnv.TOONY_WORKSPACE_DIR = target;
      io.out(`workspace: ${target}`);
    }
  } else {
    io.out("workspace: (default — TOONY_WORKSPACE_DIR or ~/Documents/Toony)");
  }

  const repoRoot = await findRepoRoot(dirname(fileURLToPath(import.meta.url)));
  if (repoRoot === null) {
    io.err("cannot locate the studio app (no pnpm workspace root found)");
    return EXIT_USAGE;
  }

  const url = `http://localhost:${port}`;
  io.out(`studio: ${url}`);
  io.out("press Ctrl+C to stop");

  return await new Promise<number>((resolveExit) => {
    const child = spawn(
      "pnpm",
      ["--filter", "@toony/studio", "exec", "next", "dev", "--port", String(port)],
      {
        cwd: repoRoot,
        stdio: "inherit",
        env: { ...process.env, ...studioEnv },
      },
    );
    child.on("error", (cause) => {
      io.err(`failed to start studio: ${cause.message}`);
      resolveExit(EXIT_USAGE);
    });
    child.on("exit", (code) => resolveExit(code ?? EXIT_OK));
  });
}
