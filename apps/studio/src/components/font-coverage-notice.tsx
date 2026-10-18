"use client";

import { getFontFamily } from "@toony/fonts";
import type { RenderedTextSegment } from "@toony/render";

/** Report effective faces, including failures the host's font fallback can hide. */
export function FontCoverageNotice({ segments }: { segments: readonly RenderedTextSegment[] }) {
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
  return (
    <div
      className="editor-toast editor-toast-warn"
      data-testid="font-coverage-notice"
      role="status"
    >
      {replacements.length > 0 && (
        <p>Bundled font fallback: {replacements.join(", ")}. Your selected font is preserved.</p>
      )}
      {missing.length > 0 && (
        <p>
          No bundled font covers{" "}
          {missing
            .map((point) => `U+${point.toString(16).toUpperCase().padStart(4, "0")}`)
            .join(", ")}
          . Text is preserved, but system fallback may differ in export. Choose supported characters
          before final export.
        </p>
      )}
    </div>
  );
}
