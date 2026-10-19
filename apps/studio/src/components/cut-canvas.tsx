// The read-only cut in the episode preview.
//
// Renders the cut's artwork (when present) and overlays its lettering bubbles as
// SVG, positioned/sized/styled entirely by `@toony/render`'s geometry core: the
// SAME layout the cut editor and the export consume, so the preview cannot drift.
//
// The bubbles are laid out at the art's NATURAL pixel dimensions and drawn into
// an SVG whose viewBox matches those dimensions; the SVG and the <img> share one
// aspect-ratio stage, so the overlay scales with the displayed image.
//
// A cut with no artwork still exports (#211): the raster fills a neutral stage
// of the fallback aspect and draws the lettering on it, and so does this.

import { ARTLESS_CUT_FILL, GUTTER_MARGIN_FILL } from "@toony/render";
import type { Cut, LetteringOverlay } from "@toony/schema";
import { resolveCutStage } from "@/lib/cut-stage";
import type { CutArt } from "@/lib/project";
import { CutOverlay } from "./cut-overlay";

export interface CutCanvasProps {
  cut: Cut;
  /** 1-based place in reading order, shown on hover. */
  number: number;
  /** Overlays whose `cutId` matches this cut, in reading order. */
  bubbles: LetteringOverlay[];
  /** Resolved art src + natural dimensions (from `resolveCutArt`). */
  art: CutArt;
  /**
   * The project's declared dialogue language (`languages.dialogueLanguage`). It
   * picks the default dialogue face (#213); the export raster reads the same
   * field, so the preview and the exported page land on one face.
   */
  dialogueLanguage: string;
  /**
   * The project's resolved gutter strip width (#215), a fraction of the cut
   * width. It reserves the strip below AND is handed to the overlay's
   * `layoutCut`, so the artwork is kept out of exactly the band the bubbles are
   * laid into, the same strip the export reserves.
   */
  gutterBandWidth: number;
}

export function CutCanvas({
  cut,
  number,
  bubbles,
  art,
  dialogueLanguage,
  gutterBandWidth,
}: CutCanvasProps) {
  const hasArt = Boolean(art.src);
  const aspectRatio = `${art.width} / ${art.height}`;
  // Gutter placement (#98/#215): reserve the strip(s) so the artwork occupies
  // only the `art` rect, via the SAME cut-frame the export canvas reserves.
  const { reserved, artStyle } = resolveCutStage(bubbles, art.width, art.height, gutterBandWidth);

  return (
    <div className="cut-block" data-testid={`cut-${cut.id}`}>
      <div
        className="cut-stage"
        style={reserved ? { aspectRatio, background: GUTTER_MARGIN_FILL } : { aspectRatio }}
        data-reserved={reserved ? "true" : undefined}
        data-testid={`cut-stage-${cut.id}`}
      >
        {hasArt ? (
          // biome-ignore lint/performance/noImgElement: local-first studio serves project files directly, not via the Next image optimizer.
          <img
            className="cut-art"
            style={artStyle}
            src={art.src ?? undefined}
            alt={`Cut ${number}`}
          />
        ) : (
          // The neutral paper the export fills the same rect with.
          <div
            className="cut-art"
            style={{ ...artStyle, background: ARTLESS_CUT_FILL }}
            data-testid={`cut-blank-${cut.id}`}
          />
        )}
        {/* Bubble layout needs a browser text measurer (#149); that runs in the
            hydrated client child, keeping the rest of this preview server-side. */}
        <CutOverlay
          bubbles={bubbles}
          art={art}
          dialogueLanguage={dialogueLanguage}
          gutterBandWidth={gutterBandWidth}
        />
        <span className="cut-number" aria-hidden="true">
          {number}
        </span>
      </div>
    </div>
  );
}
