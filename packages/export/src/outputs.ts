// The export outputs: an episode strip (whole or in parts), one image per cut,
// and fixed-size social frames. All three render from a layout plan
// (`./layout.ts`) through the shared compositor (`composeCut` /
// `composeTransitionBand`), so every output draws the same pixels the stitched
// page and the Studio preview show. Bands are composed on demand and released
// once drawn: a sliced strip never allocates the full page.

import { type Canvas, createCanvas } from "@napi-rs/canvas";
import { episodeExportRelDir, LEGACY_EXPORT_DIRS } from "@toony/project-io";
import {
  type ExportOptionValues,
  type ExportTargetKind,
  isPathSafeId,
  resolveReferenceWidth,
} from "@toony/schema";
import { composeCut, composeTransitionBand } from "./compose.js";
import { socialOutputForFrame } from "./defaults.js";
import { encodeCanvas } from "./encode.js";
import { ExportError } from "./errors.js";
import {
  type LayoutBand,
  type LayoutFile,
  type LayoutPiece,
  type LayoutPlan,
  planOutput,
  type ResolvedOutputOptions,
  resolveOutputOptions,
  type SliceUnit,
  splitTallBands,
  takeFittingPrefix,
} from "./layout.js";
import {
  composeOptions,
  computeInputsHash,
  type LoadedEpisode,
  loadEpisode,
  loadedBands,
  stableJson,
} from "./load.js";
import {
  type ExportManifest,
  MANIFEST_FILE,
  MANIFEST_VERSION,
  type ManifestFile,
  type ManifestItem,
  sha256Hex,
} from "./manifest.js";
import type { ExportPreset } from "./presets.js";
import { publishExport } from "./publish.js";
import { assertRasterBudget, assertRasterSize } from "./raster-safety.js";
import { preflightPage } from "./targets.js";

/** Export options as the CLI, the Studio and pack presets spell them. */
export type ExportOptions = ExportOptionValues;

export interface ExportProgress {
  /** Steps finished: bands composed, files encoded, the folder written. */
  done: number;
  total: number;
}

export interface ExportRun {
  /** Output id, which is also the folder under `exports/`. Default: the kind's own output. */
  output?: string;
  onProgress?: (progress: ExportProgress) => void;
}

export interface ExportOutput {
  manifest: ExportManifest;
  /** Absolute output directory (for CLI reporting; not persisted in the manifest). */
  outDir: string;
}

/** Composes each band at a width once, and frees it once nothing else draws it. */
class BandRasters {
  private readonly cache = new Map<string, Canvas>();
  private readonly cutsById: Map<string, LoadedEpisode["bundle"]["cuts"][number]>;
  private readonly transitionsById: Map<string, LoadedEpisode["bundle"]["transitions"][number]>;
  private readonly referenceWidth: number;

  constructor(
    private readonly loaded: LoadedEpisode,
    private readonly bands: readonly LayoutBand[],
    private readonly onComposed: () => void,
  ) {
    this.cutsById = new Map(loaded.bundle.cuts.map((cut) => [cut.id, cut]));
    this.transitionsById = new Map(loaded.bundle.transitions.map((t) => [t.id, t]));
    this.referenceWidth = resolveReferenceWidth(loaded.project.webtoon.referenceWidth);
  }

  static key(band: number, width: number): string {
    return `${band}@${width}`;
  }

  async get(band: number, width: number): Promise<Canvas> {
    const key = BandRasters.key(band, width);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const source = this.bands[band];
    if (!source) throw new Error(`layout band ${band} does not exist`);
    let canvas: Canvas | null = null;
    if (source.type === "cut") {
      const cut = this.cutsById.get(source.id);
      if (cut) {
        const { project, bundle, imageFor } = this.loaded;
        const composed = await composeCut(
          bundle.lettering.filter((o) => o.cutId === cut.id),
          imageFor(cut.id)?.bytes ?? null,
          width,
          composeOptions(project, cut),
        );
        canvas = composed.canvas;
      }
    } else {
      const transition = this.transitionsById.get(source.id);
      if (transition) {
        canvas = composeTransitionBand(transition, width, this.referenceWidth)?.canvas ?? null;
      }
    }
    // The plan and the compositor size bands with the same single sources, so
    // a mismatch is a defect in this module, never a property of the project.
    if (!canvas || canvas.height !== source.heightAt(width) || canvas.width !== width) {
      throw new Error(`band ${source.type} "${source.id}" did not compose at its planned size`);
    }
    this.cache.set(key, canvas);
    this.onComposed();
    return canvas;
  }

  release(key: string): void {
    const canvas = this.cache.get(key);
    if (!canvas) return;
    // Release native memory now rather than at garbage-collection time.
    canvas.width = 1;
    canvas.height = 1;
    this.cache.delete(key);
  }

