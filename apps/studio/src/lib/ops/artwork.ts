// Artwork for a cut from image bytes: an upload from the left workspace, or a
// file the person pointed their agent to. The bytes pass the same header and
// size limits export applies to source images, then are stored exactly as
// `toony import-image` stores a manual import (metadata stripped, placed under
// the episode's assets, the cut pointed at it, its review reset, the ingest
// log appended). Nothing else about the cut changes.

import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { sep } from "node:path";
import { IMAGE_FILE_BYTES_MAX, IMAGE_PIXELS_MAX, RASTER_DIMENSION_MAX } from "@toony/export";
import { readImageDimensions } from "@toony/lint";
import { importedAssetPath, importImageBytes } from "@toony/project-io";
import type { ProjectChange } from "../agent/protocol.js";
import { OpError } from "./errors.js";
import { cutLabel, findEpisode } from "./labels.js";
import { assertSafeId, episodeFiles, projectPath } from "./paths.js";
import { type OpContext, withProjectWrite } from "./write.js";

/** The largest upload Studio accepts, below export's own source image limit. */
export const ARTWORK_BYTES_MAX = Math.min(30 * 1024 * 1024, IMAGE_FILE_BYTES_MAX);

/** Check image bytes against export's source limits. Returns the image size. */
export function checkArtworkBytes(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.byteLength === 0) throw new OpError("invalid", "The image file is empty.");
  if (bytes.byteLength > ARTWORK_BYTES_MAX) {
    throw new OpError("too-large", "Images can be up to 30 MB.");
  }
  const dimensions = readImageDimensions(bytes);
  if (dimensions === null) {
    throw new OpError("invalid", "Choose a PNG, JPEG, WebP or GIF image.");
  }
  const { width, height } = dimensions;
  if (
    width < 1 ||
    height < 1 ||
    width > RASTER_DIMENSION_MAX ||
    height > RASTER_DIMENSION_MAX ||
    width * height > IMAGE_PIXELS_MAX
  ) {
    throw new OpError(
      "invalid",
      `This image is ${width} x ${height} pixels. Images can have up to ${IMAGE_PIXELS_MAX.toLocaleString("en-US")} pixels. Resize it and try again.`,
    );
  }
  return { width, height };
}

/**
 * A picture already in the project, read the careful way: a regular file inside
 * the work (no symlink at the end, no folder link leading out of it), no larger
 * than an upload may be, and passing the same checks as one. Null when it is
 * not there or not readable as such.
 */
export async function readProjectPicture(root: string, ref: string): Promise<Uint8Array | null> {
  try {
    const file = projectPath(root, ref);
    const [base, real] = await Promise.all([realpath(root), realpath(file)]);
    if (!real.startsWith(base + sep)) return null;
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > ARTWORK_BYTES_MAX) return null;
      const bytes = new Uint8Array(await handle.readFile());
      checkArtworkBytes(bytes);
      return bytes;
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

export interface ImportedArtwork {
  /** The project-relative path the cut now points at. */
  image: string;
  slot: "clean" | "final";
  change: ProjectChange | null;
}

/**
 * Store `bytes` as a cut's artwork. It goes in the slot the cut shows: the
 * final slot when the cut already has final artwork, the clean slot otherwise,
 * unless `slot` names one.
 */
export async function importArtwork(
  ctx: OpContext,
  episodeId: string,
  cutId: string,
  bytes: Uint8Array,
  slot?: "clean" | "final",
): Promise<ImportedArtwork> {
  assertSafeId(episodeId, "episode");
  assertSafeId(cutId, "cut");
  checkArtworkBytes(bytes);
  const files = episodeFiles(episodeId);
  let imported: { image: string; slot: "clean" | "final" } = { image: "", slot: "clean" };
  const { change } = await withProjectWrite(
    ctx,
    {
      summary: "Added artwork",
      scopes: [{ kind: "artwork", episodeId, cutId }],
      files: [files.cuts, `${files.folder}/logs/ingest.json`],
    },
    async (tx) => {
      const bundle = findEpisode(tx.before, episodeId);
      const cut = bundle?.cuts.find((c) => c.id === cutId);
      if (cut === undefined) throw new OpError("not-found", "This cut is not in the episode.");
      const target = slot ?? (cut.image?.final ? "final" : "clean");
      const asset = importedAssetPath({ kind: "cut", episodeId, cutId, slot: target }, bytes);
      if (asset === null) throw new OpError("invalid", "Choose a PNG, JPEG, WebP or GIF image.");
      await tx.track([asset]);
      const result = await importImageBytes(
        tx.root,
        { kind: "cut", episodeId, cutId, slot: target },
        bytes,
      );
      imported = { image: result.assetPath, slot: target };
      tx.setSummary(`Added artwork to ${cutLabel(tx.before, episodeId, cutId)}`);
    },
  );
  return { ...imported, change };
}
