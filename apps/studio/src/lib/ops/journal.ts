// The change journal: `<project>/.toony/agent/journal.jsonl`, one JSON line per
// change or undo, written by Studio's write path only. It travels with the
// project, so a new agent session can read what happened and who did it. The
// file rotates to `journal.1.jsonl` at 2 MB. The folder is private (0700).

import { appendFile, chmod, mkdir, readFile, rename, stat } from "node:fs/promises";
import type { ChangeScope } from "../agent/protocol.js";
import { projectPath } from "./paths.js";

export const AGENT_DIR = ".toony/agent";
export const JOURNAL_FILE = `${AGENT_DIR}/journal.jsonl`;
export const JOURNAL_ROTATED = `${AGENT_DIR}/journal.1.jsonl`;
export const JOURNAL_ROTATE_BYTES = 2 * 1024 * 1024;

export interface JournalEntry {
  changeId: string;
  at: string;
  actor: "agent" | "human";
  summary: string;
  scopes: ChangeScope[];
  /** Project-relative paths the change wrote. */
  files: string[];
  conversationId?: string;
  /** Set on an undo entry: the change it reversed. */
  undoes?: string;
}

export async function appendJournal(root: string, entry: JournalEntry): Promise<void> {
  const dir = projectPath(root, AGENT_DIR);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = projectPath(root, JOURNAL_FILE);
  try {
    if ((await stat(file)).size >= JOURNAL_ROTATE_BYTES) {
      await rename(file, projectPath(root, JOURNAL_ROTATED));
    }
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
  }
  await appendFile(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  await chmod(file, 0o600).catch(() => {});
}

function parseLines(text: string): JournalEntry[] {
  const entries: JournalEntry[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const value = JSON.parse(line);
      if (value && typeof value.changeId === "string" && typeof value.summary === "string") {
        entries.push(value as JournalEntry);
      }
    } catch {
      // A torn last line (crash mid-append) is skipped.
    }
  }
  return entries;
}

/** The newest `limit` journal entries, oldest first, across the rotated file too. */
export async function readJournal(root: string, limit = 200): Promise<JournalEntry[]> {
  const read = async (path: string) => {
    try {
      return parseLines(await readFile(projectPath(root, path), "utf8"));
    } catch {
      return [];
    }
  };
  const current = await read(JOURNAL_FILE);
  const older = current.length >= limit ? [] : await read(JOURNAL_ROTATED);
  return [...older, ...current].slice(-limit);
}
