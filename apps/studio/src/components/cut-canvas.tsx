// Cut canvas — the SEAM between issue #6 (shell) and issue #7 (rich preview).
//
// #6 owns this component boundary and renders a readable, structural view of a
// cut: its id, whether an image asset is associated, and its bubble text in
// reading order. #7 will fill this canvas with the actual cut image and place
// bubble overlays at their normalized geometry/tail positions. Keep the props
// surface (the full `Cut` plus its `LetteringOverlay[]`) so #7 can render
// without changing callers.

import type { Cut, LetteringOverlay } from "@toony/schema";

export interface CutCanvasProps {
  cut: Cut;
  /** Overlays whose `cutId` matches this cut, in declaration order. */
  bubbles: LetteringOverlay[];
}

export function CutCanvas({ cut, bubbles }: CutCanvasProps) {
  const hasArt = Boolean(cut.image?.clean || cut.image?.final);
  return (
    <div className="cut-block" data-testid={`cut-${cut.id}`}>
      <div className="seq-item-head">
        <span className="chip chip-accent">Cut</span>
        <span className="seq-id">{cut.id}</span>
      </div>
      {/*
        #7 fills this canvas with the cut image and positioned bubble overlays.
        Until then it states the asset readiness so the sequence stays readable.
      */}
      <div className="cut-canvas">
        <span className="chip">{hasArt ? "Image linked" : "No image yet"}</span>
        <span className="cut-canvas-hint">
          {hasArt
            ? "Cut artwork renders here in the rich preview."
            : "Link a cut image to see artwork here."}
        </span>
      </div>
      {bubbles.length > 0 && (
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
