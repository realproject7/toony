"use client";

import { getFontFamily } from "@toony/fonts";
import type { RenderedTextSegment } from "@toony/render";

/** Report effective faces, including failures the host's font fallback can hide. */
export function FontCoverageNotice({
  segments,
  compact = false,
}: {
  segments: readonly RenderedTextSegment[];
  compact?: boolean;
}) {
  const replacements = [
    ...new Set(
      segments
        .filter((s) => s.fontFamily !== s.requestedFontFamily)
        .map(
          (s) =>
            `${getFontFamily(s.requestedFontFamily)?.name} → ${getFontFamily(s.fontFamily)?.name}`,
        ),
    ),
  ];
  const missing = [...new Set(segments.flatMap((s) => s.missingCodepoints))];
  if (!replacements.length && !missing.length) return null;
  if (compact && !missing.length)
    return (
      <details className="inspector-font-notice" data-testid="font-coverage-notice">
        <summary>Another font fills in</summary>
        <p>{replacements.join(", ")}. Your choice is kept.</p>
      </details>
    );
  return (
    <div
      className="editor-toast editor-toast-warn"
      data-testid="font-coverage-notice"
      role="status"
    >
      {replacements.length > 0 && (
        <p>Another font fills in: {replacements.join(", ")}. Your choice is kept.</p>
      )}
      {missing.length > 0 && (
        <p>
          No bundled font has {missing.map((point) => String.fromCodePoint(point)).join(" ")}. The
          export may draw {missing.length === 1 ? "it" : "them"} differently, so check the export or
          use other characters.
        </p>
      )}
    </div>
  );
}
