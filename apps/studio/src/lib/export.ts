// Server-side export page data: the exports already on disk for an episode,
// shown when the page opens, and whether each is out of date.

import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { BUILTIN_OUTPUTS, episodeInputsHash, MANIFEST_FILE } from "@toony/export";
import type { ExportJobView } from "./agent/protocol.js";
import { readExportFolder } from "./export-download.js";
import { resultFromManifest } from "./export-jobs.js";

/** A finished export found on disk, in the shape a completed job reports. */
export interface SavedExport extends ExportJobView {
  /** True when the episode changed after these files were written. */
  outOfDate: boolean;
}

/** The latest export of every built-in output of an episode, by output id. */
export async function savedExports(
  workId: string,
  workRoot: string,
  episodeId: string,
): Promise<Record<string, SavedExport>> {
  const current = await episodeInputsHash(workRoot, episodeId);
  const saved: Record<string, SavedExport> = {};
  for (const output of BUILTIN_OUTPUTS) {
    let folder: Awaited<ReturnType<typeof readExportFolder>>;
    try {
      folder = await readExportFolder(workRoot, episodeId, output.id);
    } catch {
      folder = null;
    }
    if (!folder) continue;
    const finishedAt = (await lstat(join(folder.dir, MANIFEST_FILE))).mtime.toISOString();
    const files = folder.manifest.files.length;
    saved[output.id] = {
      id: `saved-${output.id}`,
      workId,
      episodeId,
      output: output.id,
      state: "completed",
      progress: { done: files, total: files },
      finishedAt,
      ...resultFromManifest(workId, folder.manifest),
      outOfDate: current !== null && current !== folder.manifest.inputs.sha256,
    };
  }
  return saved;
}
