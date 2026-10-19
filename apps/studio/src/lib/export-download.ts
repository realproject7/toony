// Read access to exported files, for single downloads and "Download all".
//
// Only files the output's own manifest lists (plus the manifest) are served,
// from `episodes/<id>/exports/<output>/` of a resolved work. Ids are single safe
// path segments; the folder must resolve to exactly that place with no symlink
// on the way; each file must be a regular file (never followed through a
// symlink) whose bytes still match the manifest's size and SHA-256.

import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join } from "node:path";
import { type ExportManifest, MANIFEST_FILE, sha256Hex, validateManifest } from "@toony/export";
import { episodeExportRelDir, LEGACY_EXPORT_DIRS } from "@toony/project-io";
import { isPathSafeId } from "@toony/schema";
import { createZip, type ZipEntry } from "./zip.js";

/** An access failure with the HTTP status a route should answer with. */
export class ExportAccessError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MANIFEST_BYTES_MAX = 8 * 1024 * 1024;

/**
 * Downloads are read-only, but they must still come from this computer and this
 * page: a loopback host, and (when the browser sends fetch metadata) a
 * same-origin request or a direct navigation.
 */
export function assertLocalRead(request: Request): void {
  const url = new URL(request.url);
  const host = request.headers.get("host");
  let hostName: string | null = null;
  try {
    hostName = host ? new URL(`http://${host}`).hostname : null;
  } catch {
    hostName = null;
  }
  const site = request.headers.get("sec-fetch-site");
  if (
    !LOOPBACK.has(url.hostname) ||
    hostName === null ||
    !LOOPBACK.has(hostName) ||
    (site !== null && site !== "same-origin" && site !== "none")
  ) {
    throw new ExportAccessError(403, "Open downloads from your local Toony workspace.");
  }
}

/** Read a regular file without following a symlink, bounded by `maxBytes`. */
async function readRegular(path: string, maxBytes: number): Promise<Buffer | null> {
  try {
    if (!(await lstat(path)).isFile()) return null;
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > maxBytes) return null;
      const bytes = Buffer.alloc(stat.size + 1);
      let length = 0;
      while (length < bytes.length) {
        const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
        if (bytesRead === 0) break;
        length += bytesRead;
      }
      return length === stat.size ? bytes.subarray(0, length) : null;
    } finally {
      await file.close();
    }
  } catch {
    return null;
  }
}

export interface ExportFolder {
  manifest: ExportManifest;
  /** Bytes of `manifest.json` as stored. */
  manifestBytes: Buffer;
  /** Real absolute folder; never sent to a browser. */
  dir: string;
}

/**
 * Load an output's folder and manifest. Returns null when the output has not
 * been exported (or its manifest is not one this version wrote).
 */
export async function readExportFolder(
  workRoot: string,
  episodeId: string,
  output: string,
): Promise<ExportFolder | null> {
  if (
    !isPathSafeId(episodeId) ||
    !isPathSafeId(output) ||
    (LEGACY_EXPORT_DIRS as readonly string[]).includes(output)
  ) {
    throw new ExportAccessError(400, "This export does not exist.");
  }
  const rel = episodeExportRelDir(episodeId, output);
  let dir: string;
  try {
    const realRoot = await realpath(workRoot);
    dir = await realpath(join(workRoot, rel));
    // Every folder on the way must be the real one: no symlinked episode,
    // exports or output folder can redirect a download elsewhere.
    if (dir !== join(realRoot, rel)) {
      throw new ExportAccessError(400, "This export folder is not inside the work.");
    }
  } catch (cause) {
    if (cause instanceof ExportAccessError) throw cause;
    return null;
  }
  const manifestBytes = await readRegular(join(dir, MANIFEST_FILE), MANIFEST_BYTES_MAX);
  if (!manifestBytes) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    return null;
  }
  if (validateManifest(parsed).length > 0) return null;
  const manifest = parsed as ExportManifest;
  if (manifest.episodeId !== episodeId || manifest.output !== output) return null;
  return { manifest, manifestBytes, dir };
}

export interface ExportFileBytes {
  name: string;
  bytes: Uint8Array;
  contentType: string;
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function contentType(name: string): string {
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg")) return "image/jpeg";
  if (name.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

/** One file the manifest lists, verified against its recorded size and hash. */
async function verifiedFile(folder: ExportFolder, name: string): Promise<ExportFileBytes> {
  if (name === MANIFEST_FILE) {
    return { name, bytes: folder.manifestBytes, contentType: contentType(name) };
  }
  const rel = episodeExportRelDir(folder.manifest.episodeId, folder.manifest.output);
  const entry = folder.manifest.files.find((file) => file.path === `${rel}/${name}`);
  if (!entry || name.includes("/") || name.includes("\\")) {
    throw new ExportAccessError(404, "This file is not part of the export.");
  }
  const bytes = await readRegular(join(folder.dir, name), entry.byteSize);
  if (!bytes || bytes.length !== entry.byteSize || sha256Hex(bytes) !== entry.sha256) {
    throw new ExportAccessError(409, "This file changed after the export. Export again.");
  }
  return { name, bytes, contentType: contentType(name) };
}

/** Read one exported file by name. `revision` (a sha256 prefix) must match when given. */
export async function readExportFile(
  workRoot: string,
  episodeId: string,
  output: string,
  name: string,
  revision?: string | null,
): Promise<ExportFileBytes> {
  const folder = await readExportFolder(workRoot, episodeId, output);
  if (!folder) throw new ExportAccessError(404, "This export does not exist yet.");
  const file = await verifiedFile(folder, name);
  if (revision && !sha256Hex(file.bytes).startsWith(revision)) {
    throw new ExportAccessError(409, "This file changed after the export. Export again.");
  }
  return file;
}

/** A ZIP of every file the output wrote, plus its manifest, in reading order. */
export async function buildExportZip(
  workRoot: string,
  episodeId: string,
  output: string,
): Promise<{ name: string; bytes: Uint8Array }> {
  const folder = await readExportFolder(workRoot, episodeId, output);
  if (!folder) throw new ExportAccessError(404, "This export does not exist yet.");
  const base = `${episodeId}-${output}`;
  const entries: ZipEntry[] = [];
  for (const file of folder.manifest.files) {
    const { name, bytes } = await verifiedFile(folder, fileName(file.path));
    entries.push({ name: `${base}/${name}`, data: bytes });
  }
  entries.push({ name: `${base}/${MANIFEST_FILE}`, data: folder.manifestBytes });
  const modified = (await lstat(join(folder.dir, MANIFEST_FILE))).mtime;
  return {
    name: `${base}.zip`,
    bytes: createZip(entries.map((entry) => ({ ...entry, modified }))),
  };
}
