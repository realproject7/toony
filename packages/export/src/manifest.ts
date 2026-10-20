// The export manifest schema. Every output writes `manifest.json` next to its
// files: project-relative paths, dimensions, byte sizes, format/quality and
// checksums per file, which sequence items each file shows, the options the
// output resolved, warnings, and a hash of the inputs it was rendered from.
// `@toony/lint` checks completeness against this contract.

import { createHash } from "node:crypto";
import { EXPORT_TARGET_KINDS, type ExportTargetKind, isPathSafeId } from "@toony/schema";
import type { FrameInsets } from "./defaults.js";
import type { RasterFormat } from "./encode.js";

export const MANIFEST_VERSION = 2;
export const MANIFEST_FILE = "manifest.json";

// The export vocabulary is defined in `@toony/schema` (next to the other
// export-option rules) so a package that only VALIDATES a kind never has to
// depend on this Node/canvas engine. Re-exported here for existing consumers.
export { EXPORT_TARGET_KINDS, type ExportTargetKind };

/** What a file is: a whole strip, a strip part, a cut, a text card or a social frame. */
export const MANIFEST_FILE_ROLES = ["strip", "slice", "cut", "card", "frame"] as const;
export type ManifestFileRole = (typeof MANIFEST_FILE_ROLES)[number];

/** One sequence item a file shows, with the band rows when only part of it is drawn. */
export interface ManifestItem {
  type: "cut" | "transition";
  id: string;
  /** Position in the episode sequence. */
  index: number;
  /** First row of the item's raster drawn here (present when partial). */
  top?: number;
  /** Rows drawn here (present when partial). */
  height?: number;
  /** Width the item was composed at, when it differs from the output's content width. */
  width?: number;
}

export interface ManifestFile {
  /** Project-relative path to the output file. Never absolute. */
  path: string;
  format: RasterFormat;
  width: number;
  height: number;
  byteSize: number;
  /** Lossy quality 0..100, or null for lossless (PNG). */
  quality: number | null;
  sha256: string;
  role: ManifestFileRole;
  /** Sequence items this file shows, top to bottom. */
  items: ManifestItem[];
  /** 1-based post this file belongs to (social outputs). */
  post?: number;
}

export interface ManifestWarning {
  code: string;
  message: string;
  /** Sequence item ids the warning is about. */
  items: string[];
}

/** The options an output resolved, recorded so a file set explains itself. */
export interface ManifestOptions {
  format: RasterFormat;
  quality: number | null;
  /** Composed content width (cut width for cuts, content-box width for social). */
  contentWidth: number;
  sliceHeight: number | null;
  maxBytes: number | null;
  margin: number;
  textCards: boolean;
  frame: { id: string; width: number; height: number; safe: FrameInsets } | null;
  tallCuts: "split" | "fit" | null;
  imagesPerPost: number | null;
  background: string;
}

export interface ExportManifest {
  manifestVersion: number;
  kind: ExportTargetKind;
  /** The output id (folder name), for example "strip", "webtoon" or "instagram". */
  output: string;
  projectId: string;
  episodeId: string;
  /** Width of the output images in px. */
  width: number;
  options: ManifestOptions;
  /** Output files in reading order. */
  files: ManifestFile[];
  warnings: ManifestWarning[];
  /** SHA-256 over the project data and source artwork the output was rendered from. */
  inputs: { sha256: string };
}

/** Hex SHA-256 of bytes, for manifest integrity fields. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isProjectRelative(path: string): boolean {
  if (path.length === 0) return false;
  if (path.startsWith("/") || path.startsWith("\\")) return false;
  if (/^[A-Za-z]:[\\/]/.test(path)) return false;
  return !path.split(/[\\/]/).includes("..");
}

const HEX64 = /^[0-9a-f]{64}$/;

function isPositiveInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function validateItems(value: unknown, where: string, problems: string[]): void {
  if (!Array.isArray(value)) {
    problems.push(`${where}.items must be an array`);
    return;
  }
  value.forEach((item, i) => {
    const at = `${where}.items[${i}]`;
    if (typeof item !== "object" || item === null) {
      problems.push(`${at} must be an object`);
      return;
    }
    const it = item as Record<string, unknown>;
    if (it.type !== "cut" && it.type !== "transition")
      problems.push(`${at}.type must be cut or transition`);
    if (typeof it.id !== "string" || it.id.length === 0)
      problems.push(`${at}.id must be a non-empty string`);
    if (!isNonNegativeInteger(it.index))
      problems.push(`${at}.index must be a non-negative integer`);
    if (it.top !== undefined && !isNonNegativeInteger(it.top)) {
      problems.push(`${at}.top must be a non-negative integer`);
    }
    for (const key of ["height", "width"]) {
      if (it[key] !== undefined && !isPositiveInteger(it[key])) {
        problems.push(`${at}.${key} must be a positive integer`);
      }
    }
  });
}

/**
 * Validate a manifest's structure and the public-safety rule that every path is
 * project-relative. Returns a list of problems (empty when valid) so lint can
 * report completeness without depending on a throw.
 */
