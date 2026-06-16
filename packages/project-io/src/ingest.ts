// Ingest an image asset into a project: strip metadata, place the file under the
// episode's asset folder, associate it with the target cut/transition record,
// and append a neutral provenance entry.
//
// #4 owns the imageProviders + asset-reference schema; this module populates
// those references and owns file placement, association, and metadata stripping.
// Provider production (manual import or generation) happens in `@toony/providers`
// against the neutral contract; the produced `ProviderResult` is passed here.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type AssetProvenance,
  extensionFor,
  type ProviderResult,
  stripImageMetadata,
} from "@toony/providers";
import type { ImageAssetRef } from "@toony/schema";
import { ProjectIoError } from "./errors.js";
import { encodeJson, encodeYaml } from "./format.js";
import { cutsFile, episodeDir, transitionsFile } from "./paths.js";
import { loadProject } from "./reader.js";

/** Which clean/final slot a cut image occupies. */
export type AssetSlot = "clean" | "final";

export interface CutAssetTarget {
  kind: "cut";
  episodeId: string;
  cutId: string;
  slot: AssetSlot;
}

export interface TransitionAssetTarget {
  kind: "transition";
  episodeId: string;
  transitionId: string;
}

export type AssetTarget = CutAssetTarget | TransitionAssetTarget;

export interface IngestResult {
  /** Episode-relative path written into the record (never absolute). */
  assetPath: string;
  bytesWritten: number;
  sha256: string;
  provenance: AssetProvenance;
}

interface ProvenanceEntry {
  assetPath: string;
  recordKind: "cut" | "transition";
  recordId: string;
  source: string;
  providerId: string;
  contentType: string;
  byteLength: number;
  sha256: string;
}

function targetRecordId(target: AssetTarget): string {
  return target.kind === "cut" ? target.cutId : target.transitionId;
}

// Schema only requires record ids to be non-empty strings, so a valid project
// could use ids with path separators or `..`. Asset filenames are derived from
// the id, so reject anything that is not a safe single path segment before any
// write — otherwise ingest could place a file outside the episode asset folder.
const SAFE_ASSET_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function assertSafeAssetSegment(id: string, file: string): void {
  if (!SAFE_ASSET_ID.test(id) || id.includes("..")) {
    throw new ProjectIoError(
      `record id "${id}" is not a safe asset filename (letters, digits, ".", "_", "-" only; no path separators or "..").`,
      file,
    );
  }
}

// Wrap filesystem writes so a raw fs error (which embeds the absolute path)
// never rethrows to the surface; callers get a neutral, path-free message.
async function writeFileSafe(file: string, data: string | Uint8Array, what: string): Promise<void> {
  try {
    await writeFile(file, data);
  } catch {
    throw new ProjectIoError(`could not write ${what}.`, file);
  }
}

async function appendProvenance(
  root: string,
  episodeId: string,
  entry: ProvenanceEntry,
): Promise<void> {
  const logPath = join(episodeDir(root, episodeId), "logs", "ingest.json");
  let entries: unknown[] = [];
  try {
    const parsed = JSON.parse(await readFile(logPath, "utf8"));
    if (Array.isArray(parsed)) entries = parsed;
  } catch {
    // No log yet, or unreadable: start a fresh list.
  }
  entries.push(entry);
  await mkdirSafe(dirname(logPath), "the ingest log directory");
  await writeFileSafe(logPath, encodeJson(entries), "the ingest provenance log");
}

async function mkdirSafe(dir: string, what: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    throw new ProjectIoError(`could not create ${what}.`, dir);
  }
}

/**
 * Place a produced image into the project and associate it with a record.
 *
 * Strips metadata first, then writes the asset and rewrites the affected record
 * file (`cuts.yaml` or `transitions.yaml`). The record is located before any
 * file is written, so an unknown episode/record fails without leaving an
 * orphaned asset. Throws `ProjectIoError` when the target does not exist.
 */
export async function ingestImageAsset(
  root: string,
  target: AssetTarget,
  result: ProviderResult,
): Promise<IngestResult> {
  const loaded = await loadProject(root);
  const bundle = loaded.project.episodes.find((b) => b.episode.id === target.episodeId);
  if (!bundle) {
    throw new ProjectIoError(
      `episode not found: ${target.episodeId}`,
      episodeDir(root, target.episodeId),
    );
  }

  const recordId = targetRecordId(target);
  assertSafeAssetSegment(
    recordId,
    target.kind === "cut"
      ? cutsFile(root, target.episodeId)
      : transitionsFile(root, target.episodeId),
  );
  const slotDir = target.kind === "cut" ? target.slot : "clean";
  const assetPath = `assets/${slotDir}/${recordId}.${extensionFor(result.format)}`;
  const absolutePath = join(episodeDir(root, target.episodeId), assetPath);

  // Locate and update the in-memory record before touching disk.
  if (target.kind === "cut") {
    const cut = bundle.cuts.find((c) => c.id === target.cutId);
    if (!cut) {
      throw new ProjectIoError(`cut not found: ${target.cutId}`, cutsFile(root, target.episodeId));
    }
    const prev: ImageAssetRef = cut.image ?? { clean: null, final: null };
    cut.image = {
      clean: target.slot === "clean" ? assetPath : prev.clean,
      final: target.slot === "final" ? assetPath : prev.final,
    };
  } else {
    const transition = bundle.transitions.find((t) => t.id === target.transitionId);
    if (!transition) {
      throw new ProjectIoError(
        `transition not found: ${target.transitionId}`,
        transitionsFile(root, target.episodeId),
      );
    }
    transition.image = assetPath;
  }

  // Strip metadata so the asset is public-safe by construction, then write it.
  const stripped = stripImageMetadata(result.bytes, result.format);
  await mkdirSafe(dirname(absolutePath), "the asset directory");
  await writeFileSafe(absolutePath, stripped, "the ingested asset");

  // Persist the updated record file (deterministic YAML).
  if (target.kind === "cut") {
    await writeFileSafe(cutsFile(root, target.episodeId), encodeYaml(bundle.cuts), "the cuts file");
  } else {
    await writeFileSafe(
      transitionsFile(root, target.episodeId),
      encodeYaml(bundle.transitions),
      "the transitions file",
    );
  }

  const sha256 = createHash("sha256").update(stripped).digest("hex");
  await appendProvenance(root, target.episodeId, {
    assetPath,
    recordKind: target.kind,
    recordId,
    source: result.provenance.source,
    providerId: result.provenance.providerId,
    contentType: result.provenance.contentType,
    byteLength: stripped.length,
    sha256,
  });

  return { assetPath, bytesWritten: stripped.length, sha256, provenance: result.provenance };
}
