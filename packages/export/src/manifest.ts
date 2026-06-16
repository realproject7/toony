// The export manifest schema — owned by #10. Every export target writes a
// manifest describing its outputs with project-relative paths, dimensions, byte
// sizes, format/compression, generated-markdown metadata, and checksums. #11
// lints completeness against this contract.

import { createHash } from "node:crypto";
import type { RasterFormat } from "./encode.js";

export const MANIFEST_VERSION = 1;
export const MANIFEST_FILE = "manifest.json";

export type ExportTargetKind = "platform" | "stitched" | "plotlink";

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
}

export interface ManifestMarkdown {
  /** Project-relative path to the generated markdown. */
  path: string;
  /** Character count of the generated markdown (enforced to 500..10000). */
  characters: number;
  sha256: string;
}

export interface ExportManifest {
  manifestVersion: number;
  target: ExportTargetKind;
  projectId: string;
  episodeId: string;
  /** Export render width in px. */
  width: number;
  /** Output files in reading order. */
  files: ManifestFile[];
  /** Generated PlotLink markdown, present only for the plotlink target. */
  markdown: ManifestMarkdown | null;
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

/**
 * Validate a manifest's structure and the public-safety rule that every path is
 * project-relative. Returns a list of problems (empty when valid) so #11 can
 * lint completeness without depending on a throw.
 */
export function validateManifest(value: unknown): string[] {
  const problems: string[] = [];
  if (typeof value !== "object" || value === null) return ["manifest must be an object"];
  const m = value as Record<string, unknown>;

  if (m.manifestVersion !== MANIFEST_VERSION) problems.push("manifestVersion mismatch");
  if (m.target !== "platform" && m.target !== "stitched" && m.target !== "plotlink") {
    problems.push("target must be platform|stitched|plotlink");
  }
  for (const key of ["projectId", "episodeId"]) {
    if (typeof m[key] !== "string" || (m[key] as string).length === 0) {
      problems.push(`${key} must be a non-empty string`);
    }
  }
  if (typeof m.width !== "number" || m.width <= 0) problems.push("width must be a positive number");

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
      if (typeof f.sha256 !== "string" || (f.sha256 as string).length !== 64) {
        problems.push(`files[${i}].sha256 must be a 64-char hex digest`);
      }
    });
  }

  if (m.markdown !== null && m.markdown !== undefined) {
    const md = m.markdown as Record<string, unknown>;
    if (typeof md.path !== "string" || !isProjectRelative(md.path)) {
      problems.push("markdown.path must be a project-relative path");
    }
    if (typeof md.characters !== "number" || md.characters < 500 || md.characters > 10000) {
      problems.push("markdown.characters must be within 500..10000");
    }
  }

  return problems;
}
