// The three export targets: platform image sequence, stitched episode image,
// and PlotLink-ready WebP package. Each loads the canonical project, composites
// via the shared renderer, enforces its constraints at write time, writes into
// the project's `exports/<target>` folder, and emits a manifest with
// project-relative paths.

import { mkdir, open, writeFile } from "node:fs/promises";
import { type Canvas, createCanvas } from "@napi-rs/canvas";
import { loadProject } from "@toony/project-io";
import { layoutTransition, resolveBandHeight } from "@toony/render";
import { type Cut, type EpisodeBundle, type Project, resolveReferenceWidth } from "@toony/schema";
import {
  type ComposeCutOptions,
  composeCut,
  composeTransitionBand,
  cutRasterHeight,
} from "./compose.js";
import {
  DEFAULT_JPEG_QUALITY,
  DEFAULT_WEBP_QUALITY,
  PLATFORM_DEFAULT_WIDTH,
  PLOTLINK_DEFAULT_WIDTH,
  STITCHED_DEFAULT_WIDTH,
} from "./defaults.js";
import { encodeCanvas, type RasterFormat } from "./encode.js";
import { ExportError } from "./errors.js";
import { readImageDimensions } from "./image-dimensions.js";
import {
  type ExportManifest,
  type ExportTargetKind,
  MANIFEST_FILE,
  MANIFEST_VERSION,
  type ManifestFile,
  type ManifestMarkdown,
  PLOTLINK_MAX_BYTES,
  PLOTLINK_MAX_IMAGES,
  sha256Hex,
} from "./manifest.js";
import { buildPlotlinkMarkdown } from "./markdown.js";
import { writePlotlinkPackage } from "./plotlink-package.js";
import { type EpisodeBand, encodePlotlinkStrips, WEBP_DIMENSION_MAX } from "./plotlink-strips.js";
import {
  assertRasterBudget,
  assertRasterSize,
  IMAGE_FILE_BYTES_MAX,
  type PreparedImage,
  prepareImage,
} from "./raster-safety.js";

export interface ExportOptions {
  /** Render width in px. Each target has a sensible default. */
  width?: number;
  /** Output format for platform/stitched (png lossless or jpeg). */
  format?: "png" | "jpeg";
  /** Lossy quality 0..100 for jpeg/webp. */
  quality?: number;
}

export interface ExportOutput {
  manifest: ExportManifest;
  /** Absolute output directory (for CLI reporting; not persisted in the manifest). */
  outDir: string;
}

interface LoadedEpisode {
  project: Project;
  bundle: EpisodeBundle;
  imageFor: (cutId: string) => PreparedImage | null;
  imageDataBytes: number;
}

async function writeFileSafe(file: string, data: string | Uint8Array, what: string): Promise<void> {
  try {
    await writeFile(file, data);
  } catch {
    throw new ExportError("write-failed", `could not write ${what}.`);
  }
}

async function ensureDir(dir: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    throw new ExportError("mkdir-failed", "could not create the export directory.");
  }
}

async function loadEpisode(root: string, episodeId: string): Promise<LoadedEpisode> {
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
  let imageDataBytes = 0;
  for (const cut of bundle.cuts) {
    const ref = cut.image?.final ?? cut.image?.clean ?? null;
    if (ref === null) {
      images.set(cut.id, null);
      continue;
    }
    let bytes: Uint8Array;
    try {
      const file = await open(`${root}/${ref}`, "r");
      try {
        const { size } = await file.stat();
        if (size > IMAGE_FILE_BYTES_MAX) {
          throw new ExportError(
            "invalid-image",
            `cut "${cut.id}" has ${size} encoded bytes; the source image limit is ${IMAGE_FILE_BYTES_MAX} bytes.`,
          );
        }
        // A bounded read from the open file cannot grow beyond the checked size
        // if another process appends to it while this export is running.
        bytes = new Uint8Array(size);
        let offset = 0;
        while (offset < size) {
          const { bytesRead } = await file.read(bytes, offset, size - offset, offset);
          if (bytesRead === 0) break;
          offset += bytesRead;
        }
        bytes = bytes.subarray(0, offset);
      } finally {
        await file.close();
      }
    } catch (cause) {
      if (cause instanceof ExportError) throw cause;
      throw new ExportError(
        "asset-not-found",
        `cut "${cut.id}" references "${ref}", which could not be read.`,
      );
    }
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
  };
}