  releaseAll(): void {
    for (const key of [...this.cache.keys()]) this.release(key);
  }
}

async function drawFile(
  file: Pick<LayoutFile, "width" | "height" | "pieces">,
  rasters: BandRasters,
  background: string,
  afterPiece?: (index: number) => void,
): Promise<Canvas> {
  const canvas = createCanvas(file.width, file.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, file.width, file.height);
  for (const [index, piece] of file.pieces.entries()) {
    const source = await rasters.get(piece.band, piece.width);
    if (piece.top === 0 && piece.height === source.height) {
      ctx.drawImage(source, piece.x, piece.y);
    } else {
      ctx.drawImage(
        source,
        0,
        piece.top,
        piece.width,
        piece.height,
        piece.x,
        piece.y,
        piece.width,
        piece.height,
      );
    }
    afterPiece?.(index);
  }
  return canvas;
}

function encodeAndFree(canvas: Canvas, options: ResolvedOutputOptions): Uint8Array {
  try {
    return encodeCanvas(canvas, options.format, options.quality ?? undefined);
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
}

interface EncodedFile {
  layout: LayoutFile;
  bytes: Uint8Array;
}

/** Check every raster the plan will allocate, and the working set, before any canvas exists. */
function preflightPlan(
  loaded: LoadedEpisode,
  bands: readonly LayoutBand[],
  plan: LayoutPlan,
  options: ResolvedOutputOptions,
): void {
  const label = `episode "${loaded.bundle.episode.id}"`;
  const seen = new Set<string>();
  let largestBand = 0;
  for (const file of plan.files) {
    for (const piece of file.pieces) {
      const key = BandRasters.key(piece.band, piece.width);
      if (seen.has(key)) continue;
      seen.add(key);
      const band = bands[piece.band] as LayoutBand;
      const height = band.heightAt(piece.width);
      assertRasterSize(piece.width, height, `${band.type} "${band.id}"`);
      largestBand = Math.max(largestBand, piece.width * height);
    }
  }
  let largestFile = 0;
  for (const file of plan.files) {
    assertRasterSize(file.width, file.height, `${label} (${file.width} x ${file.height})`);
    largestFile = Math.max(largestFile, file.width * file.height);
  }
  // Bands live while the files that draw them render: reserve the largest band
  // twice, plus one file canvas and its raw-equivalent encoded output and retry.
  const sliceRows = options.sliceHeight ?? 0;
  const fileBytes = Math.max(largestFile, options.width * sliceRows) * 3 * 4;
  assertRasterBudget(
    loaded.imageDataBytes + largestBand * 2 * 4 + fileBytes,
    `${label} (${seen.size} rasters, ${options.width} px wide)`,
  );
}

function cannotFit(maxBytes: number): ExportError {
  return new ExportError(
    "strip.cannot-fit",
    `A single row of the episode cannot be encoded within ${maxBytes} bytes at this width and quality. Choose a smaller width, a lower quality or a larger size cap. The previous export is unchanged.`,
  );
}

/**
 * Pack the strip into parts. Each part takes the longest run of whole bands that
 * fits the part height; only a band taller than a part is split, at exact rows.
 * With a byte cap, a part that encodes too large gives back its last band, and a
 * single band is cut at the largest row count that fits, found by real encodes.
 * Width and quality never change.
 */
async function renderSlices(
  bands: readonly LayoutBand[],
  options: ResolvedOutputOptions,
  rasters: BandRasters,
  onFile: () => void,
): Promise<EncodedFile[]> {
  const sliceHeight = options.sliceHeight as number;
  const width = options.width;
  const units: SliceUnit[] = splitTallBands(
    bands.map((band) => band.heightAt(width)),
    width,
    sliceHeight,
  );
  const lastUse = new Map<string, number>();
  units.forEach((unit, i) => {
    lastUse.set(BandRasters.key(unit.band, unit.width), i);
  });
  const encode = async (
    pieces: readonly SliceUnit[],
  ): Promise<{ file: LayoutFile; bytes: Uint8Array }> => {
    let y = 0;
    const placed: LayoutPiece[] = pieces.map((unit) => {
      const piece = { ...unit, x: 0, y };
      y += unit.height;
      return piece;
    });
    const file: LayoutFile = { role: "slice", width, height: Math.max(1, y), pieces: placed };
    return {
      file,
      bytes: encodeAndFree(await drawFile(file, rasters, options.background), options),
    };
  };

  const files: EncodedFile[] = [];
  let start = 0;
  if (units.length === 0) {
    const { file, bytes } = await encode([]);
    onFile();
    return [{ layout: file, bytes }];
  }
  while (start < units.length) {
    let count = takeFittingPrefix(units, start, sliceHeight);
    let result = await encode(units.slice(start, start + count));
    const cap = options.maxBytes;
    if (cap !== null) {
      while (result.bytes.length > cap && count > 1) {
        count--;
        result = await encode(units.slice(start, start + count));
      }
      if (result.bytes.length > cap) {
        // This band alone is over the cap. Find the largest fitting row prefix;
        // each trial is really encoded, so no estimate can admit an oversized
        // file. Non-monotone codec sizes only affect packing, never coverage.
        const first = units[start] as SliceUnit;
        let low = 1;
        let high = first.height - 1;
        let fit: Awaited<ReturnType<typeof encode>> | undefined;
        while (low <= high) {
          const rows = Math.floor((low + high) / 2);
          const trial = await encode([{ ...first, height: rows }]);
          if (trial.bytes.length <= cap) {
            fit = trial;
            low = rows + 1;
          } else {
            high = rows - 1;
          }
        }
        if (!fit) throw cannotFit(cap);
        const rows = fit.file.height;
        units[start] = { ...first, top: first.top + rows, height: first.height - rows };
        files.push({ layout: fit.file, bytes: fit.bytes });
        onFile();
        continue;
      }
    }
    files.push({ layout: result.file, bytes: result.bytes });
    onFile();
    start += count;
    for (const [key, last] of lastUse) if (last < start) rasters.release(key);
  }
  return files;
}

/** Render every file of a fixed plan, freeing each band after its last use. */
async function renderPlan(
  plan: LayoutPlan,
  options: ResolvedOutputOptions,
  rasters: BandRasters,
  onFile: () => void,
): Promise<EncodedFile[]> {
  // The last piece that draws each band: it is freed right after, so a whole
  // strip never holds every band and the page at once.
  const lastUse = new Map<string, string>();
  plan.files.forEach((file, i) => {
    file.pieces.forEach((piece, j) => {
      lastUse.set(BandRasters.key(piece.band, piece.width), `${i}:${j}`);
    });
  });
  const files: EncodedFile[] = [];
  for (const [i, layout] of plan.files.entries()) {
    const canvas = await drawFile(layout, rasters, options.background, (j) => {
      const piece = layout.pieces[j] as LayoutPiece;
      const key = BandRasters.key(piece.band, piece.width);
      if (lastUse.get(key) === `${i}:${j}`) rasters.release(key);
    });
    files.push({ layout, bytes: encodeAndFree(canvas, options) });
    onFile();
  }
  return files;
}

function manifestItems(
  file: LayoutFile,
  bands: readonly LayoutBand[],
  contentWidth: number,
): ManifestItem[] {
  return file.pieces.map((piece) => {
    const band = bands[piece.band] as LayoutBand;
    const item: ManifestItem = { type: band.type, id: band.id, index: band.index };
    if (piece.top > 0 || piece.height < band.heightAt(piece.width)) {
      item.top = piece.top;
      item.height = piece.height;
    }
    if (piece.width !== contentWidth) item.width = piece.width;
    return item;
  });
}

function fileName(file: LayoutFile, index: number, count: number, ext: string): string {
  if (file.role === "strip") return `episode.${ext}`;
  return `${String(index + 1).padStart(Math.max(3, String(count).length), "0")}.${ext}`;
}

function checkOptions(kind: ExportTargetKind, options: ResolvedOutputOptions): void {
  if (kind === "strip" && options.maxBytes !== null && options.sliceHeight === null) {
    throw new ExportError(
      "strip.size-cap-needs-parts",
      "A file size cap needs a part height. Set a part height, then export again.",
    );
  }
  if (kind === "cuts" && options.contentWidth < 1) {
    throw new ExportError(
      "cuts.margin-too-large",
      `The margin leaves no room for the cut. Use a margin under ${Math.ceil(options.width / 2)} px.`,
    );
  }
}

/** Run one engine over an episode and publish its folder with a manifest. */
async function runOutput(
  root: string,
  episodeId: string,
  kind: ExportTargetKind,
  input: ExportOptions,
  run: ExportRun,
): Promise<ExportOutput> {
  const output =
    run.output ??
    (kind === "social" ? socialOutputForFrame(input.frame ?? "instagram-portrait") : kind);
  if (!isPathSafeId(output) || (LEGACY_EXPORT_DIRS as readonly string[]).includes(output)) {
    throw new ExportError("export.invalid-output", `"${output}" is not a valid output name.`);
  }
  const loaded = await loadEpisode(root, episodeId);
  const { project, bundle } = loaded;
  const referenceWidth = resolveReferenceWidth(project.webtoon.referenceWidth);
  const options = resolveOutputOptions(kind, input, referenceWidth);
  checkOptions(kind, options);
  const bands = loadedBands(loaded);
  const plan = planOutput(bands, options, referenceWidth);

  if (kind === "strip" && options.sliceHeight === null) {
    // One image of the whole page: the stitched-page plan and budget.
    preflightPage(loaded, options.width);
  } else {
    preflightPlan(loaded, bands, plan, options);
  }

  const rasterKeys = new Set(
    plan.files.flatMap((file) => file.pieces.map((p) => BandRasters.key(p.band, p.width))),
  );
  let done = 0;
  let total = rasterKeys.size + plan.files.length + 1;
  const step = () => {
    done++;
    total = Math.max(total, done + 1);
    run.onProgress?.({ done, total });
  };
  run.onProgress?.({ done, total });

  const rasters = new BandRasters(loaded, bands, step);
  let encoded: EncodedFile[];
  try {
    encoded =
      kind === "strip" && options.sliceHeight !== null
        ? await renderSlices(bands, options, rasters, step)
        : await renderPlan(plan, options, rasters, step);
  } finally {
    rasters.releaseAll();
  }

  const outRel = episodeExportRelDir(episodeId, output);
  const outAbs = `${root}/${outRel}`;
  const ext = options.format === "jpeg" ? "jpg" : "png";
  const outputs = new Map<string, string | Uint8Array>();
  const files: ManifestFile[] = encoded.map(({ layout, bytes }, i) => {
    const name = fileName(layout, i, encoded.length, ext);
    outputs.set(name, bytes);
    const file: ManifestFile = {
      path: `${outRel}/${name}`,
      format: options.format,
      width: layout.width,
      height: layout.height,
      byteSize: bytes.length,
      quality: options.quality,
      sha256: sha256Hex(bytes),
      role: layout.role,
      items: manifestItems(layout, bands, options.contentWidth),
    };
    if (layout.post !== undefined) file.post = layout.post;
    return file;
  });

  const manifest: ExportManifest = {
    manifestVersion: MANIFEST_VERSION,
    kind,
    output,
    projectId: project.webtoon.projectId,
    episodeId: bundle.episode.id,
    width: options.width,
    options: {
      format: options.format,
      quality: options.quality,
      contentWidth: options.contentWidth,
      sliceHeight: options.sliceHeight,
      maxBytes: options.maxBytes,
      margin: options.margin,
      textCards: options.textCards,
      frame: options.frame
        ? {
            id: options.frame.id,
            width: options.frame.width,
            height: options.frame.height,
            safe: { ...options.frame.safe },
          }
        : null,
      tallCuts: options.tallCuts,
      imagesPerPost: options.frame?.imagesPerPost ?? null,
      background: options.background,
    },
    files,
    warnings: plan.warnings.map((warning) => ({ ...warning, items: [...warning.items] })),
    inputs: { sha256: computeInputsHash(project, bundle, loaded.artHashes) },
  };
  outputs.set(MANIFEST_FILE, stableJson(manifest));
  await publishExport(outAbs, outRel, outputs);
  step();
  return { manifest, outDir: outAbs };
}

/** The episode as one tall image, or with `sliceHeight` as parts that restack exactly. */
export function exportStrip(
  root: string,
  episodeId: string,
  options: ExportOptions = {},
  run: ExportRun = {},
): Promise<ExportOutput> {
  return runOutput(root, episodeId, "strip", options, run);
}

/** One image per cut (and per text card with `textCards`), padded by `margin`. */
export function exportCuts(
  root: string,
  episodeId: string,
  options: ExportOptions = {},
  run: ExportRun = {},
): Promise<ExportOutput> {
  return runOutput(root, episodeId, "cuts", options, run);
}

/** The episode laid out on fixed social frames, grouped into posts. */
export function exportSocial(
  root: string,
  episodeId: string,
  options: ExportOptions = {},
  run: ExportRun = {},
): Promise<ExportOutput> {
  return runOutput(root, episodeId, "social", options, run);
}

function definedOptions(options: ExportOptions): ExportOptions {
  return Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== undefined),
  ) as ExportOptions;
}

/**
 * Run a preset: its pinned options, overridden by any explicit `overrides`, into
 * the folder named after the preset.
 */
export function exportWithPreset(
  root: string,
  episodeId: string,
  preset: ExportPreset,
  overrides: ExportOptions = {},
  run: Omit<ExportRun, "output"> = {},
): Promise<ExportOutput> {
  const options = { ...preset.options, ...definedOptions(overrides) };
  return runOutput(root, episodeId, preset.target, options, { ...run, output: preset.id });
}
