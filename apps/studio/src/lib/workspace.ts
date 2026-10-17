// Server-side workspace resolution for the studio app.
//
// Toony Studio v2 opens over a WORKSPACE root (a parent folder holding many
// works); the library at `/` lists every work and each work's pages live under
// `/w/<id>/...`. This module is the single server-only place that:
//   - resolves the workspace root from the environment (`TOONY_WORKSPACE_DIR`,
//     default `~/Documents/Toony`, with `~` expansion);
//   - preserves back-compat with the old single-project launch
//     (`TOONY_PROJECT_DIR`): its PARENT is treated as the workspace, so a single
//     `toony studio <path>` still shows that work in the library and opens it;
//   - resolves a `<workId>` from a URL/body to an absolute work directory
//     PATH-SAFELY — by exact match against the workspace scan, never by joining
//     raw input into a path.
//
// Route handlers and server components call `resolveWork` to turn an untrusted
// `workId` into a concrete root, then hand that root to the view-model helpers in
// `@/lib/project`. No env reading or path resolution happens anywhere else.

import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { listWorkspace, type WorkspaceEntry } from "@toony/project-io";

/** Default workspace root when no environment override is set. */
const DEFAULT_WORKSPACE = join("~", "Documents", "Toony");

/** Expand a leading `~` (or `~/...`, `~\...`) to the current user's home directory. */
function expandHome(input: string): string {
  if (input === "~") return homedir();
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return join(homedir(), input.slice(2));
  }
  return input;
}

/**
 * The absolute workspace root directory.
 *
 * Precedence: `TOONY_WORKSPACE_DIR` (explicit) wins; otherwise a single-project
 * launch (`TOONY_PROJECT_DIR`) uses that project's PARENT as the workspace so the
 * old entry point keeps working; otherwise the default `~/Documents/Toony`.
 */
export function workspaceRoot(): string {
  const workspaceEnv = process.env.TOONY_WORKSPACE_DIR;
  if (workspaceEnv && workspaceEnv.length > 0) {
    return resolve(expandHome(workspaceEnv));
  }
  const projectEnv = process.env.TOONY_PROJECT_DIR;
  if (projectEnv && projectEnv.length > 0) {
    return dirname(resolve(expandHome(projectEnv)));
  }
  return resolve(expandHome(DEFAULT_WORKSPACE));
}

/**
 * The work id of a back-compat single-project launch, or null in workspace mode.
 * Used to deep-link straight into that one work and to surface it in the library.
 */
export function singleProjectWorkId(): string | null {
  if (process.env.TOONY_WORKSPACE_DIR && process.env.TOONY_WORKSPACE_DIR.length > 0) {
    return null;
  }
  const projectEnv = process.env.TOONY_PROJECT_DIR;
  if (!projectEnv || projectEnv.length === 0) return null;
  return basename(resolve(expandHome(projectEnv)));
}

/** Scan the workspace for every work (deterministic, id-sorted). */
export async function listWorks(): Promise<WorkspaceEntry[]> {
  return listWorkspace(workspaceRoot());
}

/** A resolved work: its id and its absolute root directory in the workspace. */
export interface ResolvedWork {
  id: string;
  root: string;
}

/**
 * Resolve an untrusted `workId` to an absolute work directory, PATH-SAFELY.
 *
 * The id is matched EXACTLY against the workspace scan's ids — it is never joined
 * into a filesystem path from raw input, so `..`, absolute paths, and separators
 * cannot escape the workspace. Returns null when no such work exists. The root is
 * derived from the workspace root + the validated id (which the scan guarantees
 * is a real immediate child folder containing a `webtoon.json`).
 */
export async function resolveWork(workId: string): Promise<ResolvedWork | null> {
  if (typeof workId !== "string" || workId.length === 0) return null;
  // Reject anything that is not a plain folder name up front; the exact-match
  // below is the real guard, but this makes the intent explicit and cheap.
  if (
    workId.includes("/") ||
    workId.includes("\\") ||
    workId.includes("\0") ||
    isAbsolute(workId)
  ) {
    return null;
  }
  const works = await listWorks();
  const match = works.find((entry) => entry.id === workId);
  if (!match) return null;
  return { id: match.id, root: join(workspaceRoot(), match.id) };
}
