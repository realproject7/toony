// `toony studio [path]` — launch the local web studio over a workspace.
//
// Toony Studio v2 opens over a WORKSPACE root (a parent folder of many works)
// and shows a library at `/`; each work's pages live under `/w/<id>/...`. This
// command resolves what to open and starts the studio web server, handing it the
// path through env vars. No network account is involved.
//
// Two launch modes, transparent to the caller:
//   - Installed mode (single global install): the CLI package ships the Next.js
//     standalone Studio build under `<pkg>/studio/`. The command spawns that
//     self-contained `server.js` on a free port (or `--port`). No monorepo,
//     pnpm, or `next` binary is required.
//   - In-repo dev mode: when run from the monorepo (no bundled studio present),
//     it starts the `@toony/studio` Next dev server via pnpm as before.
//
// Resolution:
//   - `toony studio` (no path) → opens the default/explicit workspace; the studio
//     reads `TOONY_WORKSPACE_DIR` (default `~/Documents/Toony`).
//   - `toony studio <workspace>` → opens that directory as the workspace.
//   - `toony studio <project>` → BACK-COMPAT: if the path is itself a single
//     project (has a readable `webtoon.json`), open it via `TOONY_PROJECT_DIR`;
//     the studio treats the parent as the workspace and opens that project's page.
//
// Once the server answers, the command opens the page in the default browser
// with the operating system's opener (`open`, `xdg-open`, `start`), unless
// `--no-open` is given. Installed mode prefers a stable port (4477) so the
// browser keeps per-site settings between launches, and falls back to a free
// port when it is taken.

import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { createServer } from "node:net";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProject, ProjectIoError } from "@toony/project-io";
import { EXIT_OK, EXIT_USAGE } from "../exit.js";

export interface StudioIo {
  cwd: string;
  out: (line: string) => void;
  err: (line: string) => void;
  /** Open a URL in the browser. Defaults to the operating system's opener. */
  openUrl?: (url: string) => void;
}

/** Default port: the in-repo dev server's, and the installed server's first choice. */
const DEFAULT_DEV_PORT = 4477;
/** The stable port installed mode tries before asking the OS for a free one. */
export const DEFAULT_STUDIO_PORT = DEFAULT_DEV_PORT;
/** How long to wait for the server before opening the browser anyway. */
const OPEN_WAIT_MS = 90_000;

/** The page `toony studio` opens: the library, or a single project's page. */
export function studioUrl(port: number, workId?: string): string {
  const base = `http://127.0.0.1:${port}`;
  return workId === undefined ? `${base}/` : `${base}/w/${encodeURIComponent(workId)}`;
}

/** The command that opens `url` in the default browser on `platform`, without a shell. */
export function openerCommand(platform: NodeJS.Platform, url: string): [string, string[]] {
  if (platform === "darwin") return ["open", [url]];
  if (platform === "win32") return ["rundll32", ["url.dll,FileProtocolHandler", url]];
  return ["xdg-open", [url]];
}

function openWithSystem(url: string): void {
  const [command, args] = openerCommand(process.platform, url);
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // No opener available: the printed URL is still there to click.
  }
}

/** Resolve true once `url` answers any HTTP status; false after `timeoutMs` or an abort. */
async function waitForServer(
  url: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !signal.aborted) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(5000) });
      return true;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    }
  }
  return false;
}

/** Whether nothing listens on `port` on the loopback interface. */
export async function isPortFree(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolveFree) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolveFree(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolveFree(true)));
  });
}

/** Parsed `toony studio` arguments. */
export interface StudioArgs {
  path?: string;
  port?: number;
  open: boolean;
}

export function parseStudioArgs(args: readonly string[]): StudioArgs | { error: string } {
  let port: number | undefined;
  let open = true;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--port") {
      const value = args[++i];
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
        return { error: `invalid --port value: ${value ?? "(missing)"}` };
      }
      port = parsed;
    } else if (arg === "--no-open") {
      open = false;
    } else if (arg?.startsWith("-")) {
      return { error: `unknown option: ${arg}` };
    } else if (arg !== undefined) {
      positional.push(arg);
    }
  }
  if (positional.length > 1) return { error: `unexpected argument: ${positional[1]}` };
  return {
    ...(positional[0] === undefined ? {} : { path: positional[0] }),
    ...(port === undefined ? {} : { port }),
    open,
  };
}

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

/**
 * Locate the bundled standalone studio server shipped inside the installed CLI
 * package. The packaging script (`scripts/bundle-studio.mjs`) places it at
 * `<pkg>/studio/apps/studio/server.js`; this module's bundle lives at `<pkg>/dist/`,
 * so the server sits one level up under `studio/`. Returns the absolute path when
 * present (installed mode), or null when running in-repo.
 */
