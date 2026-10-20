// Load one episode for export: the validation gate, bounded reads of every
// source image, safe decode, and the raster budget. Every output and the craft
// measurement start here, so they compose from identical inputs.

import { createHash } from "node:crypto";
import { constants, createReadStream, open as openDescriptor } from "node:fs";
import { open } from "node:fs/promises";
import { loadProject } from "@toony/project-io";
import { type Cut, type EpisodeBundle, type Project, resolveReferenceWidth } from "@toony/schema";
import type { ComposeCutOptions } from "./compose.js";
import { ExportError } from "./errors.js";
import { readImageDimensions } from "./image-dimensions.js";
import { type LayoutBand, layoutBands } from "./layout.js";
import { sha256Hex } from "./manifest.js";
import {
  assertRasterBudget,
  IMAGE_FILE_BYTES_MAX,
  type PreparedImage,
  prepareImage,
} from "./raster-safety.js";

export interface LoadedEpisode {
  project: Project;
  bundle: EpisodeBundle;
  imageFor: (cutId: string) => PreparedImage | null;
  imageDataBytes: number;
  /** SHA-256 of each cut's source artwork bytes, by cut id. */
  artHashes: ReadonlyMap<string, string>;
}

/**
 * SHA-256 of a file read as a stream that refuses symlinks and stops once more
 * than `cap` bytes arrive, so a file that grows after a size check cannot be
 * read past the cap.
 */
async function hashFileCapped(path: string, cap: number): Promise<string> {
  const hash = createHash("sha256");
  let total = 0;
  const fd = await new Promise<number>((resolve, reject) => {
    openDescriptor(path, constants.O_RDONLY | constants.O_NOFOLLOW, (error, descriptor) =>
      error ? reject(error) : resolve(descriptor),
    );
  });
  const stream = createReadStream(path, { fd, autoClose: true });
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      total += chunk.length;
      if (total > cap) throw new Error("too large");
      hash.update(chunk);
    }
  } finally {
    stream.destroy();
  }
  return hash.digest("hex");
}

