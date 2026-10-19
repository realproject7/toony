// Output layout planning: which rows of which rendered band land where in every
// exported file. Pure arithmetic over band heights, with no canvas and no Node
// imports, so the export engine renders from these plans AND the Studio previews
// the very same layout in the browser ("@toony/export/layout").
//
// Band heights come from the single sources the compositor sizes rasters with:
// `cutRasterHeight` for cuts and `resolveBandHeight` for transitions. A plan is
// therefore the exact geometry of the files the engine will write.

import {
  cutHeightAt,
  drawnBandAppearance,
  layoutTransition,
  resolveBandHeight,
  resolveCutAspect,
} from "@toony/render";
import type {
  EpisodeBundle,
  ExportFormat,
  ExportOptionValues,
  ExportTargetKind,
  SocialFrameId,
  TallCutMode,
} from "@toony/schema";
import {
  CUTS_DEFAULT_WIDTH,
  DEFAULT_JPEG_QUALITY,
  EXPORT_BACKGROUND,
  type FrameInsets,
  SOCIAL_FIT_MIN_SCALE,
  SOCIAL_FRAMES,
  type SocialFrame,
} from "./defaults.js";

/**
 * The raster height of a cut at `width`. With art, the art's own aspect wins;
 * without, the cut's declared panel shape (else the fallback). The compositor,
 * allocation preflight and every layout plan use this one rule.
 */
export function cutRasterHeight(
  width: number,
  panelAspect: number | undefined,
  image: { width: number; height: number } | null,
): number {
  return image
    ? Math.max(1, Math.round((image.height * width) / image.width))
    : cutHeightAt(width, resolveCutAspect(panelAspect, null).aspect);
}

/**
 * How a band reads in an export: a cut, a transition that carries words (a text
 * card), a plain gap in the page's own ground (a spacer), or a drawn field.
 */
export type BandRole = "cut" | "card" | "spacer" | "field";

/** One item of the episode sequence, ready to be laid out at any width. */
export interface LayoutBand {
  /** Position in the episode sequence (a recurring cut appears once per use). */
  index: number;
  type: "cut" | "transition";
  id: string;
  role: BandRole;
  /** 1-based cut number in reading order (cuts only). */
  cutNumber?: number;
  /** Whether the cut has artwork (cuts only). */
  hasArt?: boolean;
  /** Raster height at a composed width; 0 means the band draws nothing. */
  heightAt(width: number): number;
}

export interface LayoutBandsInput {
  bundle: Pick<EpisodeBundle, "episode" | "cuts" | "transitions">;
  referenceWidth: number;
  /** Artwork size for a cut, or null when the cut has none. */
  artSize(cutId: string): { width: number; height: number } | null;
}

/** The episode sequence as layout bands, in reading order. */
export function layoutBands(input: LayoutBandsInput): LayoutBand[] {
  const cuts = new Map(input.bundle.cuts.map((cut) => [cut.id, cut]));
  const transitions = new Map(input.bundle.transitions.map((t) => [t.id, t]));
  const bands: LayoutBand[] = [];
  let cutNumber = 0;
  input.bundle.episode.sequence.forEach((item, index) => {
    if (item.type === "cut") {
      const cut = cuts.get(item.id);
      if (!cut) return;
      const art = input.artSize(cut.id);
      cutNumber++;
      bands.push({
        index,
        type: "cut",
        id: cut.id,
        role: "cut",
        cutNumber,
        hasArt: art !== null,
        heightAt: (width) => cutRasterHeight(width, cut.panelAspect, art),
      });
      return;
    }
    const transition = transitions.get(item.id);
    if (!transition) return;
    const render = layoutTransition(transition);
    const reading = drawnBandAppearance(render);
    bands.push({
      index,
      type: "transition",
      id: transition.id,
      role: reading === "card" ? "card" : reading === "page-background" ? "spacer" : "field",
      heightAt: (width) => resolveBandHeight(render, width, input.referenceWidth),
    });
  });
  return bands;
}

/** Rows of one band drawn into one output file. */
export interface LayoutPiece {
  /** Index into the band list the plan was made from. */
  band: number;
  /** Width the band is composed at. */
  width: number;
  /** First band row drawn. */
  top: number;
  /** Rows drawn. */
  height: number;
  /** Placement in the output file. */
  x: number;
  y: number;
}

export type LayoutFileRole = "strip" | "slice" | "cut" | "card" | "frame";

export interface LayoutFile {
  role: LayoutFileRole;
  width: number;
  height: number;
  pieces: LayoutPiece[];
  /** 1-based post this file belongs to (social only). */
  post?: number;
}

