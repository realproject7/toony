// The three export targets: platform image sequence, stitched episode image,
// and PlotLink-ready WebP package. Each loads the canonical project, composites
// via the shared renderer, enforces its constraints at write time, writes into
// the project's `exports/<target>` folder, and emits a manifest with
// project-relative paths.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { type Canvas, createCanvas } from "@napi-rs/canvas";
import { loadProject } from "@toony/project-io";
import type { Cut, EpisodeBundle, Project } from "@toony/schema";
import { composeCut, composeTransitionBand } from "./compose.js";
import {
  DEFAULT_JPEG_QUALITY,
  DEFAULT_WEBP_QUALITY,
  encodeCanvas,
  encodeWebpToFit,
  type RasterFormat,
} from "./encode.js";
import { ExportError } from "./errors.js";
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

const PLATFORM_DEFAULT_WIDTH = 1200;
const STITCHED_DEFAULT_WIDTH = 1200;
const PLOTLINK_DEFAULT_WIDTH = 800;

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
  imageFor: (cutId: string) => Uint8Array | null;
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

  const images = new Map<string, Uint8Array | null>();
  for (const cut of bundle.cuts) {
    const ref = cut.image?.final ?? cut.image?.clean ?? null;
    if (ref === null) {
      images.set(cut.id, null);
      continue;
    }
    try {
      images.set(cut.id, new Uint8Array(await readFile(`${root}/${ref}`)));
    } catch {
      throw new ExportError(
        "asset-not-found",
        `cut "${cut.id}" references "${ref}", which could not be read.`,
      );
    }
  }

  return {
    project: loaded.project,
    bundle,
    imageFor: (cutId) => images.get(cutId) ?? null,
  };
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
  const { bundle, project, imageFor } = await loadEpisode(root, episodeId);
  const width = Math.max(1, Math.round(options.width ?? PLATFORM_DEFAULT_WIDTH));
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
    const composed = await composeCut(overlays, imageFor(cut.id), width);
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

/** Export one stitched image preserving cuts, gutters, transitions, and lettering. */
export async function exportStitched(
  root: string,
  episodeId: string,
  options: ExportOptions = {},
): Promise<ExportOutput> {
  const { bundle, project, imageFor } = await loadEpisode(root, episodeId);
  const width = Math.max(1, Math.round(options.width ?? STITCHED_DEFAULT_WIDTH));
  const format: RasterFormat = options.format ?? "png";
  const quality = format === "jpeg" ? (options.quality ?? DEFAULT_JPEG_QUALITY) : null;

  const transitionsById = new Map(bundle.transitions.map((t) => [t.id, t]));
  const cutsById = new Map(bundle.cuts.map((c) => [c.id, c]));

  // Compose every band in reading order, then stack them.
  const bands: { canvas: Canvas; height: number }[] = [];
  for (const item of bundle.episode.sequence) {
    if (item.type === "cut") {
      const cut = cutsById.get(item.id);
      if (!cut) continue;
      const overlays = bundle.lettering.filter((o) => o.cutId === cut.id);
      const composed = await composeCut(overlays, imageFor(cut.id), width);
      bands.push({ canvas: composed.canvas, height: composed.height });
    } else {
      const transition = transitionsById.get(item.id);
      if (!transition) continue;
      const band = composeTransitionBand(transition, width);
      if (band) bands.push({ canvas: band.canvas, height: band.height });
    }
  }

  const totalHeight = Math.max(
    1,
    bands.reduce((sum, b) => sum + b.height, 0),
  );
  const stitched = createCanvas(width, totalHeight);
  const ctx = stitched.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, totalHeight);
  let y = 0;
  for (const band of bands) {
    ctx.drawImage(band.canvas, 0, y);
    y += band.height;
  }

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
  const { bundle, project, imageFor } = await loadEpisode(root, episodeId);
  const width = Math.max(1, Math.round(options.width ?? PLOTLINK_DEFAULT_WIDTH));
  const cuts = orderedCuts(bundle);
  if (cuts.length > PLOTLINK_MAX_IMAGES) {
    throw new ExportError(
      "plotlink.too-many-images",
      `PlotLink allows at most ${PLOTLINK_MAX_IMAGES} images; this episode has ${cuts.length} cuts.`,
    );
  }

  // Generated markdown first (enforces the 500..10,000 bound before any write).
  const markdownText = buildPlotlinkMarkdown(project, bundle);

  const outRel = `episodes/${episodeId}/exports/plotlink`;
  const outAbs = `${root}/${outRel}`;
  await ensureDir(outAbs);

  const files: ManifestFile[] = [];
  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i] as Cut;
    const overlays = bundle.lettering.filter((o) => o.cutId === cut.id);
    const composed = await composeCut(overlays, imageFor(cut.id), width);
    const fit = encodeWebpToFit(
      composed.canvas,
      PLOTLINK_MAX_BYTES,
      options.quality ?? DEFAULT_WEBP_QUALITY,
    );
    if (!fit.withinBudget) {
      throw new ExportError(
        "plotlink.too-large",
        `cut "${cut.id}" could not be compressed under ${PLOTLINK_MAX_BYTES} bytes for PlotLink.`,
      );
    }
    const name = `${String(i + 1).padStart(3, "0")}.webp`;
    await writeFileSafe(`${outAbs}/${name}`, fit.bytes, "a PlotLink image");
    files.push({
      path: `${outRel}/${name}`,
      format: "webp",
      width: fit.width,
      height: fit.height,
      byteSize: fit.bytes.length,
      quality: fit.quality,
      sha256: sha256Hex(fit.bytes),
    });
  }

  const mdName = "episode.md";
  const mdBytes = new TextEncoder().encode(markdownText);
  await writeFileSafe(`${outAbs}/${mdName}`, markdownText, "the PlotLink markdown");
  const markdown: ManifestMarkdown = {
    path: `${outRel}/${mdName}`,
    characters: markdownText.length,
    sha256: sha256Hex(mdBytes),
  };

  const manifest = buildManifest("plotlink", project, bundle, width, files, markdown);
  await writeManifest(outAbs, manifest);
  return { manifest, outDir: outAbs };
}
