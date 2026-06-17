// Server-side export view-model helpers for the studio app (issue #53).
//
// This is the studio-side glue OVER the headless `@toony/export` engine — it does
// NOT reimplement any export logic or constraint. It (1) dispatches a requested
// target to the engine within an already-resolved work root, and (2) turns the
// engine's own manifest + constraint constants into human-readable "pre-flight"
// check rows for the UI. The engine enforces every hard constraint at write time
// (it throws an `ExportError` when a target cannot be produced), so a produced
// manifest is the authoritative source of truth: the rows below READ the manifest
// and the engine's exported limits rather than re-deriving them.

import {
  type ExportManifest,
  type ExportOptions,
  type ExportOutput,
  type ExportTargetKind,
  exportPlatform,
  exportPlotlink,
  exportStitched,
  PLOTLINK_MARKDOWN_MAX,
  PLOTLINK_MARKDOWN_MIN,
  PLOTLINK_MAX_BYTES,
  PLOTLINK_MAX_IMAGES,
  validateManifest,
} from "@toony/export";
import { type ConstraintCheck, formatBytes } from "@/lib/export-view";

export { type ConstraintCheck, formatBytes };

/** Run one export target against a resolved work root. Thin pass-through. */
export function runExportTarget(
  workRoot: string,
  target: ExportTargetKind,
  episodeId: string,
  options: ExportOptions,
): Promise<ExportOutput> {
  if (target === "platform") return exportPlatform(workRoot, episodeId, options);
  if (target === "stitched") return exportStitched(workRoot, episodeId, options);
  return exportPlotlink(workRoot, episodeId, options);
}

const MAX_BYTES_LABEL = `${(PLOTLINK_MAX_BYTES / 1_000_000).toFixed(0)} MB`;

/**
 * Derive constraint check rows from a produced manifest, using the engine's own
 * exported limits. Because the engine enforces hard constraints at write time, a
 * manifest that exists has already passed them; these rows make that explicit and
 * surface the headroom (e.g. largest image vs. the 1 MB cap) for the operator.
 */
export function deriveConstraintChecks(manifest: ExportManifest): ConstraintCheck[] {
  const checks: ConstraintCheck[] = [];

  // Manifest integrity is the engine's own contract validator (#10/#11).
  const problems = validateManifest(manifest);
  checks.push(
    problems.length === 0
      ? {
          id: "manifest-valid",
          label: "Manifest validates against the export contract",
          status: "pass",
          detail: `${manifest.files.length} file(s), schema v${manifest.manifestVersion}.`,
        }
      : {
          id: "manifest-valid",
          label: "Manifest validates against the export contract",
          status: "review",
          detail: problems.join("; "),
        },
  );

  if (manifest.target === "plotlink") {
    // WebP format — PlotLink requires every image be WebP.
    const allWebp = manifest.files.every((file) => file.format === "webp");
    checks.push({
      id: "plotlink-webp",
      label: "All images are WebP",
      status: allWebp ? "pass" : "review",
      detail: allWebp
        ? `${manifest.files.length} WebP image(s).`
        : `Some files are not WebP: ${manifest.files
            .map((file) => file.format)
            .filter((format, index, list) => list.indexOf(format) === index)
            .join(", ")}.`,
    });

    // Image count — at most PLOTLINK_MAX_IMAGES.
    const count = manifest.files.length;
    checks.push({
      id: "plotlink-count",
      label: `At most ${PLOTLINK_MAX_IMAGES} images`,
      status: count <= PLOTLINK_MAX_IMAGES ? "pass" : "review",
      detail: `${count} of ${PLOTLINK_MAX_IMAGES} images used.`,
    });

    // Per-image byte budget — each ≤ PLOTLINK_MAX_BYTES.
    const largest = manifest.files.reduce((max, file) => Math.max(max, file.byteSize), 0);
    const withinBudget = manifest.files.every((file) => file.byteSize <= PLOTLINK_MAX_BYTES);
    checks.push({
      id: "plotlink-bytes",
      label: `Each image ≤ ${MAX_BYTES_LABEL}`,
      status: withinBudget ? "pass" : "review",
      detail: `Largest image is ${formatBytes(largest)} (cap ${MAX_BYTES_LABEL}).`,
    });

    // Markdown length — within PLOTLINK_MARKDOWN_MIN..MAX characters.
    const characters = manifest.markdown?.characters ?? 0;
    const withinMarkdown =
      manifest.markdown !== null &&
      characters >= PLOTLINK_MARKDOWN_MIN &&
      characters <= PLOTLINK_MARKDOWN_MAX;
    checks.push({
      id: "plotlink-markdown",
      label: `Markdown ${PLOTLINK_MARKDOWN_MIN}–${PLOTLINK_MARKDOWN_MAX} characters`,
      status: withinMarkdown ? "pass" : "review",
      detail:
        manifest.markdown === null
          ? "No markdown was generated."
          : `${characters} characters generated.`,
    });
  } else {
    // Platform / stitched: report output footprint as an informational pass.
    const totalBytes = manifest.files.reduce((sum, file) => sum + file.byteSize, 0);
    checks.push({
      id: "output-size",
      label: "Output written",
      status: "pass",
      detail: `${manifest.files.length} file(s), ${formatBytes(totalBytes)} total.`,
    });
  }

  return checks;
}