export interface LayoutWarning {
  code: string;
  message: string;
  /** Sequence item ids the warning is about. */
  items: string[];
}

export interface LayoutPlan {
  files: LayoutFile[];
  warnings: LayoutWarning[];
}

/** A run of rows in reading order, before it is assigned to a file. */
export interface SliceUnit {
  band: number;
  width: number;
  top: number;
  height: number;
}

/**
 * Cut every band taller than `maxHeight` into chunks of exactly `maxHeight`
 * rows (the last one shorter). Shorter bands stay whole. Zero-height bands are
 * dropped: they draw nothing.
 */
export function splitTallBands(
  heights: readonly number[],
  width: number,
  maxHeight: number,
): SliceUnit[] {
  const units: SliceUnit[] = [];
  heights.forEach((height, band) => {
    for (let top = 0; top < height; top += maxHeight) {
      units.push({ band, width, top, height: Math.min(maxHeight, height - top) });
    }
  });
  return units;
}

/**
 * Greedily take the longest prefix of units that fits `maxHeight`, starting at
 * `start`. Returns how many units were taken (at least one: a unit is never
 * taller than the cap after `splitTallBands`).
 */
export function takeFittingPrefix(
  units: readonly SliceUnit[],
  start: number,
  maxHeight: number,
): number {
  let count = 0;
  let height = 0;
  while (start + count < units.length) {
    const next = (units[start + count] as SliceUnit).height;
    if (count > 0 && height + next > maxHeight) break;
    height += next;
    count++;
  }
  return count;
}

/** Group units into slices: whole bands where they fit, exact row splits otherwise. */
export function packSlices(units: readonly SliceUnit[], maxHeight: number): SliceUnit[][] {
  const slices: SliceUnit[][] = [];
  let start = 0;
  while (start < units.length) {
    const count = takeFittingPrefix(units, start, maxHeight);
    slices.push(units.slice(start, start + count));
    start += count;
  }
  return slices;
}

function stack(units: readonly SliceUnit[], x = 0, y = 0): LayoutPiece[] {
  let top = y;
  return units.map((unit) => {
    const piece = { ...unit, x, y: top };
    top += unit.height;
    return piece;
  });
}

function sum(units: readonly { height: number }[]): number {
  return units.reduce((total, unit) => total + unit.height, 0);
}

function cutLabel(band: LayoutBand): string {
  return band.type === "cut" ? `Cut ${band.cutNumber ?? "?"}` : "A text card";
}

/** List names in a sentence: "Cut 2, Cut 5 and Cut 9". Long lists are shortened. */
export function listNames(names: readonly string[], limit = 6): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length > limit) {
    return `${names.slice(0, limit).join(", ")} and ${names.length - limit} more`;
  }
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** A warning for every cut in the plan's sequence that has no artwork. */
export function artlessWarning(bands: readonly LayoutBand[]): LayoutWarning | null {
  const artless = bands.filter((band) => band.type === "cut" && band.hasArt === false);
  const ids = [...new Set(artless.map((band) => band.id))];
  if (ids.length === 0) return null;
  const names = [...new Set(artless.map(cutLabel))];
  return {
    code: "artless-cuts",
    message:
      ids.length === 1
        ? `${names[0]} has no artwork yet. It exports as a plain panel.`
        : `${ids.length} cuts have no artwork yet: ${listNames(names)}. They export as plain panels.`,
    items: ids,
  };
}

export interface StripLayoutOptions {
  width: number;
  /** Split into parts no taller than this. Omitted: one image. */
  sliceHeight?: number;
}

/** The whole episode as one image, or as parts that restack to the same pixels. */
export function planStrip(bands: readonly LayoutBand[], options: StripLayoutOptions): LayoutPlan {
  const width = options.width;
  const heights = bands.map((band) => band.heightAt(width));
  const warnings = [artlessWarning(bands)].filter((w): w is LayoutWarning => w !== null);
  if (options.sliceHeight === undefined) {
    const units = splitTallBands(heights, width, Number.POSITIVE_INFINITY);
    const pieces = stack(units);
    return {
      files: [{ role: "strip", width, height: Math.max(1, sum(units)), pieces }],
      warnings,
    };
  }
  const units = splitTallBands(heights, width, options.sliceHeight);
  const slices = packSlices(units, options.sliceHeight);
  if (slices.length === 0) slices.push([]);
  return {
    files: slices.map((slice) => ({
      role: "slice",
      width,
      height: Math.max(1, sum(slice)),
      pieces: stack(slice),
    })),
    warnings,
  };
}

