// Publish a complete output folder atomically. Every file is encoded before
// anything on disk changes; the new folder is staged beside the old one and the
// two are swapped, so a failed export never changes the previous output.
//
// Ownership: a file may be replaced or removed only when the previous valid
// manifest in the folder lists it AND its current bytes still match the recorded
// size and SHA-256. Unrelated files are preserved. An unrelated file whose name
// collides with a new output stops the export. Symlinks are never followed.

import { constants } from "node:fs";
import { cp, lstat, mkdir, mkdtemp, open, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ExportError } from "./errors.js";
import { type ExportManifest, MANIFEST_FILE, sha256Hex, validateManifest } from "./manifest.js";

/** Largest previous manifest the publisher reads to prove ownership. */
const MANIFEST_BYTES_MAX = 8 * 1024 * 1024;

/** A file name an output may write: one plain path segment. */
const OUTPUT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function ownershipConflict(name: string): ExportError {
  return new ExportError(
    "export.output-conflict",
    `The previous export file "${name}" is missing, changed, or not a regular file. Move or restore it, then export again. No files were replaced.`,
  );
}

/** Read a regular file without following a symlink, bounded by `maxBytes`. */
async function readRegularFile(dir: string, name: string, maxBytes: number): Promise<Buffer> {
  try {
    const path = join(dir, name);
    if (!(await lstat(path)).isFile()) throw ownershipConflict(name);
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > maxBytes) throw ownershipConflict(name);
      // Bound the read even if another writer appends after stat. The extra
      // byte detects growth instead of hashing only the old file prefix.
      const bytes = Buffer.alloc(stat.size + 1);
      let length = 0;
      while (length < bytes.length) {
        const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
        if (bytesRead === 0) break;
        length += bytesRead;
      }
      if (length !== stat.size) throw ownershipConflict(name);
      return bytes.subarray(0, length);
    } finally {
      await file.close();
    }
  } catch {
    throw ownershipConflict(name);
  }
}

interface OwnedFile {
  byteSize: number;
  sha256: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** The previous manifest claims files; matching regular-file bytes prove it. */
async function ownedFiles(outDir: string, relativeDir: string): Promise<Map<string, OwnedFile>> {
  if (!(await exists(join(outDir, MANIFEST_FILE)))) return new Map();
  let previous: unknown;
  const manifestBytes = await readRegularFile(outDir, MANIFEST_FILE, MANIFEST_BYTES_MAX);
  try {
    previous = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    return new Map();
  }
  // A manifest this engine did not write (another version, another output) owns
  // nothing: its folder content is preserved as unrelated files.
  if (validateManifest(previous).length !== 0) return new Map();
  const manifest = previous as ExportManifest;
  const owned = new Map<string, OwnedFile>([
    [MANIFEST_FILE, { byteSize: manifestBytes.length, sha256: sha256Hex(manifestBytes) }],
  ]);
  for (const file of manifest.files) {
    const name = file.path.slice(relativeDir.length + 1);
    if (file.path !== `${relativeDir}/${name}` || !OUTPUT_NAME.test(name)) continue;
    const bytes = await readRegularFile(outDir, name, file.byteSize);
    if (bytes.length !== file.byteSize || sha256Hex(bytes) !== file.sha256) {
      throw ownershipConflict(name);
    }
    owned.set(name, { byteSize: file.byteSize, sha256: file.sha256 });
  }
  return owned;
}

/**
 * Replace the output folder `outDir` (project-relative `relativeDir`) with
 * `outputs` (file name to bytes). Previously owned files that are not part of the
 * new output are removed; everything else in the folder is kept.
 */
export async function publishExport(
  outDir: string,
  relativeDir: string,
  outputs: ReadonlyMap<string, string | Uint8Array>,
): Promise<void> {
  for (const name of outputs.keys()) {
    if (!OUTPUT_NAME.test(name)) {
      throw new ExportError("write-failed", `"${name}" is not a valid export file name.`);
    }
  }
  let stage: string | undefined;
  let backup: string | undefined;
  let published = false;
  try {
    const hadOutput = await exists(outDir);
    if (hadOutput && !(await lstat(outDir)).isDirectory()) {
      throw new ExportError("export.output-conflict", "The export folder must be a directory.");
    }
    const owned = hadOutput ? await ownedFiles(outDir, relativeDir) : new Map<string, OwnedFile>();
    for (const name of outputs.keys()) {
      if (!owned.has(name) && (await exists(join(outDir, name)))) {
        throw new ExportError(
          "export.output-conflict",
          `The export folder has an unrelated "${name}". Move it, then export again. No files were replaced.`,
        );
      }
    }
    const parent = dirname(outDir);
    await mkdir(parent, { recursive: true });
    stage = await mkdtemp(join(parent, ".toony-export-stage-"));
    if (hadOutput) {
      await cp(outDir, stage, {
        recursive: true,
        preserveTimestamps: true,
        verbatimSymlinks: true,
      });
    }
    // Recheck the copied files against the verified snapshot before removing
    // anything, so a file changed or swapped for a symlink during the copy cannot
    // gain trust.
    for (const [name, expected] of owned) {
      const bytes = await readRegularFile(stage, name, expected.byteSize);
      if (bytes.length !== expected.byteSize || sha256Hex(bytes) !== expected.sha256) {
        throw ownershipConflict(name);
      }
    }
    for (const name of owned.keys()) await rm(join(stage, name), { force: true });
    for (const [name, data] of outputs) await writeFile(join(stage, name), data);
    if (hadOutput) {
      backup = await mkdtemp(join(parent, ".toony-export-previous-"));
      await rename(outDir, join(backup, "output"));
    }
    try {
      await rename(stage, outDir);
      published = true;
    } catch (error) {
      if (backup) await rename(join(backup, "output"), outDir);
      throw error;
    }
  } catch (error) {
    if (error instanceof ExportError) throw error;
    throw new ExportError("write-failed", "Could not write the export folder.");
  } finally {
    // A backup is only removed after success. If restoration failed, it stays
    // beside the export rather than destroying the previous usable output.
    if (stage && !published) await rm(stage, { recursive: true, force: true }).catch(() => {});
    if (backup && published) await rm(backup, { recursive: true, force: true }).catch(() => {});
  }
}
