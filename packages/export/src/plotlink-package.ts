// Publish only fully encoded packages. A failed fit never touches old outputs.
import { cp, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ExportError } from "./errors.js";
import { type ExportManifest, MANIFEST_FILE, validateManifest } from "./manifest.js";

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Only a valid previous manifest establishes ownership; never glob user files. */
async function ownedFiles(outDir: string, relativeDir: string): Promise<Set<string>> {
  if (!(await exists(join(outDir, MANIFEST_FILE)))) return new Set();
  try {
    const previous: unknown = JSON.parse(await readFile(join(outDir, MANIFEST_FILE), "utf8"));
    if (validateManifest(previous).length !== 0) return new Set();
    const manifest = previous as ExportManifest;
    if (manifest.target !== "plotlink") return new Set();
    const names = new Set([MANIFEST_FILE]);
    for (const file of manifest.files) {
      const name = file.path.slice(relativeDir.length + 1);
      if (file.path === `${relativeDir}/${name}` && /^\d{3}\.webp$/.test(name)) names.add(name);
    }
    if (manifest.markdown?.path === `${relativeDir}/episode.md`) names.add("episode.md");
    return names;
  } catch (error) {
    if (error instanceof SyntaxError) return new Set();
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
    for (const name of owned) {
      // Unlink first, including symlinks, instead of writing through old paths.
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