export interface CutsLayoutOptions {
  width: number;
  margin: number;
  /** Also lay out text-card transitions as their own images. */
  textCards: boolean;
}

/** One image per cut (and per text card when asked), each padded by `margin`. */
export function planCuts(bands: readonly LayoutBand[], options: CutsLayoutOptions): LayoutPlan {
  const contentWidth = options.width - 2 * options.margin;
  const files: LayoutFile[] = [];
  bands.forEach((band, index) => {
    if (band.role !== "cut" && !(options.textCards && band.role === "card")) return;
    const height = band.heightAt(contentWidth);
    if (height <= 0) return;
    files.push({
      role: band.role === "cut" ? "cut" : "card",
      width: options.width,
      height: height + 2 * options.margin,
      pieces: [
        {
          band: index,
          width: contentWidth,
          top: 0,
          height,
          x: options.margin,
          y: options.margin,
        },
      ],
    });
  });
  const warnings = [artlessWarning(bands)].filter((w): w is LayoutWarning => w !== null);
  return { files, warnings };
}

/** The content box of a frame: the frame minus its safe insets. */
export function frameContentBox(frame: { width: number; height: number; safe: FrameInsets }): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return {
    x: frame.safe.left,
    y: frame.safe.top,
    width: frame.width - frame.safe.left - frame.safe.right,
    height: frame.height - frame.safe.top - frame.safe.bottom,
  };
}

/**
 * The widest composition of a band that fits `maxHeight`, at most `maxWidth`.
 * Returns null when no width of at least 1 fits.
 */
export function fitWidth(band: LayoutBand, maxWidth: number, maxHeight: number): number | null {
  const full = band.heightAt(maxWidth);
  if (full <= maxHeight) return maxWidth;
  let width = Math.min(maxWidth, Math.floor((maxWidth * maxHeight) / full));
  while (width >= 1 && band.heightAt(width) > maxHeight) width--;
  return width >= 1 ? width : null;
}

export interface SocialLayoutOptions {
  frame: SocialFrameId | SocialFrame;
  tallCuts: TallCutMode;
  /** The project's reference column, for the legibility floor of a fitted cut. */
  referenceWidth: number;
}

/**
 * Lay the episode out on fixed frames. Bands are composed at the width of the
 * frame's content box and packed whole into frames; spacers that would start or
 * end a frame are dropped. A band taller than the box is split into rows, or with
 * `tallCuts: "fit"` composed narrower so it fits whole, when that stays legible.
 * Frames are grouped into posts of the frame's post size.
 */
export function planSocial(bands: readonly LayoutBand[], options: SocialLayoutOptions): LayoutPlan {
  const frame = typeof options.frame === "string" ? SOCIAL_FRAMES[options.frame] : options.frame;
  const box = frameContentBox(frame);
  const warnings: LayoutWarning[] = [];
  const artless = artlessWarning(bands);
  if (artless) warnings.push(artless);
  const split: { band: LayoutBand; parts: number }[] = [];
  const tooSmall: LayoutBand[] = [];

  const units: (SliceUnit & { spacer: boolean })[] = [];
  bands.forEach((band, index) => {
    const height = band.heightAt(box.width);
    if (height <= 0) return;
    const spacer = band.role === "spacer";
    if (height <= box.height) {
      units.push({ band: index, width: box.width, top: 0, height, spacer });
      return;
    }
    if (spacer) return;
    if (options.tallCuts === "fit") {
      const width = fitWidth(band, box.width, box.height);
      if (width !== null && width / options.referenceWidth >= SOCIAL_FIT_MIN_SCALE) {
        units.push({ band: index, width, top: 0, height: band.heightAt(width), spacer });
        return;
      }
      tooSmall.push(band);
    }
    const parts = splitTallBands([height], box.width, box.height).map((unit) => ({
      ...unit,
      band: index,
      spacer,
    }));
    split.push({ band, parts: parts.length });
    units.push(...parts);
  });

  const pages: SliceUnit[][] = [];
  let page: (SliceUnit & { spacer: boolean })[] = [];
  const close = () => {
    while (page.length > 0 && page.at(-1)?.spacer) page.pop();
    if (page.length > 0) pages.push(page);
    page = [];
  };
  for (const unit of units) {
    if (page.length === 0 && unit.spacer) continue;
    if (page.length > 0 && sum(page) + unit.height > box.height) {
      close();
      if (unit.spacer) continue;
    }
    page.push(unit);
  }
  close();

  const files: LayoutFile[] = pages.map((units, i) => {
    const contentHeight = sum(units);
    const top = box.y + Math.floor((box.height - contentHeight) / 2);
    let y = top;
    const pieces = units.map((unit) => {
      const piece: LayoutPiece = {
        band: unit.band,
        width: unit.width,
        top: unit.top,
        height: unit.height,
        x: box.x + Math.floor((box.width - unit.width) / 2),
        y,
      };
      y += unit.height;
      return piece;
    });
    return {
      role: "frame",
      width: frame.width,
      height: frame.height,
      pieces,
      post: Math.floor(i / frame.imagesPerPost) + 1,
    };
  });

  if (tooSmall.length > 0) {
    warnings.push({
      code: "social.fit-too-small",
      message: `${listNames(tooSmall.map(cutLabel))} would be too small to read if fitted whole, so ${tooSmall.length === 1 ? "it is" : "they are"} split into rows.`,
      items: tooSmall.map((band) => band.id),
    });
  }
  if (split.length > 0) {
    warnings.push({
      code: "social.split",
      message:
        split.length === 1
          ? `${cutLabel(split[0]?.band as LayoutBand)} is split across ${split[0]?.parts} images.`
          : `${split.length} tall panels are split across images: ${listNames(split.map(({ band, parts }) => `${cutLabel(band)} (${parts})`))}.`,
      items: split.map(({ band }) => band.id),
    });
  }
  const posts = files.at(-1)?.post ?? 0;
  if (posts > 1) {
    warnings.push({
      code: "social.posts",
      message: `This needs ${posts} posts of up to ${frame.imagesPerPost} images.`,
      items: [],
    });
  }
  return { files, warnings };
}

