// Workspace scan: summarize every work in a workspace root for the library UI.
//
// A "workspace" is a parent folder holding many works; each immediate child
// folder that contains a `webtoon.json` is a work (per the v2 proposal §4.1).
// `listWorkspace` returns a lightweight, deterministic per-work summary for the
// Studio library grid (#51) and the CLI. It deliberately does NOT run the full
// `loadProject`/`validateProject` pipeline: a malformed work should still appear
// in the library (so the user can open and fix it) and must never break the scan
// of its siblings. Reuses the canonical path/format helpers so the on-disk
// contract stays single-sourced.

import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { isProjectRelativePath } from "@toony/schema";
import { decodeJson, decodeYaml } from "./format.js";
import {
  cutsFile,
  episodeFile,
  episodesDir,
  letteringFile,
  transitionsFile,
  webtoonPath,
} from "./paths.js";

/** A lightweight per-work summary for the workspace library. */
export interface WorkspaceEntry {
  /** Work id = its folder name within the workspace. */
  id: string;
  /** Display title from `webtoon.json`, or the folder id if missing/unreadable. */
  title: string;
  /** Number of episode folders under `episodes/`. */
  episodeCount: number;
  /** Total cut records across all episodes. */
  cutCount: number;
  /** Project-relative path to a representative cut image, or null if none. */
  coverImagePath: string | null;
  /** ISO timestamp of the most recently modified project file. */
  updatedAt: string;
}

/** Minimal cut shape this scan reads; full validation is the loader's job. */
interface ScannedCut {
  image?: { clean?: unknown; final?: unknown } | null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Episode folder names under a work, deterministically sorted; [] on error. */
async function listEpisodeDirs(workRoot: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(episodesDir(workRoot), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Read an episode's cut list, tolerating a missing/corrupt file as empty. */
async function readCuts(workRoot: string, episodeId: string): Promise<ScannedCut[]> {
  try {
    const text = await readFile(cutsFile(workRoot, episodeId), "utf8");
    return asArray(decodeYaml(text)) as ScannedCut[];
  } catch {
    return [];
  }
}

/** First project-relative image (final preferred over clean) across cuts, else null. */
function pickCover(cuts: ScannedCut[]): string | null {
  for (const cut of cuts) {
    const image = cut?.image;
    if (typeof image !== "object" || image === null) continue;
    const candidate = [image.final, image.clean].find(
      (ref): ref is string => typeof ref === "string" && ref.length > 0,
    );
    // Only surface a path the rest of the app can safely resolve in-scope.
    if (candidate && isProjectRelativePath(candidate)) return candidate;
  }
  return null;
}

/** Largest mtime (ms) among the given files; ignores unreadable ones. */
async function newestMtimeMs(files: string[]): Promise<number> {
  let newest = 0;
  for (const file of files) {
    try {
      const info = await stat(file);
      if (info.mtimeMs > newest) newest = info.mtimeMs;
    } catch {
      // missing/unreadable file does not contribute to the timestamp
    }
  }
  return newest;
}

/** Summarize one candidate work folder, or null if it has no `webtoon.json`. */
async function summarizeWork(root: string, id: string): Promise<WorkspaceEntry | null> {
  const workRoot = join(root, id);
  let webtoonText: string;
  try {
    webtoonText = await readFile(webtoonPath(workRoot), "utf8");
  } catch {
    return null; // no webtoon.json → not a work; the scan ignores it
  }

  // Title from webtoon.json when it is a non-empty string; otherwise the folder
  // id, so a malformed manifest still yields an openable, fixable library card.
  let title = id;
  try {
    const webtoon = decodeJson(webtoonText);
    if (typeof webtoon === "object" && webtoon !== null) {
      const value = (webtoon as Record<string, unknown>).title;
      if (typeof value === "string" && value.length > 0) title = value;
    }
  } catch {
    // malformed JSON: keep title = id
  }

  const episodeIds = await listEpisodeDirs(workRoot);
  let cutCount = 0;
  let coverImagePath: string | null = null;
  const timestampFiles = [webtoonPath(workRoot)];
  for (const episodeId of episodeIds) {
    const cuts = await readCuts(workRoot, episodeId);
    cutCount += cuts.length;
    if (coverImagePath === null) coverImagePath = pickCover(cuts);
    timestampFiles.push(
      episodeFile(workRoot, episodeId),
      cutsFile(workRoot, episodeId),
      transitionsFile(workRoot, episodeId),
      letteringFile(workRoot, episodeId),
    );
  }

  return {
    id,
    title,
    episodeCount: episodeIds.length,
    cutCount,
    coverImagePath,
    updatedAt: new Date(await newestMtimeMs(timestampFiles)).toISOString(),
  };
}

/**
 * Scan `root` for works (immediate child folders containing `webtoon.json`) and
 * return a deterministic, id-sorted summary for each. Non-project folders and
 * dot-folders (e.g. `.toony`) are ignored. A missing/unreadable workspace root
 * is treated as empty (the proposal auto-creates it on first run, #51).
 */
export async function listWorkspace(root: string): Promise<WorkspaceEntry[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const ids = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();

  const summaries: WorkspaceEntry[] = [];
  for (const id of ids) {
    const summary = await summarizeWork(root, id);
    if (summary) summaries.push(summary);
  }
  return summaries;
}
