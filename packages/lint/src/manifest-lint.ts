// Export manifest completeness lint.
//
// Consumes `@toony/export`'s manifest contract (`validateManifest` for
// structure, path safety and quality bounds) rather than redefining it. On top
// of the structural check this adds a reading-order check on the declared file
// order, per-output consistency (image sizes, part heights and size caps, rows
// that restack without gaps, social post order), and optional on-disk existence
// and size consistency when a file resolver is supplied.

import { type ExportManifest, validateManifest } from "@toony/export";
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

/** Per-output checks that hold for every manifest the engine writes. */
function outputFindings(m: ExportManifest): Finding[] {
  const findings: Finding[] = [];
  const frame = m.options.frame;
  for (const file of m.files) {
    if (m.kind === "social" && frame) {
      if (file.width !== frame.width || file.height !== frame.height) {
        findings.push(
          finding(
            "error",
            "manifest/frame-size",
            file.path,
            `social frames must be ${frame.width} x ${frame.height}; "${file.path}" is ${file.width} x ${file.height}.`,
          ),
        );
      }
    } else if (file.width !== m.width) {
      findings.push(
        finding(
          "error",
          "manifest/width-mismatch",
          file.path,
          `the output is ${m.width} px wide; "${file.path}" is ${file.width} px.`,
        ),
      );
    }
    if (m.options.sliceHeight !== null && file.height > m.options.sliceHeight) {
      findings.push(
        finding(
          "error",
          "manifest/part-too-tall",
          file.path,
          `parts are at most ${m.options.sliceHeight} px tall; "${file.path}" is ${file.height} px.`,
        ),
      );
    }
    if (m.options.maxBytes !== null && file.byteSize > m.options.maxBytes) {
      findings.push(
        finding(
          "error",
          "manifest/over-size-cap",
          file.path,
          `files are capped at ${m.options.maxBytes} bytes; "${file.path}" is ${file.byteSize}.`,
        ),
      );
    }
  }

  // A band split across files must continue exactly where the last piece ended.
  const rowsDrawn = new Map<number, number>();
  for (const file of m.files) {
    for (const item of file.items) {
      if (item.top === undefined || item.height === undefined) continue;
      const expected = rowsDrawn.get(item.index) ?? 0;
      if (item.top !== expected) {
        findings.push(
          finding(
            "error",
            "manifest/row-gap",
            file.path,
            `${item.type} "${item.id}" continues at row ${item.top}; the previous piece ended at row ${expected}.`,
          ),
        );
      }
      rowsDrawn.set(item.index, item.top + item.height);
    }
  }

  if (m.kind === "social") {
    let previous = 1;
    for (const file of m.files) {
      if (file.post === undefined || file.post < previous || file.post > previous + 1) {
        findings.push(
          finding(
            "warning",
            "manifest/post-order",
            file.path,
            "social files must be grouped into consecutive posts in reading order.",
          ),
        );
        break;
      }
      previous = file.post;
    }
  }
  return findings;
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

  findings.push(...outputFindings(m));

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
  }

  return findings;
}