async function findBundledStudioServer(): Promise<string | null> {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidate = join(moduleDir, "..", "studio", "apps", "studio", "server.js");
  try {
    await access(candidate);
    return candidate;
  } catch {
    return null;
  }
}

/**
 * Ask the OS for a free TCP port (bind to 0, read the assigned port, release).
 * Used so the bundled studio can launch on a non-colliding port by default.
 */
async function findFreePort(): Promise<number> {
  return await new Promise<number>((resolvePort, rejectPort) => {
    const server = createServer();
    server.unref();
    server.on("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        rejectPort(new Error("could not determine a free port"));
        return;
      }
      const { port } = address;
      server.close(() => resolvePort(port));
    });
  });
}

/** Run `toony studio`. Resolves on the studio server's exit code. */
export async function runStudio(args: string[], io: StudioIo): Promise<number> {
  const parsed = parseStudioArgs(args);
  if ("error" in parsed) {
    io.err(parsed.error);
    return EXIT_USAGE;
  }
  const explicitPort = parsed.port;
  let workId: string | undefined;

  // A path argument is resolved; with no argument, default to opening the
  // configured/default workspace (the studio resolves it from the environment).
  const explicitPath = parsed.path;
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
      workId = basename(target);
    } else {
      // The path is a workspace root (a parent of many works). The studio scans
      // it for works; a non-existent dir is treated as an empty workspace.
      studioEnv.TOONY_WORKSPACE_DIR = target;
      io.out(`workspace: ${target}`);
    }
  } else {
    io.out("workspace: (default — TOONY_WORKSPACE_DIR or ~/Documents/Toony)");
  }

  // Open the page once the server answers, so the browser never shows a
  // connection error while Next is still starting. Waiting stops when the
  // server exits.
  const waiting = new AbortController();
  const openWhenReady = (port: number): void => {
    if (!parsed.open) return;
    const url = studioUrl(port, workId);
    void waitForServer(studioUrl(port), OPEN_WAIT_MS, waiting.signal).then((ready) => {
      if (ready) (io.openUrl ?? openWithSystem)(url);
      else if (!waiting.signal.aborted) io.out(`open ${url} in your browser`);
    });
  };

  // Mode selection:
  //   - In-repo (a pnpm workspace root is found above this module): run the Next
  //     dev server so contributors get hot reload, exactly as before.
  //   - Installed (no workspace; the bundled standalone studio is present): run
  //     the self-contained server on a free port (or `--port`).
  const repoRoot = await findRepoRoot(dirname(fileURLToPath(import.meta.url)));
  if (repoRoot !== null) {
    const port = explicitPort ?? DEFAULT_DEV_PORT;
    io.out(`studio: ${studioUrl(port, workId)}`);
    io.out("press Ctrl+C to stop");
    openWhenReady(port);

    return await new Promise<number>((resolveExit) => {
      const child = spawn(
        "pnpm",
        [
          "--filter",
          "@toony/studio",
          "exec",
          "next",
          "dev",
          "--hostname",
          "127.0.0.1",
          "--port",
          String(port),
        ],
        {
          cwd: repoRoot,
          stdio: "inherit",
          env: { ...process.env, ...studioEnv },
        },
      );
      child.on("error", (cause) => {
        waiting.abort();
        io.err(`failed to start studio: ${cause.message}`);
        resolveExit(EXIT_USAGE);
      });
      child.on("exit", (code) => {
        waiting.abort();
        resolveExit(code ?? EXIT_OK);
      });
    });
  }

  // Installed mode: launch the bundled standalone server.
  const bundledServer = await findBundledStudioServer();
  if (bundledServer === null) {
    io.err("cannot locate the studio app (no bundled studio and no pnpm workspace root found)");
    return EXIT_USAGE;
  }

  // A stable port keeps the browser's per-site settings (theme, panel width)
  // across launches; another server on it means a free port instead.
  const port =
    explicitPort ??
    ((await isPortFree(DEFAULT_STUDIO_PORT)) ? DEFAULT_STUDIO_PORT : await findFreePort());
  io.out(`studio: ${studioUrl(port, workId)}`);
  io.out("press Ctrl+C to stop");
  openWhenReady(port);
  return await new Promise<number>((resolveExit) => {
    const child = spawn(process.execPath, [bundledServer], {
      // Run from the server's own directory so its relative `distDir`,
      // `.next/static`, and `public/` resolve correctly.
      cwd: dirname(bundledServer),
      stdio: "inherit",
      env: {
        ...process.env,
        ...studioEnv,
        PORT: String(port),
        HOSTNAME: "127.0.0.1",
      },
    });
    child.on("error", (cause) => {
      waiting.abort();
      io.err(`failed to start studio: ${cause.message}`);
      resolveExit(EXIT_USAGE);
    });
    child.on("exit", (code) => {
      waiting.abort();
      resolveExit(code ?? EXIT_OK);
    });
  });
}
