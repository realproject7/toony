// Atomic, crash-safe writes for persisted workspace files.
//
// Toony is local-first: the workspace files are the ONLY copy of the user's
// work, so a crash or power-loss mid-write must never truncate a file that was
// previously intact. Every persisted write in this package goes through the
// helpers here: they stage bytes into a sibling `<file>.tmp` and then `rename`
// it over the target. A same-directory rename is atomic on POSIX, so a reader
// (or a crash) observes either the whole old file or the whole new file — never
// a partial mix. `writeFile` must fully succeed before the rename, so a failure
// mid-write leaves the original target untouched.
//
// These helpers do NOT coordinate concurrent writers: file locking and
// multi-process safety are out of scope (#144). Because the temp file uses a
// fixed `.tmp` sibling name, two concurrent atomic writes to the same target
// race on that temp file — callers must serialize writes to one path.

import { rename, rm, writeFile } from "node:fs/promises";

/** Suffix of the sibling temp file an atomic write stages into. */
const TMP_SUFFIX = ".tmp";

/** One file's worth of bytes for a batched atomic write. */
export interface AtomicFileWrite {
  /** Absolute path of the target file to replace atomically. */
  file: string;
  /** Bytes to write (UTF-8 string or binary). */
  data: string | Uint8Array;
}

function tmpPathFor(file: string): string {
  return `${file}${TMP_SUFFIX}`;
}

/**
 * Write `data` to `file` atomically: stage into `<file>.tmp`, then rename over
 * the target. A crash or error before the rename leaves the original `file`
 * (if it existed) intact rather than truncated.
 */
export async function atomicWrite(file: string, data: string | Uint8Array): Promise<void> {
  await atomicWriteAll([{ file, data }]);
}

/**
 * Write several files as a single write-unit: stage EVERY file into its
 * `<file>.tmp` sibling first, then rename them into place in the given order.
 * Nothing is renamed until all temps are written, so a failure while staging
 * leaves every target untouched.
 *
 * Ordering matters when the files cross-reference each other: list a
 * referenced-record file BEFORE the file that references it, so a crash between
 * renames leaves at worst an orphaned record (which validation reports as
 * non-fatal) rather than a dangling reference. This is not a transaction — a
 * crash mid-commit can still leave some files renamed and others not — but the
 * ordering bounds that window to the benign direction, and each individual
 * rename is atomic.
 */
export async function atomicWriteAll(writes: readonly AtomicFileWrite[]): Promise<void> {
  const staged: Array<{ tmp: string; file: string }> = [];
  try {
    for (const { file, data } of writes) {
      const tmp = tmpPathFor(file);
      await writeFile(tmp, data);
      staged.push({ tmp, file });
    }
  } catch (cause) {
    // Staging failed before any rename, so the original targets are untouched.
    // Drop temps we already wrote; ignore cleanup errors so the original write
    // failure is what surfaces to the caller.
    await Promise.all(staged.map(({ tmp }) => rm(tmp, { force: true }).catch(() => {})));
    throw cause;
  }

  // All temps staged: commit with atomic renames in the caller-chosen order.
  for (const { tmp, file } of staged) {
    await rename(tmp, file);
  }
}