/** Every option an output runs with, after defaults are applied. */
export interface ResolvedOutputOptions {
  kind: ExportTargetKind;
  /** Width of the output images. */
  width: number;
  /** Width bands are composed at (cut width, or the frame's content box). */
  contentWidth: number;
  format: ExportFormat;
  quality: number | null;
  sliceHeight: number | null;
  maxBytes: number | null;
  margin: number;
  textCards: boolean;
  frame: SocialFrame | null;
  tallCuts: TallCutMode | null;
  background: string;
}

/**
 * Apply each engine's defaults: the strip is as wide as the project's reference
 * column, cut images are 1200 px wide, social frames fix their own size. PNG is
 * the default format; JPEG quality defaults to 82. A social output without a
 * frame uses the Instagram portrait frame.
 */
export function resolveOutputOptions(
  kind: ExportTargetKind,
  options: ExportOptionValues,
  referenceWidth: number,
): ResolvedOutputOptions {
  const format: ExportFormat = options.format ?? "png";
  const quality = format === "jpeg" ? (options.quality ?? DEFAULT_JPEG_QUALITY) : null;
  const base = {
    kind,
    format,
    quality,
    sliceHeight: null,
    maxBytes: null,
    margin: 0,
    textCards: false,
    frame: null,
    tallCuts: null,
    background: EXPORT_BACKGROUND,
  };
  if (kind === "strip") {
    const width = Math.max(1, Math.round(options.width ?? referenceWidth));
    return {
      ...base,
      width,
      contentWidth: width,
      sliceHeight: options.sliceHeight ?? null,
      maxBytes: options.maxBytes ?? null,
    };
  }
  if (kind === "cuts") {
    const width = Math.max(1, Math.round(options.width ?? CUTS_DEFAULT_WIDTH));
    const margin = Math.max(0, Math.round(options.margin ?? 0));
    return {
      ...base,
      width,
      contentWidth: width - 2 * margin,
      margin,
      textCards: options.textCards ?? false,
    };
  }
  const frame = SOCIAL_FRAMES[options.frame ?? "instagram-portrait"];
  return {
    ...base,
    width: frame.width,
    contentWidth: frameContentBox(frame).width,
    frame,
    tallCuts: options.tallCuts ?? "split",
  };
}

/** The layout plan of an output with resolved options. */
export function planOutput(
  bands: readonly LayoutBand[],
  options: ResolvedOutputOptions,
  referenceWidth: number,
): LayoutPlan {
  if (options.kind === "strip") {
    return planStrip(bands, {
      width: options.width,
      ...(options.sliceHeight === null ? {} : { sliceHeight: options.sliceHeight }),
    });
  }
  if (options.kind === "cuts") {
    return planCuts(bands, {
      width: options.width,
      margin: options.margin,
      textCards: options.textCards,
    });
  }
  return planSocial(bands, {
    frame: options.frame ?? SOCIAL_FRAMES["instagram-portrait"],
    tallCuts: options.tallCuts ?? "split",
    referenceWidth,
  });
}