/** Read a file without letting it grow past the size checked first. */
async function readBounded(path: string, cutId: string): Promise<Uint8Array> {
  const file = await open(path, "r");
  try {
    const { size } = await file.stat();
    if (size > IMAGE_FILE_BYTES_MAX) {
      throw new ExportError(
        "invalid-image",
        `cut "${cutId}" has ${size} encoded bytes; the source image limit is ${IMAGE_FILE_BYTES_MAX} bytes.`,
      );
    }
    // A bounded read from the open file cannot grow beyond the checked size
    // if another process appends to it while this export is running.
    const bytes = new Uint8Array(size);
    let offset = 0;
    while (offset < size) {
      const { bytesRead } = await file.read(bytes, offset, size - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    return bytes.subarray(0, offset);
  } finally {
    await file.close();
  }
}

function artRef(cut: Cut): string | null {
  return cut.image?.final ?? cut.image?.clean ?? null;
}

export async function loadEpisode(root: string, episodeId: string): Promise<LoadedEpisode> {
  const loaded = await loadProject(root);
  if (!loaded.validation.valid) {
    throw new ExportError(
      "invalid-project",
      "project does not pass validation; run `toony validate`.",
    );
  }
  const bundle = loaded.project.episodes.find((b) => b.episode.id === episodeId);
  if (!bundle) {
    throw new ExportError("episode-not-found", `episode not found: ${episodeId}`);
  }

  const images = new Map<string, PreparedImage | null>();
  const artHashes = new Map<string, string>();
  let imageDataBytes = 0;
  for (const cut of bundle.cuts) {
    const ref = artRef(cut);
    if (ref === null) {
      images.set(cut.id, null);
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = await readBounded(`${root}/${ref}`, cut.id);
    } catch (cause) {
      if (cause instanceof ExportError) throw cause;
      throw new ExportError(
        "asset-not-found",
        `cut "${cut.id}" references "${ref}", which could not be read.`,
      );
    }
    artHashes.set(cut.id, sha256Hex(bytes));
    const shape = readImageDimensions(bytes);
    if (shape) {
      // Before native decode, budget this child's source image, normalization
      // canvas and raw-equivalent encoded output, alongside retained inputs.
      assertRasterBudget(
        imageDataBytes + bytes.byteLength + shape.width * shape.height * 12 + 1024 * 1024,
        `episode "${episodeId}" source cut "${cut.id}" (${shape.width} x ${shape.height})`,
      );
    }
    const image = await prepareImage(bytes, `cut "${cut.id}"`);
    // Conservatively include source bytes, normalized bytes, and all source
    // pixel storage rather than depending on native garbage-collection timing.
    imageDataBytes += bytes.byteLength + image.bytes.byteLength + image.width * image.height * 4;
    assertRasterBudget(
      imageDataBytes,
      `episode "${episodeId}" source images through cut "${cut.id}"`,
    );
    images.set(cut.id, image);
  }

  return {
    project: loaded.project,
    bundle,
    imageFor: (cutId) => images.get(cutId) ?? null,
    imageDataBytes,
    artHashes,
  };
}

/**
 * Compose options every raster output shares: the project-level values the
 * shared layout needs, read off `webtoon.json` in ONE place so no output can
 * compose a cut on different terms from another. The project declares which
 * language its dialogue is written in, and that picks the DEFAULT dialogue face
 * (#213); it declares how much column a gutter strip takes (#215). Both are the
 * same fields the studio preview reads, so an exported cut lands on the same
 * face, in the same strip, as what was read.
 *
 * The cut is passed too because one of the terms is not the project's: a cut
 * declares its own panel shape (#237), and without it an art-less cut composes
 * at the fallback whatever the pack asked for (#260).
 */
export function composeOptions(project: Project, cut: Cut): ComposeCutOptions {
  return {
    imageLabel: `cut "${cut.id}"`,
    dialogueLanguage: project.webtoon.languages.dialogueLanguage,
    gutterBandWidth: project.webtoon.gutterBandWidth,
    panelAspect: cut.panelAspect,
  };
}

/** The episode sequence of a loaded episode as layout bands. */
export function loadedBands(loaded: LoadedEpisode): LayoutBand[] {
  return layoutBands({
    bundle: loaded.bundle,
    referenceWidth: resolveReferenceWidth(loaded.project.webtoon.referenceWidth),
    artSize: (cutId) => {
      const image = loaded.imageFor(cutId);
      return image ? { width: image.width, height: image.height } : null;
    },
  });
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = stableValue(source[key]);
    return out;
  }
  return value;
}

/** Canonical JSON: keys sorted at every level, two-space indent, trailing newline. */
export function stableJson(value: unknown): string {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

/**
 * The hash an output records of what it was rendered from: the project values
 * the compositor reads, the reading sequence, each cut's shape and artwork
 * bytes, the transitions and the lettering. Fields that never reach the pixels
 * (prompts, seeds, notes, review status) are left out, so editing them does not
 * make an export out of date. Two exports of unchanged inputs record the same
 * hash.
 */
export function computeInputsHash(
  project: Project,
  bundle: EpisodeBundle,
  artHashes: ReadonlyMap<string, string>,
): string {
  return sha256Hex(
    new TextEncoder().encode(
      stableJson({
        render: {
          dialogueLanguage: project.webtoon.languages.dialogueLanguage,
          gutterBandWidth: project.webtoon.gutterBandWidth ?? null,
          referenceWidth: resolveReferenceWidth(project.webtoon.referenceWidth),
        },
        sequence: bundle.episode.sequence,
        cuts: bundle.cuts.map((cut) => ({
          id: cut.id,
          panelAspect: cut.panelAspect ?? null,
          art: artHashes.get(cut.id) ?? null,
        })),
        transitions: bundle.transitions.map(
          ({ agentNote: _a, humanNote: _h, reviewStatus: _r, ...drawn }) => drawn,
        ),
        lettering: bundle.lettering.map(({ reviewStatus: _r, overflow: _o, ...drawn }) => drawn),
      }),
    ),
  );
}

/**
 * The current inputs hash of an episode, without decoding any artwork. Compare
 * it with a manifest's `inputs.sha256` to tell whether an export is out of date.
 * Returns null when the project does not load or the episode is missing.
 */
export async function episodeInputsHash(root: string, episodeId: string): Promise<string | null> {
  let project: Project;
  try {
    project = (await loadProject(root)).project;
  } catch {
    return null;
  }
  const bundle = project.episodes.find((b) => b.episode.id === episodeId);
  if (!bundle) return null;
  const artHashes = new Map<string, string>();
  for (const cut of bundle.cuts) {
    const ref = artRef(cut);
    if (ref === null) continue;
    // Streamed: this runs while pages render, where a file handle is not a
    // value to keep alive, and the byte cap holds even if the file grows.
    try {
      artHashes.set(cut.id, await hashFileCapped(`${root}/${ref}`, IMAGE_FILE_BYTES_MAX));
    } catch {
      artHashes.set(cut.id, "unreadable");
    }
  }
  return computeInputsHash(project, bundle, artHashes);
}