export function validateManifest(value: unknown): string[] {
  const problems: string[] = [];
  if (typeof value !== "object" || value === null) return ["manifest must be an object"];
  const m = value as Record<string, unknown>;

  if (m.manifestVersion !== MANIFEST_VERSION) problems.push("manifestVersion mismatch");
  if (!(EXPORT_TARGET_KINDS as readonly unknown[]).includes(m.kind)) {
    problems.push(`kind must be one of: ${EXPORT_TARGET_KINDS.join(", ")}`);
  }
  if (typeof m.output !== "string" || !isPathSafeId(m.output)) {
    problems.push("output must be a path-safe id");
  }
  for (const key of ["projectId", "episodeId"]) {
    if (typeof m[key] !== "string" || (m[key] as string).length === 0) {
      problems.push(`${key} must be a non-empty string`);
    }
  }
  if (!isPositiveInteger(m.width)) problems.push("width must be a positive integer");
  if (typeof m.options !== "object" || m.options === null || Array.isArray(m.options)) {
    problems.push("options must be an object");
  }

  if (!Array.isArray(m.files) || m.files.length === 0) {
    problems.push("files must be a non-empty array");
  } else {
    m.files.forEach((file, i) => {
      if (typeof file !== "object" || file === null) {
        problems.push(`files[${i}] must be an object`);
        return;
      }
      const f = file as Record<string, unknown>;
      if (typeof f.path !== "string" || !isProjectRelative(f.path)) {
        problems.push(`files[${i}].path must be a project-relative path`);
      }
      for (const num of ["width", "height", "byteSize"]) {
        if (typeof f[num] !== "number" || (f[num] as number) <= 0) {
          problems.push(`files[${i}].${num} must be a positive number`);
        }
      }
      if (typeof f.sha256 !== "string" || !HEX64.test(f.sha256)) {
        problems.push(`files[${i}].sha256 must be a 64-char hex digest`);
      }
      if (f.format === "png") {
        if (f.quality !== null) problems.push(`files[${i}].quality must be null for png`);
      } else if (f.format === "jpeg" || f.format === "webp") {
        if (typeof f.quality !== "number" || f.quality < 0 || f.quality > 100) {
          problems.push(`files[${i}].quality must be a number in 0..100 for ${f.format}`);
        }
      } else {
        problems.push(`files[${i}].format must be png, jpeg, or webp`);
      }
      if (!(MANIFEST_FILE_ROLES as readonly unknown[]).includes(f.role)) {
        problems.push(`files[${i}].role must be one of: ${MANIFEST_FILE_ROLES.join(", ")}`);
      }
      validateItems(f.items, `files[${i}]`, problems);
      if (f.post !== undefined && !isPositiveInteger(f.post)) {
        problems.push(`files[${i}].post must be a positive integer`);
      }
    });
  }

  if (!Array.isArray(m.warnings)) {
    problems.push("warnings must be an array");
  } else {
    m.warnings.forEach((warning, i) => {
      const w = warning as Record<string, unknown> | null;
      if (
        typeof w !== "object" ||
        w === null ||
        typeof w.code !== "string" ||
        typeof w.message !== "string" ||
        !Array.isArray(w.items)
      ) {
        problems.push(`warnings[${i}] must have a code, a message and items`);
      }
    });
  }
  const inputs = m.inputs as Record<string, unknown> | null | undefined;
  if (
    typeof inputs !== "object" ||
    inputs === null ||
    typeof inputs.sha256 !== "string" ||
    !HEX64.test(inputs.sha256)
  ) {
    problems.push("inputs.sha256 must be a 64-char hex digest");
  }

  return problems;
}
