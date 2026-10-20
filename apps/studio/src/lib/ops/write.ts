// The single write path for Studio: every change a person, a tab or the agent
// makes to a project runs through `withProjectWrite`.
//
//   1. take the project's lock (one writer at a time, per canonical root);
//   2. load the project as it is now, as the validation baseline;
//   3. snapshot every file and folder the plan names into `.toony/history/<changeId>/`;
//   4. run the change;
//   5. if nothing changed on disk, drop the snapshot and report no change;
//   6. reload and refuse any NEW validation error in the touched scope;
//   7. write the manifest, append the journal, prune old snapshots, and
//      publish a `project` event on the live bus.
// Any failure in 4-6 restores the snapshot before the error surfaces.
//
// `undoChange` reverses a change from its snapshot when nothing written later
// depends on it, and records the undo the same way.

import { randomBytes } from "node:crypto";
import { realpath } from "node:fs/promises";
import { type LoadedProject, loadProject, ProjectIoError } from "@toony/project-io";
import type { ValidationIssue } from "@toony/schema";
import type { ChangeScope, ProjectChange } from "../agent/protocol.js";
import { liveBus } from "../live/bus.js";
import { OpError } from "./errors.js";
import {
  type ChangeManifest,
  discardSnapshot,
  listManifests,
  MANIFEST_FORMAT,
  pruneHistory,
  readManifest,
  recordAfter,
  restoreSnapshot,
  type SnapshotEntry,
  signatureOf,
  takeSnapshot,
  writeManifest,
} from "./history.js";
import { appendJournal } from "./journal.js";
import { withLock } from "./lock.js";

/** Who is writing, and to which work. */
export interface OpContext {
  workId: string;
  /** The work's absolute root, resolved from `workId` through the workspace. */
  root: string;
  actor: "agent" | "human";
  conversationId?: string;
  /** The browser tab that asked, for human writes. */
  clientId?: string;
}

/** What a write may touch, declared before it runs. */
export interface WritePlan {
  summary: string;
  scopes: ChangeScope[];
  /** Project-relative files the write may create, replace or remove. */
  files?: string[];
  /** Project-relative folders the write may create or remove as a whole. */
  trees?: string[];
  /** False for a change that cannot be undone. Defaults to true. */
  undoable?: boolean;
  /**
   * How errors from the change surface after the snapshot is restored:
   * `"op-error"` (default) wraps anything that is not an `OpError` in a
   * generic, path-free `OpError`; `"as-is"` rethrows the original error, for
   * the older routes whose callers already map their own errors.
   */
  errors?: "op-error" | "as-is";
}

export interface WriteContext {
  root: string;
  changeId: string;
  /** The project as loaded before the change. */
  before: LoadedProject;
  /** Replace the summary once the change knows more (for example a created id). */
  setSummary: (summary: string) => void;
  /** Add a scope the change turned out to touch. */
  addScope: (scope: ChangeScope) => void;
  /**
   * Snapshot more project-relative paths before writing them, for a change that
   * learns what it touches only after reading the project. Already tracked
   * paths are skipped.
   */
  track: (paths: readonly string[], kind?: "file" | "tree") => Promise<void>;
}

export interface WriteOutcome<T> {
  result: T;
  /** The recorded change, or null when nothing was written. */
  change: ProjectChange | null;
}

// Route handlers are bundled separately, so process-wide state lives on globalThis.
const writeGlobal = globalThis as typeof globalThis & { toonyChangeCounter?: number };

function tick(): number {
  writeGlobal.toonyChangeCounter = ((writeGlobal.toonyChangeCounter ?? 0) + 1) % 1296;
  return writeGlobal.toonyChangeCounter;
}

/** A new change id: time-ordered, path safe, unique. */
export function newChangeId(): string {
  return `c${Date.now().toString(36)}${tick().toString(36).padStart(2, "0")}-${randomBytes(3).toString("hex")}`;
}

function nextOrder(): number {
  return Date.now() * 1000 + (tick() % 1000);
}