/**
 * Compose options every raster target shares — the project-level values the
 * shared layout needs, read off `webtoon.json` in ONE place so no target can
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
function composeOptions(project: Project, cut: Cut): ComposeCutOptions {
  return {
    imageLabel: `cut "${cut.id}"`,
    dialogueLanguage: project.webtoon.languages.dialogueLanguage,
    gutterBandWidth: project.webtoon.gutterBandWidth,
    panelAspect: cut.panelAspect,
  };
}

/** Check the entire allocation plan before creating any cut, band or page canvas. */
function preflightRasters(
  loaded: LoadedEpisode,
  width: number,
  stitched: boolean,
  strips = false,
): number {
  const { bundle, project, imageFor, imageDataBytes } = loaded;
  const cuts = new Map(bundle.cuts.map((cut) => [cut.id, cut]));
  const transitions = new Map(bundle.transitions.map((transition) => [transition.id, transition]));
  const referenceWidth = resolveReferenceWidth(project.webtoon.referenceWidth);
  let totalHeight = 0;
  let largestHeight = 1;
  let count = 0;
  for (const item of bundle.episode.sequence) {
    let height = 0;
    if (item.type === "cut") {
      const cut = cuts.get(item.id);
      if (cut) height = cutRasterHeight(width, cut.panelAspect, imageFor(cut.id));
    } else if (stitched || strips) {
      const transition = transitions.get(item.id);
      if (transition)
        height = resolveBandHeight(layoutTransition(transition), width, referenceWidth);
    }
    if (height <= 0) continue;
    assertRasterSize(width, height, `${item.type} "${item.id}"`);
    totalHeight += height;
    largestHeight = Math.max(largestHeight, height);
    count++;
  }
  totalHeight = Math.max(1, totalHeight);
  const label = `episode "${bundle.episode.id}" (${count} rasters, ${width} x ${totalHeight})`;
  if (stitched) assertRasterSize(width, totalHeight, label);
  // Reserve the band collection, final canvas, and one raw-equivalent encoded
  // output buffer (or measure's bounded pixel reads). Strip export holds bands,
  // one codec-sized canvas and raw-equivalent encode/retry buffers, plus all
  // accepted compressed files. Platform retains one cut canvas and its output.
  // Codec scratch space is additional.
  const canvasBytes = strips
    ? width * (totalHeight + Math.min(totalHeight, WEBP_DIMENSION_MAX) * 3) * 4 +
      PLOTLINK_MAX_IMAGES * PLOTLINK_MAX_BYTES
    : width * (stitched ? totalHeight * 3 : largestHeight * 2) * 4;
  assertRasterBudget(imageDataBytes + canvasBytes, label);
  return totalHeight;
}

/** Cut records in canonical reading order (from the episode sequence). */
function orderedCuts(bundle: EpisodeBundle): Cut[] {
  const byId = new Map(bundle.cuts.map((c) => [c.id, c]));
  const cuts: Cut[] = [];
  for (const item of bundle.episode.sequence) {
    if (item.type === "cut") {
      const cut = byId.get(item.id);
      if (cut) cuts.push(cut);
    }
  }
  return cuts;
}

function buildManifest(
  target: ExportTargetKind,
  project: Project,
  bundle: EpisodeBundle,
  width: number,
  files: ManifestFile[],
  markdown: ManifestMarkdown | null,
): ExportManifest {
  return {
    manifestVersion: MANIFEST_VERSION,
    target,
    projectId: project.webtoon.projectId,
    episodeId: bundle.episode.id,
    width,
    files,
    markdown,
  };
}

function stableJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v !== null && typeof v === "object") {
      const src = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(src).sort()) out[key] = sort(src[key]);
      return out;
    }
    return v;
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

async function writeManifest(outAbs: string, manifest: ExportManifest): Promise<void> {
  await writeFileSafe(`${outAbs}/${MANIFEST_FILE}`, stableJson(manifest), "the export manifest");
}

function ext(format: RasterFormat): string {
  return format === "jpeg" ? "jpg" : format;
}

/** Export an ordered platform image sequence (one file per cut). */
export async function exportPlatform(
  root: string,
  episodeId: string,
  options: ExportOptions = {},
): Promise<ExportOutput> {
  const loaded = await loadEpisode(root, episodeId);
  const { bundle, project, imageFor } = loaded;
  const width = Math.max(1, Math.round(options.width ?? PLATFORM_DEFAULT_WIDTH));
  preflightRasters(loaded, width, false);
  const format: RasterFormat = options.format ?? "png";
  const quality = format === "jpeg" ? (options.quality ?? DEFAULT_JPEG_QUALITY) : null;

  const outRel = `episodes/${episodeId}/exports/platform`;
  const outAbs = `${root}/${outRel}`;
  await ensureDir(outAbs);

  const files: ManifestFile[] = [];
  const cuts = orderedCuts(bundle);
  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i] as Cut;
    const overlays = bundle.lettering.filter((o) => o.cutId === cut.id);
    const composed = await composeCut(
      overlays,
      imageFor(cut.id)?.bytes ?? null,
      width,
      composeOptions(project, cut),
    );
    const bytes = encodeCanvas(composed.canvas, format, quality ?? undefined);
    const name = `${String(i + 1).padStart(3, "0")}.${ext(format)}`;
    await writeFileSafe(`${outAbs}/${name}`, bytes, "a platform image");
    files.push({
      path: `${outRel}/${name}`,
      format,
      width: composed.width,
      height: composed.height,
      byteSize: bytes.length,
      quality,
      sha256: sha256Hex(bytes),
    });
  }

  const manifest = buildManifest("platform", project, bundle, width, files, null);
  await writeManifest(outAbs, manifest);
  return { manifest, outDir: outAbs };
}

/** One episode composed into a single page raster, plus what it was built from. */
export interface StitchedEpisode {
  canvas: Canvas;
  width: number;
  height: number;
  project: Project;
  bundle: EpisodeBundle;
}

/**
 * Compose a whole episode into one page: every cut and transition band in
 * reading order, stacked. This is the single composition the stitched export
 * encodes AND the one craft measurement reads back (#196), so a measured episode
 * is by construction the page a reader would see. It needs no provider — a cut
 * with no image asset composes its neutral background.
 */
export async function stitchEpisode(
  root: string,
  episodeId: string,
  width?: number,
): Promise<StitchedEpisode> {
  const loaded = await loadEpisode(root, episodeId);
  const { bundle, project } = loaded;
  const renderWidth = Math.max(1, Math.round(width ?? STITCHED_DEFAULT_WIDTH));
  const totalHeight = preflightRasters(loaded, renderWidth, true);
  const bands = await composeEpisodeBands(loaded, renderWidth);

  const canvas = createCanvas(renderWidth, totalHeight);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, renderWidth, totalHeight);
  let y = 0;
  for (const band of bands) {
    ctx.drawImage(band.canvas, 0, y);
    y += band.height;
  }

  return { canvas, width: renderWidth, height: totalHeight, project, bundle };
}

/** The same rendered sequence feeds stitched pages and PlotLink strips. */
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

