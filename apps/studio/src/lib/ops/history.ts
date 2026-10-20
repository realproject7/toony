// Undo snapshots: `<project>/.toony/history/<changeId>/`.
//
// Before a write runs, every file and folder its plan names is copied into
// `files/` (when it exists) and its content signature is recorded in
// `manifest.json`, together with whether it existed. After the write the new
// signatures are recorded too. Restoring puts back exactly the entries whose
// content differs from the snapshot: a file that existed gets its bytes back,
// one that did not is removed. Only the newest `HISTORY_KEEP` snapshots stay.

import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { cp, lstat, mkdir, readdir, readFile, readlink, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { atomicWrite } from "@toony/project-io";
import type { ChangeScope } from "../agent/protocol.js";
import { projectPath } from "./paths.js";

export const HISTORY_DIR = ".toony/history";
export const HISTORY_KEEP = 50;
export const MANIFEST_FORMAT = 1;

export interface SnapshotEntry {
  /** Project-relative path. */
  path: string;
  kind: "file" | "tree";
  existed: boolean;
  /** Content signature before the write; null when absent. */
  before: string | null;
  /** Content signature after the write; null when absent. */
  after?: string | null;
}

export interface ChangeManifest {
  manifestFormat: number;
  changeId: string;
  /** Sort key: later changes have larger orders. */
  order: number;
  at: string;
  kind: "change" | "undo";
  actor: "agent" | "human";
  summary: string;
  scopes: ChangeScope[];
  entries: SnapshotEntry[];
  undoable: boolean;
  conversationId?: string;
  /** For an undo: the change it reversed. */
  undoes?: string;
  /** Set on a change once it was undone. */
  undoneBy?: string;
}

function digest(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** sha256 of a file's bytes, or null when it does not exist. */
async function fileSignature(file: string): Promise<string | null> {
  try {
    return digest(await readFile(file));
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  }
}

/** One signature over every file under a folder: relative path and content, sorted. */
async function treeSignature(dir: string): Promise<string | null> {
  try {
    if (!(await lstat(dir)).isDirectory()) return digest(await readFile(dir));
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  }
  const lines: string[] = [];
  const walk = async (folder: string, rel: string): Promise<void> => {
    const entries: Dirent[] = await readdir(folder, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const next = rel === "" ? entry.name : `${rel}/${entry.name}`;
      const full = join(folder, entry.name);
      if (entry.isDirectory()) {
        lines.push(`d ${next}`);
        await walk(full, next);
      } else if (entry.isSymbolicLink()) {
        lines.push(`l ${next} ${await readlink(full)}`);
      } else {
        lines.push(`f ${next} ${digest(await readFile(full))}`);
      }
    }
  };
  await walk(dir, "");
  return digest(lines.join("\n"));
}

export async function signatureOf(root: string, entry: Pick<SnapshotEntry, "path" | "kind">) {
  const target = projectPath(root, entry.path);
  return entry.kind === "file" ? fileSignature(target) : treeSignature(target);
}

export function historyDir(root: string, changeId: string): string {
  return projectPath(root, `${HISTORY_DIR}/${changeId}`);
}

function storedPath(root: string, changeId: string, path: string): string {
  return join(historyDir(root, changeId), "files", path);
}

/** Copy the planned paths into the change's snapshot folder and record their state. */
export async function takeSnapshot(
  root: string,
  changeId: string,
  paths: ReadonlyArray<Pick<SnapshotEntry, "path" | "kind">>,
): Promise<SnapshotEntry[]> {
  const entries: SnapshotEntry[] = [];
  for (const { path, kind } of paths) {
    const before = await signatureOf(root, { path, kind });
    const existed = before !== null;
    if (existed) {
      const destination = storedPath(root, changeId, path);
      await mkdir(dirname(destination), { recursive: true });
      await cp(projectPath(root, path), destination, { recursive: kind === "tree" });
    }
    entries.push({ path, kind, existed, before });
  }
  return entries;
}

/** Record the signatures each entry has now. */
export async function recordAfter(root: string, entries: SnapshotEntry[]): Promise<boolean> {
  let changed = false;
  for (const entry of entries) {
    entry.after = await signatureOf(root, entry);
    if (entry.after !== entry.before) changed = true;
  }
  return changed;
}

/**
 * Put every entry back to its snapshot state, touching only entries whose
 * current content differs. Files are restored atomically; folders are replaced.
 */
export async function restoreSnapshot(
  root: string,
  changeId: string,
  entries: readonly SnapshotEntry[],
): Promise<void> {
  for (const entry of [...entries].reverse()) {
    const current = await signatureOf(root, entry);
    if (current === entry.before) continue;
    const target = projectPath(root, entry.path);
    if (!entry.existed) {
      await rm(target, { recursive: true, force: true });
      continue;
    }
    const stored = storedPath(root, changeId, entry.path);
    if (entry.kind === "file") {
      await mkdir(dirname(target), { recursive: true });
      await atomicWrite(target, await readFile(stored));
    } else {
      await rm(target, { recursive: true, force: true });
      await mkdir(dirname(target), { recursive: true });
      await cp(stored, target, { recursive: true });
    }
  }
}

export async function writeManifest(root: string, manifest: ChangeManifest): Promise<void> {
  const dir = historyDir(root, manifest.changeId);
  await mkdir(dir, { recursive: true });
  await atomicWrite(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function readManifest(root: string, changeId: string): Promise<ChangeManifest | null> {
  if (!/^[a-z0-9-]{6,80}$/.test(changeId)) return null;
  try {
    const value = JSON.parse(
      await readFile(join(historyDir(root, changeId), "manifest.json"), "utf8"),
    );
    if (value?.manifestFormat !== MANIFEST_FORMAT || value.changeId !== changeId) return null;
    return value as ChangeManifest;
  } catch {
    return null;
  }
}

/** Every readable manifest, oldest first. */
export async function listManifests(root: string): Promise<ChangeManifest[]> {
  let names: string[];
  try {
    names = await readdir(projectPath(root, HISTORY_DIR));
  } catch {
    return [];
  }
  const manifests: ChangeManifest[] = [];
  for (const name of names) {
    const manifest = await readManifest(root, name);
    if (manifest !== null) manifests.push(manifest);
  }
  return manifests.sort((a, b) => a.order - b.order);
}

export async function discardSnapshot(root: string, changeId: string): Promise<void> {
  await rm(historyDir(root, changeId), { recursive: true, force: true });
}

/** Remove snapshots beyond the newest `keep`, and any folder without a readable manifest. */
export async function pruneHistory(root: string, keep = HISTORY_KEEP): Promise<void> {
  let names: string[];
  try {
    names = await readdir(projectPath(root, HISTORY_DIR));
  } catch {
    return;
  }
  const manifests = await listManifests(root);
  const kept = new Set(manifests.slice(-keep).map((m) => m.changeId));
  for (const name of names) {
    if (!kept.has(name))
      await rm(join(projectPath(root, HISTORY_DIR), name), { recursive: true, force: true });
  }
}
