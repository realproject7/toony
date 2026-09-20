// Ingest an image asset into a project: strip metadata, place the file under the
// episode's asset folder, associate it with the target cut/transition record,
// and append a neutral provenance entry.
//
// #4 owns the imageProviders + asset-reference schema; this module populates
// those references and owns file placement, association, and metadata stripping.
// Provider production (manual import or generation) happens in `@toony/providers`
// against the neutral contract; the produced `ProviderResult` is passed here.
//
// Every persisted write here goes through `atomicWrite` (stage-then-rename), so a
// crash mid-write never truncates the asset, record, or provenance file. This
// module does NOT lock the record file it read-modify-writes, so a concurrent
// ingest and Studio save of the same `cuts.yaml`/`transitions.yaml` can still
// lose one side's change (last writer wins); multi-process coordination is out
// of scope (#144).

import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type AssetProvenance,
  extensionFor,
  type ProviderResult,
  stripImageMetadata,
} from "@toony/providers";
import type { ImageAssetRef } from "@toony/schema";
import { atomicWrite } from "./atomic.js";
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
  /** Project-relative path written into the record (never absolute). */
  assetPath: string;
  bytesWritten: number;
  sha256: string;
  provenance: AssetProvenance;
}

/**
 * What produced a GENERATED image (#240): the inputs a re-run needs to get the
 * same image back. Everything else in the log entry describes what the file is;
 * this is the only record of how it was made, and without it no render is
 * reproducible and no panel can answer "what produced this?".
 *
 * Both prompts are kept, and they are not the same string. `prompt` is what was
 * SUBMITTED, with the character lockstrings and the palette clause composed in,
 * because that is what the model was given and therefore what tells a repeat of
 * a render from a replacement of it. `basePrompt` is what the RUN was given,
 * before that composition — the value `--prompt` takes. Feeding the composed one
 * back through `--prompt` composes it a second time, so a record that kept only
 * the submitted prompt could not say how to ask for it again.
 *
 * Neutral by the same rule as `AssetProvenance`: these are the operator's own
 * generation inputs, never an endpoint, an account, a key, or a local path. A
 * manual import has no generation inputs and records none.
 *
 * Every field here is an input a re-run has to get right, so a consumer that
 * answers "can this run repeat that render?" must answer for ALL of them. See
 * `REPEAT_INPUTS` in the CLI's generate command, which is keyed on this type so
 * a field added here cannot be silently left out of that answer.
 */
export interface RenderInputs {
  prompt: string;
  basePrompt: string;
  negativePrompt: string;
  seed: number;
  /** The workflow's NAME, when the run selected one by name; never a path. */
  workflow?: string;
  /** The latent size submitted, when the run resolved one. */
  width?: number;
  height?: number;
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
  renderInputs?: RenderInputs;
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
// Writes go through `atomicWrite`, so a failure leaves any existing file intact.
async function writeFileSafe(file: string, data: string | Uint8Array, what: string): Promise<void> {
  try {
    await atomicWrite(file, data);
  } catch {
    throw new ProjectIoError(`could not write ${what}.`, file);
  }
}

function logPathFor(root: string, episodeId: string): string {
  return join(episodeDir(root, episodeId), "logs", "ingest.json");
}

/** The episode's provenance entries, or an empty list when there is no log yet. */
async function readProvenanceLog(root: string, episodeId: string): Promise<unknown[]> {
  try {
    const parsed = JSON.parse(await readFile(logPathFor(root, episodeId), "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // No log yet, or unreadable: there is nothing recorded to report.
    return [];
  }
}

async function appendProvenance(
  root: string,
  episodeId: string,
  entry: ProvenanceEntry,
): Promise<void> {
  const logPath = logPathFor(root, episodeId);
  const entries = await readProvenanceLog(root, episodeId);
  entries.push(entry);
  await mkdirSafe(dirname(logPath), "the ingest log directory");
  await writeFileSafe(logPath, encodeJson(entries), "the ingest provenance log");
}

/**
 * The inputs that produced the image at `assetPath`, as the ingest log recorded
 * them (#240) — the most recent entry for that exact path, since each ingest
 * replaces the file the previous one wrote.
 *
 * `assetPath` is the project-relative path the RECORD holds, matched whole. It
 * is not derived from the record's id here: an id may legally contain a dot
 * (`SAFE_ASSET_ID` allows it), so `cut-001.` as a prefix also matches
 * `cut-001.alt.png` — a sibling cut's asset answering for this one.
 *
 * `undefined` when nothing is recorded for it: no log, an asset imported rather
 * than generated, or one produced before inputs were recorded at all. A caller
 * uses this to tell a repeat of a render from a replacement of it, so "nothing
 * recorded" must read as "no claim", never as "no difference".
 *
 * The log is this package's own output, but it is still a file on disk that
 * anything may have edited, so the entry is returned only when it is shaped
 * like one. The FIELDS are unchecked: the caller type-checks each one where it
 * uses it, because what a wrong type means is the caller's question — printing
 * `--negative null` into a command the operator runs is a different failure
 * from comparing it.
 */
export async function recordedRenderInputs(
  root: string,
  episodeId: string,
  assetPath: string,
): Promise<RenderInputs | undefined> {
  const entries = await readProvenanceLog(root, episodeId);
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (typeof entry !== "object" || entry === null) continue;
    const recorded = entry as { assetPath?: unknown; renderInputs?: unknown };
    if (recorded.assetPath !== assetPath) continue;
    const { renderInputs } = recorded;
    if (typeof renderInputs !== "object" || renderInputs === null) return undefined;
    return renderInputs as RenderInputs;
  }
  return undefined;
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
 *
 * `renderInputs` is what produced the image, for a producer that generated it
 * (#240); it is appended to the log entry. Omitted for a manual import, whose
 * entry is exactly what it has always been.
 */
export async function ingestImageAsset(
  root: string,
  target: AssetTarget,
  result: ProviderResult,
  renderInputs?: RenderInputs,
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
  const episodeRelative = `assets/${slotDir}/${recordId}.${extensionFor(result.format)}`;
  // Records store a project-relative path (per the schema's ImageAssetRef
  // contract) so consumers resolve assets from the project root; the file
  // itself still lives under the episode directory.
  const assetPath = `episodes/${target.episodeId}/${episodeRelative}`;
  const absolutePath = join(episodeDir(root, target.episodeId), episodeRelative);

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
    ...(renderInputs === undefined ? {} : { renderInputs }),
  });

  return { assetPath, bytesWritten: stripped.length, sha256, provenance: result.provenance };
}
