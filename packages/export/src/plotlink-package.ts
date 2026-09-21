// Publish only fully encoded packages. A failed fit never touches old outputs.
import { constants } from "node:fs";
import { cp, lstat, mkdir, mkdtemp, open, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ExportError } from "./errors.js";
import {
  type ExportManifest,
  MANIFEST_FILE,
  PLOTLINK_MAX_BYTES,
  sha256Hex,
  validateManifest,
} from "./manifest.js";
import { PLOTLINK_MARKDOWN_MAX } from "./markdown.js";

function ownershipConflict(name: string): ExportError {
  return new ExportError(
    "plotlink.output-conflict",
    `The previous PlotLink "${name}" is missing, changed, or not a regular file. Move or restore it before exporting; no files were replaced.`,
  );
}

/** Never follow a claimed output symlink, including the previous manifest. */
async function readRegularFile(outDir: string, name: string, maxBytes: number): Promise<Buffer> {
  try {
    const path = join(outDir, name);
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

/** The previous manifest claims ownership; matching regular-file bytes prove it. */
async function ownedFiles(outDir: string, relativeDir: string): Promise<Map<string, OwnedFile>> {
  if (!(await exists(join(outDir, MANIFEST_FILE)))) return new Map();
  try {
    const manifestBytes = await readRegularFile(outDir, MANIFEST_FILE, 64 * 1024);
    const previous: unknown = JSON.parse(manifestBytes.toString("utf8"));
    if (validateManifest(previous).length !== 0) return new Map();
    const manifest = previous as ExportManifest;
    if (manifest.target !== "plotlink") return new Map();
    const names = new Map<string, OwnedFile>([
      [MANIFEST_FILE, { byteSize: manifestBytes.length, sha256: sha256Hex(manifestBytes) }],
    ]);
    for (const file of manifest.files) {
      const name = file.path.slice(relativeDir.length + 1);
      if (file.path === `${relativeDir}/${name}` && /^\d{3}\.webp$/.test(name)) {
        const bytes = await readRegularFile(outDir, name, PLOTLINK_MAX_BYTES);
        if (bytes.length !== file.byteSize || sha256Hex(bytes) !== file.sha256) {
          throw ownershipConflict(name);
        }
        names.set(name, { byteSize: file.byteSize, sha256: file.sha256 });
      }
    }
    if (manifest.markdown?.path === `${relativeDir}/episode.md`) {
      const bytes = await readRegularFile(outDir, "episode.md", PLOTLINK_MARKDOWN_MAX * 4);
      if (
        bytes.toString("utf8").length !== manifest.markdown.characters ||
        sha256Hex(bytes) !== manifest.markdown.sha256
      ) {
        throw ownershipConflict("episode.md");
      }
      names.set("episode.md", { byteSize: bytes.length, sha256: manifest.markdown.sha256 });
    }
    return names;
  } catch (error) {
    if (error instanceof SyntaxError) return new Map();
    throw error;
  }
}

/** Stage alongside the output, preserving unowned files, then swap directories. */
export async function writePlotlinkPackage(
  outDir: string,
  relativeDir: string,
  outputs: Map<string, string | Uint8Array>,
): Promise<void> {
  let stage: string | undefined;
  let backup: string | undefined;
  let published = false;
  try {
    const hadOutput = await exists(outDir);
    if (hadOutput && !(await lstat(outDir)).isDirectory()) {
      throw new ExportError("plotlink.output-conflict", "The PlotLink output must be a directory.");
    }
    const owned = await ownedFiles(outDir, relativeDir);
    for (const name of outputs.keys()) {
      if (!owned.has(name) && (await exists(join(outDir, name)))) {
        throw new ExportError(
          "plotlink.output-conflict",
          `The PlotLink output contains an unrelated "${name}". Move it before exporting; no files were replaced.`,
        );
      }
    }
    const parent = dirname(outDir);
    await mkdir(parent, { recursive: true });
    stage = await mkdtemp(join(parent, ".plotlink-stage-"));
    if (hadOutput) {
      await cp(outDir, stage, {
        recursive: true,
        preserveTimestamps: true,
        verbatimSymlinks: true,
      });
    }
    // Recheck the copied files against the original verified snapshot before
    // removing anything, so a changed file/symlink during cp cannot gain trust.
    for (const [name, expected] of owned) {
      const bytes = await readRegularFile(stage, name, expected.byteSize);
      if (bytes.length !== expected.byteSize || sha256Hex(bytes) !== expected.sha256) {
        throw ownershipConflict(name);
      }
    }
    for (const name of owned.keys()) {
      await rm(join(stage, name), { force: true });
    }
    for (const [name, data] of outputs) await writeFile(join(stage, name), data);
    if (hadOutput) {
      backup = await mkdtemp(join(parent, ".plotlink-previous-"));
      await rename(outDir, join(backup, "package"));
    }
    try {
      await rename(stage, outDir);
      published = true;
    } catch (error) {
      if (backup) await rename(join(backup, "package"), outDir);
      throw error;
    }
  } catch (error) {
    if (error instanceof ExportError) throw error;
    throw new ExportError("write-failed", "Could not replace the PlotLink package.");
  } finally {
    // A backup is only removed after success. If restoration failed, it remains
    // alongside the export rather than destroying the previous usable package.
    if (stage) await rm(stage, { recursive: true, force: true }).catch(() => {});
    if (backup && published) await rm(backup, { recursive: true, force: true }).catch(() => {});
  }
}
