// Private files of the agent runtime: folders are 0700, files 0600, writes are
// atomic (unique temp file, fsync, rename), reads refuse symlinks and bound the
// size. Nothing here follows a link out of the folder it was given.

import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AgentError } from "./types.js";

/** Create `dir` (and parents) privately, and refuse a symlink in its place. */
export async function privateDir(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const info = await lstat(dir);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new AgentError("storage", "The agent's local storage is unavailable.", 500);
  }
  if ((info.mode & 0o077) !== 0) await chmod(dir, 0o700).catch(() => {});
  return dir;
}

/** Write text atomically with mode 0600. */
export async function writePrivateFile(file: string, text: string | Uint8Array): Promise<void> {
  await privateDir(dirname(file));
  const temp = join(dirname(file), `.${randomUUID()}.tmp`);
  try {
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(text);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
}

export async function writePrivateJson(file: string, value: unknown): Promise<void> {
  await writePrivateFile(file, `${JSON.stringify(value)}\n`);
}

/** Read a regular file (no symlink) of at most `limit` bytes; null when it does not exist. */
export async function readPrivateFile(
  file: string,
  limit = 4 * 1024 * 1024,
): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw new AgentError("storage", "The agent's local storage could not be read.", 500);
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) {
      throw new AgentError("storage", "The agent's local storage could not be read.", 500);
    }
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

export async function readPrivateJson(file: string, limit?: number): Promise<unknown> {
  const text = await readPrivateFile(file, limit);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Serialize async work per key (one writer per file). Kept on globalThis across bundles. */
const queueGlobal = globalThis as typeof globalThis & {
  toonyAgentQueues?: Map<string, Promise<unknown>>;
};
queueGlobal.toonyAgentQueues ??= new Map();
const queues = queueGlobal.toonyAgentQueues;

export function serialized<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const result = previous.then(action, action);
  const settled = result.then(
    () => {},
    () => {},
  );
  queues.set(key, settled);
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
  return result;
}
