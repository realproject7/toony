// The stitched episode page: every cut and transition band in reading order,
// stacked into one raster. Craft measurement reads this page back (#196), and
// the strip output draws the same pixels from the same bands.

import { type Canvas, createCanvas } from "@napi-rs/canvas";
import { type EpisodeBundle, type Project, resolveReferenceWidth } from "@toony/schema";
import { composeCut, composeTransitionBand } from "./compose.js";
import { EXPORT_BACKGROUND } from "./defaults.js";
import { composeOptions, type LoadedEpisode, loadEpisode, loadedBands } from "./load.js";
import { assertRasterBudget, assertRasterSize } from "./raster-safety.js";

/** One episode composed into a single page raster, plus what it was built from. */
export interface StitchedEpisode {
  canvas: Canvas;
  width: number;
  height: number;
  project: Project;
  bundle: EpisodeBundle;
}

/** One composed band of the reading sequence. */
export interface EpisodeBand {
  canvas: Canvas;
  height: number;
}

/**
 * Check the whole stitched-page allocation plan before creating any canvas:
 * every band, the page, and the working set (bands + page + one raw-equivalent
 * encoded output). Returns the page height.
 */
export function preflightPage(loaded: LoadedEpisode, width: number): number {
  const { bundle, imageDataBytes } = loaded;
  let totalHeight = 0;
  let count = 0;
  for (const band of loadedBands(loaded)) {
    const height = band.heightAt(width);
    if (height <= 0) continue;
    assertRasterSize(width, height, `${band.type} "${band.id}"`);
    totalHeight += height;
    count++;
  }
  totalHeight = Math.max(1, totalHeight);
  const label = `episode "${bundle.episode.id}" (${count} rasters, ${width} x ${totalHeight})`;
  assertRasterSize(width, totalHeight, label);
  assertRasterBudget(imageDataBytes + width * totalHeight * 3 * 4, label);
  return totalHeight;
}

/**
 * Compose a whole episode into one page: every cut and transition band in
 * reading order, stacked. This is the single composition craft measurement reads
 * back (#196), so a measured episode is by construction the page a reader would
 * see. It needs no provider: a cut with no image asset composes its neutral
 * background.
 */
export async function stitchEpisode(
  root: string,
  episodeId: string,
  width?: number,
): Promise<StitchedEpisode> {
  const loaded = await loadEpisode(root, episodeId);
  const { bundle, project } = loaded;
  const renderWidth = Math.max(
    1,
    Math.round(width ?? resolveReferenceWidth(project.webtoon.referenceWidth)),
  );
  const totalHeight = preflightPage(loaded, renderWidth);
  const bands = await composeEpisodeBands(loaded, renderWidth);

  const canvas = createCanvas(renderWidth, totalHeight);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = EXPORT_BACKGROUND;
  ctx.fillRect(0, 0, renderWidth, totalHeight);
  let y = 0;
  for (const band of bands) {
    ctx.drawImage(band.canvas, 0, y);
    y += band.height;
  }

  return { canvas, width: renderWidth, height: totalHeight, project, bundle };
}

/** Compose every band of the reading sequence at `renderWidth`, in order. */
async function composeEpisodeBands(
  loaded: LoadedEpisode,
  renderWidth: number,
): Promise<EpisodeBand[]> {
  const { bundle, project, imageFor } = loaded;
  // The column the project's px gutter heights were authored against (#217).
  // Cuts already scale to `renderWidth`; the bands scale from here, so the page
  // rhythm is a property of the project and not of the requested width.
  const referenceWidth = resolveReferenceWidth(project.webtoon.referenceWidth);

  const transitionsById = new Map(bundle.transitions.map((t) => [t.id, t]));
  const cutsById = new Map(bundle.cuts.map((c) => [c.id, c]));

  const bands: EpisodeBand[] = [];
  for (const item of bundle.episode.sequence) {
    if (item.type === "cut") {
      const cut = cutsById.get(item.id);
      if (!cut) continue;
      const overlays = bundle.lettering.filter((o) => o.cutId === cut.id);
      const composed = await composeCut(
        overlays,
        imageFor(cut.id)?.bytes ?? null,
        renderWidth,
        composeOptions(project, cut),
      );
      bands.push({ canvas: composed.canvas, height: composed.height });
    } else {
      const transition = transitionsById.get(item.id);
      if (!transition) continue;
      const band = composeTransitionBand(transition, renderWidth, referenceWidth);
      if (band) bands.push({ canvas: band.canvas, height: band.height });
    }
  }

  return bands;
}
