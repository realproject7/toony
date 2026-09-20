// Cut canvas — the rich READ-ONLY preview of one cut (issue #7).
//
// Renders the cut's artwork (when present) and overlays its lettering bubbles as
// SVG, positioned/sized/styled entirely by `@toony/render`'s geometry core — the
// SAME layout the focused editor (#8) and the canvas export (#10) consume, so
// the preview is WYSIWYG and cannot drift. No editing happens here (that is #8).
//
// The bubbles are laid out at the art's NATURAL pixel dimensions and drawn into
// an SVG whose viewBox matches those dimensions; the SVG and the <img> share one
// aspect-ratio stage, so the overlay scales with the displayed image.
//
// A cut with no linked art still exports (#211): the raster fills a neutral
// stage of the fallback aspect and draws the lettering on it. Reader mode has no
// text list to carry those bubbles (#49 hides it), so it draws that same stage in
// place of the artwork. The edit preview keeps the compact "No image yet" empty
// state, because its text list already shows the author every bubble.

import { ARTLESS_CUT_FILL, GUTTER_MARGIN_FILL } from "@toony/render";
import type { Cut, LetteringOverlay } from "@toony/schema";
import Link from "next/link";
import { resolveCutStage } from "@/lib/cut-stage";
import type { CutArt } from "@/lib/project";
import { CutOverlay } from "./cut-overlay";

export interface CutCanvasProps {
  cut: Cut;
  /** Overlays whose `cutId` matches this cut, in reading order. */
  bubbles: LetteringOverlay[];
  /** Resolved art src + natural dimensions (from `resolveCutArt`). */
  art: CutArt;
  /** Owning work id, used to scope the link to the focused cut editor (#8). */
  workId: string;
  /** Owning episode id, used to link to the focused cut editor (#8). */
  episodeId: string;
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
   * laid into — and the export raster, reading the same project field through
   * the same two calls, reserves the same strip.
   */
  gutterBandWidth: number;
  /**
   * Distraction-free reader mode (#49): drop all edit chrome — the cut-id chip
   * header, the "Edit lettering" link, and the secondary bubble text list — so
   * only the rendered artwork + on-art bubbles remain, exactly as a reader sees
   * the published episode. The artwork/overlay render path is unchanged, so the
   * reader stays WYSIWYG with the preview and the export.
   */
  readOnly?: boolean;
}

export function CutCanvas({
  cut,
  bubbles,
  art,
  workId,
  episodeId,
  dialogueLanguage,
  gutterBandWidth,
  readOnly,
}: CutCanvasProps) {
  const hasArt = Boolean(art.src);
  // A reader sees the export's stage whether or not the art is linked; an author
  // gets the compact empty state, since the text list below carries the bubbles.
  const drawsStage = hasArt || readOnly === true;
  const aspectRatio = `${art.width} / ${art.height}`;
  // Gutter placement (#98/#215): reserve the strip(s) — the artwork occupies
  // only the `art` rect (the band(s) become a white reading margin where gutter
  // bubbles sit), at the width the PROJECT declares and via the SAME cut-frame
  // the export canvas reserves → parity. With no gutter bubbles the art fills
  // the whole stage (back-compat, unchanged).
  const { reserved, artStyle } = resolveCutStage(bubbles, art.width, art.height, gutterBandWidth);

  return (
    <div className="cut-block" data-testid={`cut-${cut.id}`}>
      {!readOnly && (
        <div className="seq-item-head">
          <span className="chip chip-accent">Cut</span>
          <span className="seq-id">{cut.id}</span>
          {bubbles.length > 0 && (
            <span className="chip">
              {bubbles.length} bubble{bubbles.length === 1 ? "" : "s"}
            </span>
          )}
          <Link
            href={`/w/${encodeURIComponent(workId)}/episodes/${encodeURIComponent(episodeId)}/cuts/${encodeURIComponent(cut.id)}/edit`}
            className="cut-edit-link"
            data-testid={`cut-edit-${cut.id}`}
          >
            Edit lettering
          </Link>
        </div>
      )}

      {drawsStage ? (
        <div
          className="cut-stage"
          style={reserved ? { aspectRatio, background: GUTTER_MARGIN_FILL } : { aspectRatio }}
          data-reserved={reserved ? "true" : undefined}
          data-testid={`cut-stage-${cut.id}`}
        >
          {hasArt ? (
            // The cut artwork. Read-only preview; no upload/import happens here.
            // biome-ignore lint/performance/noImgElement: local-first studio serves project files directly, not via the Next image optimizer.
            <img
              className="cut-art"
              style={artStyle}
              src={art.src ?? undefined}
              alt={`Artwork for ${cut.id}`}
            />
          ) : (
            // The neutral paper the export fills the same rect with, so the
            // reader's stage and the raster differ only in the missing art.
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
        </div>
      ) : (
        <div className="cut-canvas">
          <span className="chip">No image yet</span>
          <span className="cut-canvas-hint">Link a cut image to see artwork here.</span>
        </div>
      )}

      {/* A compact, readable text list mirrors the overlaid bubbles for quick
          scanning and for cuts whose art is not yet linked. It is an authoring
          aid, so reader mode (#49) hides it — a reader only sees on-art bubbles. */}
      {!readOnly && bubbles.length > 0 && (
        <div className="cut-bubbles">
          {bubbles.map((bubble) => (
            <div className="bubble-row" key={bubble.id}>
              <span className="bubble-speaker">{bubble.speaker || bubble.kind}</span>
              <span className="bubble-text">{bubble.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
