// `toony studio [path]` — launch the local web studio against a project.
//
// Resolves the project directory, confirms it loads via the shared loader, then
// starts the Next.js dev server in `apps/studio`, handing it the project path
// through the `TOONY_PROJECT_DIR` env var. No network account is involved.
//
// Scope note: this command owns the launch/serve mechanism only. The full
// Production Scroll studio UI (dashboard, episode preview, Open Design styling)
// is issue #6; the served page here is the minimal real load proof in
// `apps/studio`.

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

  const root = resolve(io.cwd, positional[0] ?? ".");

  // Fail fast with an actionable message if the project cannot be read at all.
  try {
    const loaded = await loadProject(root);
    io.out(`project: ${loaded.project.webtoon.title} (${loaded.project.webtoon.projectId})`);
    if (!loaded.validation.valid) {
      io.out(`note: project has ${loaded.validation.issues.length} validation issue(s)`);
    }
  } catch (cause) {
    const reason = cause instanceof ProjectIoError ? cause.message : String(cause);
    io.err(`cannot launch studio: ${reason}`);
    return EXIT_USAGE;
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
        env: { ...process.env, TOONY_PROJECT_DIR: root },
      },
    );
    child.on("error", (cause) => {
      io.err(`failed to start studio: ${cause.message}`);
      resolveExit(EXIT_USAGE);
    });
    child.on("exit", (code) => resolveExit(code ?? EXIT_OK));
  });
}