/** Whether two project-relative paths are the same, or one is a folder holding the other. */
function samePlace(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

/** Scopes as the issue-path prefixes they own, keyed by episode id rather than index. */
function stableIssues(loaded: LoadedProject): Array<{ key: string; issue: ValidationIssue }> {
  const ids = loaded.project.episodes.map((bundle) => bundle.episode?.id ?? "");
  return loaded.validation.issues.map((issue) => ({
    key: issue.path.replace(/^episodes\[(\d+)\]/, (_, index: string) => {
      const id = ids[Number(index)];
      return id === undefined ? `episodes[${index}]` : `episodes{${id}}`;
    }),
    issue,
  }));
}

function inScope(key: string, scopes: readonly ChangeScope[]): boolean {
  return scopes.some((scope) => {
    switch (scope.kind) {
      case "work":
      case "story":
      case "characters":
        return key.startsWith("webtoon");
      case "episodes":
        return key.startsWith("episodes") || key.startsWith("project");
      case "export":
        return false;
      default:
        return key.startsWith(`episodes{${scope.episodeId}}`);
    }
  });
}

function newIssues(
  before: LoadedProject,
  after: LoadedProject,
  scopes: readonly ChangeScope[],
): ValidationIssue[] {
  const known = new Set(stableIssues(before).map(({ key, issue }) => `${key}|${issue.code}`));
  return stableIssues(after)
    .filter(({ key, issue }) => inScope(key, scopes) && !known.has(`${key}|${issue.code}`))
    .map(({ issue }) => issue);
}

function failureOf(error: unknown, mode: WritePlan["errors"]): unknown {
  if (error instanceof OpError || mode === "as-is") return error;
  if (error instanceof ProjectIoError) {
    return new OpError("failed", "Toony could not read or write this project's files.", {
      cause: error,
    });
  }
  return new OpError("failed", "Toony could not save this change. Nothing was changed.", {
    cause: error,
  });
}

function describeIssues(issues: readonly ValidationIssue[]): string {
  const shown = issues.slice(0, 3).map((issue) => issue.message.replace(/\.$/, ""));
  const more = issues.length > 3 ? ` (and ${issues.length - 3} more)` : "";
  return `This change would leave the project with errors: ${shown.join("; ")}${more}.`;
}

function publish(change: ProjectChange): void {
  liveBus().publish({ type: "project", change });
}

/** The canonical root a lock and a snapshot key on. */
export async function canonicalRoot(root: string): Promise<string> {
  try {
    return await realpath(root);
  } catch (cause) {
    throw new OpError("not-found", "This webtoon is not in the workspace.", { cause });
  }
}

/** Run one change under the project's lock, with snapshot, validation, journal and event. */
export async function withProjectWrite<T>(
  ctx: OpContext,
  plan: WritePlan,
  fn: (tx: WriteContext) => Promise<T>,
): Promise<WriteOutcome<T>> {
  // Queue on the path as given before any await, so writes to one project run
  // in the order they were requested; the canonical lock inside also covers
  // the same project reached through another path.
  return withLock(`request:${ctx.root}`, async () => {
    const root = await canonicalRoot(ctx.root);
    return writeUnderLock(ctx, root, plan, fn);
  });
}

async function writeUnderLock<T>(
  ctx: OpContext,
  root: string,
  plan: WritePlan,
  fn: (tx: WriteContext) => Promise<T>,
): Promise<WriteOutcome<T>> {
  return withLock(root, async () => {
    let before: LoadedProject;
    try {
      before = await loadProject(root);
    } catch (error) {
      throw failureOf(error, plan.errors);
    }
    const changeId = newChangeId();
    const scopes = [...plan.scopes];
    let summary = plan.summary;
    const paths = [
      ...(plan.trees ?? []).map((path) => ({ path, kind: "tree" as const })),
      ...(plan.files ?? []).map((path) => ({ path, kind: "file" as const })),
    ];
    let entries: SnapshotEntry[] = [];
    let result: T;
    try {
      entries = await takeSnapshot(root, changeId, paths);
      result = await fn({
        root,
        changeId,
        before,
        setSummary: (text) => {
          summary = text;
        },
        addScope: (scope) => {
          if (!scopes.some((known) => JSON.stringify(known) === JSON.stringify(scope))) {
            scopes.push(scope);
          }
        },
        track: async (more, kind = "file") => {
          const fresh = more
            .filter((path) => !entries.some((entry) => entry.path === path))
            .map((path) => ({ path, kind }));
          entries.push(...(await takeSnapshot(root, changeId, fresh)));
        },
      });
      const changed = await recordAfter(root, entries);
      if (!changed) {
        await discardSnapshot(root, changeId);
        return { result, change: null };
      }
      let after: LoadedProject;
      try {
        after = await loadProject(root);
      } catch (cause) {
        throw new OpError("invalid", "This change would leave the project unreadable.", { cause });
      }
      const issues = newIssues(before, after, scopes);
      if (issues.length > 0) throw new OpError("invalid", describeIssues(issues));
    } catch (error) {
      try {
        await restoreSnapshot(root, changeId, entries);
      } finally {
        await discardSnapshot(root, changeId).catch(() => {});
      }
      throw failureOf(error, plan.errors);
    }

    const at = new Date().toISOString();
    const undoable = plan.undoable !== false;
    const manifest: ChangeManifest = {
      manifestFormat: MANIFEST_FORMAT,
      changeId,
      order: nextOrder(),
      at,
      kind: "change",
      actor: ctx.actor,
      summary,
      scopes,
      entries,
      undoable,
      ...(ctx.conversationId === undefined ? {} : { conversationId: ctx.conversationId }),
    };
    await writeManifest(root, manifest);
    await appendJournal(root, {
      changeId,
      at,
      actor: ctx.actor,
      summary,
      scopes,
      files: entries.filter((e) => e.after !== e.before).map((e) => e.path),
      ...(ctx.conversationId === undefined ? {} : { conversationId: ctx.conversationId }),
    });
    await pruneHistory(root).catch(() => {});
    const change: ProjectChange = {
      workId: ctx.workId,
      changeId,
      actor: ctx.actor,
      summary,
      scopes,
      at,
      ...(ctx.conversationId === undefined ? {} : { conversationId: ctx.conversationId }),
      ...(ctx.clientId === undefined ? {} : { clientId: ctx.clientId }),
      ...(undoable ? {} : { undoable: false }),
    };
    publish(change);
    return { result, change };
  });
}

/**
 * Reverse `changeId`. Refused when the change is unknown or too old to keep,
 * was already undone, cannot be undone, or when any file it wrote has changed
 * since: "Newer edits depend on this change." when a later Studio change wrote
 * it (undo that one first), otherwise because something outside Studio did.
 */
export async function undoChange(ctx: OpContext, changeId: string): Promise<ProjectChange> {
  const root = await canonicalRoot(ctx.root);
  return withLock(root, async () => {
    const target = await readManifest(root, changeId);
    if (target === null || target.kind !== "change") {
      throw new OpError("not-found", "This change can no longer be undone.");
    }
    if (target.undoneBy !== undefined)
      throw new OpError("refused", "This change was already undone.");
    if (!target.undoable) throw new OpError("refused", "This change cannot be undone.");

    const written = target.entries.filter((entry) => entry.after !== entry.before);
    const moved: SnapshotEntry[] = [];
    for (const entry of written) {
      if ((await signatureOf(root, entry)) !== entry.after) moved.push(entry);
    }
    if (moved.length > 0) {
      const later = (await listManifests(root)).filter(
        (m) =>
          m.order > target.order &&
          m.kind === "change" &&
          m.undoneBy === undefined &&
          m.entries.some(
            (entry) =>
              entry.after !== entry.before && moved.some((own) => samePlace(own.path, entry.path)),
          ),
      );
      throw new OpError(
        "stale",
        later.length > 0
          ? "Newer edits depend on this change. Undo those first."
          : "These files changed after this change, so it cannot be undone.",
      );
    }

    const undoId = newChangeId();
    const entries = await takeSnapshot(
      root,
      undoId,
      written.map(({ path, kind }) => ({ path, kind })),
    );
    try {
      await restoreSnapshot(root, changeId, written);
      await recordAfter(root, entries);
    } catch (error) {
      try {
        await restoreSnapshot(root, undoId, entries);
      } finally {
        await discardSnapshot(root, undoId).catch(() => {});
      }
      throw failureOf(error, "op-error");
    }

    const at = new Date().toISOString();
    const summary = `Undid: ${target.summary}`;
    await writeManifest(root, {
      manifestFormat: MANIFEST_FORMAT,
      changeId: undoId,
      order: nextOrder(),
      at,
      kind: "undo",
      actor: ctx.actor,
      summary,
      scopes: target.scopes,
      entries,
      undoable: false,
      undoes: changeId,
      ...(ctx.conversationId === undefined ? {} : { conversationId: ctx.conversationId }),
    });
    await writeManifest(root, { ...target, undoneBy: undoId });
    await appendJournal(root, {
      changeId: undoId,
      at,
      actor: ctx.actor,
      summary,
      scopes: target.scopes,
      files: written.map((entry) => entry.path),
      undoes: changeId,
      ...(ctx.conversationId === undefined ? {} : { conversationId: ctx.conversationId }),
    });
    await pruneHistory(root).catch(() => {});
    const change: ProjectChange = {
      workId: ctx.workId,
      changeId: undoId,
      actor: ctx.actor,
      summary,
      scopes: target.scopes,
      at,
      undoes: changeId,
      undoable: false,
      ...(ctx.conversationId === undefined ? {} : { conversationId: ctx.conversationId }),
      ...(ctx.clientId === undefined ? {} : { clientId: ctx.clientId }),
    };
    publish(change);
    return change;
  });
}