/** Export one stitched image preserving cuts, gutters, transitions, and lettering. */
export async function exportStitched(
  root: string,
  episodeId: string,
  options: ExportOptions = {},
): Promise<ExportOutput> {
  const format: RasterFormat = options.format ?? "png";
  const quality = format === "jpeg" ? (options.quality ?? DEFAULT_JPEG_QUALITY) : null;
  const {
    canvas: stitched,
    width,
    height: totalHeight,
    project,
    bundle,
  } = await stitchEpisode(root, episodeId, options.width);

  const outRel = `episodes/${episodeId}/exports/stitched`;
  const outAbs = `${root}/${outRel}`;
  await ensureDir(outAbs);
  const bytes = encodeCanvas(stitched, format, quality ?? undefined);
  const name = `episode.${ext(format)}`;
  await writeFileSafe(`${outAbs}/${name}`, bytes, "the stitched image");

  const files: ManifestFile[] = [
    {
      path: `${outRel}/${name}`,
      format,
      width,
      height: totalHeight,
      byteSize: bytes.length,
      quality,
      sha256: sha256Hex(bytes),
    },
  ];
  const manifest = buildManifest("stitched", project, bundle, width, files, null);
  await writeManifest(outAbs, manifest);
  return { manifest, outDir: outAbs };
}

/** Export a PlotLink-ready package: WebP images (≤20, ≤1MB), markdown, manifest. */
export async function exportPlotlink(
  root: string,
  episodeId: string,
  options: ExportOptions = {},
): Promise<ExportOutput> {
  const loaded = await loadEpisode(root, episodeId);
  const { bundle, project } = loaded;
  const width = Math.max(1, Math.round(options.width ?? PLOTLINK_DEFAULT_WIDTH));
  if (!Number.isSafeInteger(width) || width > WEBP_DIMENSION_MAX) {
    throw new ExportError(
      "plotlink.invalid-width",
      `PlotLink WebP width must be at most ${WEBP_DIMENSION_MAX} pixels. Choose a smaller export width.`,
    );
  }
  const totalHeight = preflightRasters(loaded, width, false, true);
  if (totalHeight > PLOTLINK_MAX_IMAGES * WEBP_DIMENSION_MAX) {
    throw new ExportError(
      "plotlink.cannot-fit",
      `The complete episode is ${totalHeight} pixels tall at this width, exceeding ${PLOTLINK_MAX_IMAGES} WebP strips of ${WEBP_DIMENSION_MAX} pixels. Choose a smaller export width and check lettering readability. The previous export is unchanged.`,
    );
  }

  // Generated markdown first (enforces the 500..10,000 bound before any write).
  const markdownText = buildPlotlinkMarkdown(project, bundle);

  const outRel = `episodes/${episodeId}/exports/plotlink`;
  const outAbs = `${root}/${outRel}`;
  const bands = await composeEpisodeBands(loaded, width);
  let strips: ReturnType<typeof encodePlotlinkStrips>;
  try {
    strips = encodePlotlinkStrips(bands, width, options.quality ?? DEFAULT_WEBP_QUALITY);
  } finally {
    for (const band of bands) {
      band.canvas.width = 1;
      band.canvas.height = 1;
    }
  }

  const outputs = new Map<string, string | Uint8Array>();
  const files: ManifestFile[] = [];
  for (let i = 0; i < strips.length; i++) {
    const strip = strips[i];
    if (!strip) continue;
    const name = `${String(i + 1).padStart(3, "0")}.webp`;
    outputs.set(name, strip.bytes);
    files.push({
      path: `${outRel}/${name}`,
      format: "webp",
      width: strip.width,
      height: strip.height,
      byteSize: strip.bytes.length,
      quality: strip.quality,
      sha256: sha256Hex(strip.bytes),
    });
  }

  const mdName = "episode.md";
  const mdBytes = new TextEncoder().encode(markdownText);
  outputs.set(mdName, markdownText);
  const markdown: ManifestMarkdown = {
    path: `${outRel}/${mdName}`,
    characters: markdownText.length,
    sha256: sha256Hex(mdBytes),
  };

  const manifest = buildManifest("plotlink", project, bundle, width, files, markdown);
  outputs.set(MANIFEST_FILE, stableJson(manifest));
  await writePlotlinkPackage(outAbs, outRel, outputs);
  return { manifest, outDir: outAbs };
}
