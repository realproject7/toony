// Export manifest completeness lint.
//
// Consumes `@toony/export`'s manifest contract — `validateManifest` for
// structure/path-safety/quality bounds, and the exported PlotLink constants —
// rather than redefining any of it. On top of the structural check this adds the
// target-specific PlotLink semantics (all WebP, ≤20 images, ≤1MB each, markdown
// present), a reading-order check on the declared file order, and optional
// on-disk existence/size consistency when a file resolver is supplied.

import {
  type ExportManifest,
  PLOTLINK_MARKDOWN_MAX,
  PLOTLINK_MARKDOWN_MIN,
  PLOTLINK_MAX_BYTES,
  PLOTLINK_MAX_IMAGES,
  validateManifest,
} from "@toony/export";
import { type Finding, finding } from "./findings.js";

/** What a manifest-declared file looks like on disk (from the caller's fs). */
export interface ManifestFileProbe {
  exists: boolean;
  byteSize: number;
}

/** Resolve a manifest's project-relative path to its on-disk state, or null. */
export type ResolveManifestFile = (projectRelativePath: string) => ManifestFileProbe | null;

/** True when the declared file order is the same as its lexical (numbered) order. */
function isReadingOrderPreserved(paths: readonly string[]): boolean {
  const sorted = [...paths].sort();
  return paths.every((path, i) => path === sorted[i]);
}

/**
 * Lint one export manifest for completeness and consistency. `manifestId`
 * locates the manifest in findings (e.g. its project-relative path). When
 * `resolveFile` is provided, declared files are checked for existence and that
 * their recorded `byteSize` matches the file on disk.
 */
export function lintManifestCompleteness(
  manifest: unknown,
  manifestId: string,
  resolveFile?: ResolveManifestFile,
): Finding[] {
  // Structure, path-safety, and quality bounds are owned by @toony/export.
  const problems = validateManifest(manifest);
  if (problems.length > 0) {
    return problems.map((problem) => finding("error", "manifest/invalid", manifestId, problem));
  }

  const m = manifest as ExportManifest;
  const findings: Finding[] = [];

  if (!isReadingOrderPreserved(m.files.map((file) => file.path))) {
    findings.push(
      finding(
        "warning",
        "manifest/reading-order",
        manifestId,
        "declared file order does not match the numbered reading order.",
      ),
    );
  }

  if (m.target === "plotlink") {
    if (m.files.length > PLOTLINK_MAX_IMAGES) {
      findings.push(
        finding(
          "error",
          "manifest/plotlink-too-many-images",
          manifestId,
          `PlotLink allows at most ${PLOTLINK_MAX_IMAGES} images; manifest declares ${m.files.length}.`,
        ),
      );
    }
    for (const file of m.files) {
      if (file.format !== "webp") {
        findings.push(
          finding(
            "error",
            "manifest/plotlink-format",
            file.path,
            `PlotLink images must be WebP; "${file.path}" is ${file.format}.`,
          ),
        );
      }
      if (file.byteSize > PLOTLINK_MAX_BYTES) {
        findings.push(
          finding(
            "error",
            "manifest/plotlink-too-large",
            file.path,
            `PlotLink images must be ≤${PLOTLINK_MAX_BYTES} bytes; "${file.path}" is ${file.byteSize}.`,
          ),
        );
      }
    }
    if (!m.markdown) {
      findings.push(
        finding(
          "error",
          "manifest/plotlink-markdown-missing",
          manifestId,
          `PlotLink manifests must declare generated markdown (${PLOTLINK_MARKDOWN_MIN}..${PLOTLINK_MARKDOWN_MAX} chars).`,
        ),
      );
    }
  }

  if (resolveFile) {
    for (const file of m.files) {
      const probe = resolveFile(file.path);
      if (!probe?.exists) {
        findings.push(
          finding(
            "error",
            "manifest/missing-file",
            file.path,
            "declared export file does not exist on disk.",
          ),
        );
      } else if (probe.byteSize !== file.byteSize) {
        findings.push(
          finding(
            "warning",
            "manifest/size-mismatch",
            file.path,
            `manifest records ${file.byteSize} bytes but the file is ${probe.byteSize}.`,
          ),
        );
      }
    }
    if (m.markdown) {
      const probe = resolveFile(m.markdown.path);
      if (!probe?.exists) {
        findings.push(
          finding(
            "error",
            "manifest/missing-file",
            m.markdown.path,
            "declared markdown file does not exist on disk.",
          ),
        );
      }
    }
  }

  return findings;
}
