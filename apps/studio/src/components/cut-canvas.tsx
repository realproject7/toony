// Cut canvas — the rich READ-ONLY preview of one cut (issue #7).
//
// Renders the cut's artwork (when present) and overlays its lettering bubbles as
// SVG, positioned/sized/styled entirely by `@toony/render`'s geometry core — the
// SAME layout the focused editor (#8) and the canvas export (#10) consume, so
// the preview is WYSIWYG and cannot drift. No editing happens here (that is #8).
//
// The bubbles are laid out at the art's NATURAL pixel dimensions and drawn into
// an SVG whose viewBox matches those dimensions; the SVG and the <img> share one
// aspect-ratio stage, so the overlay scales with the displayed image. When no
// art is linked, the existing "No image yet" empty state is kept.

import { type BubbleRender, layoutCut } from "@toony/render";
import type { Cut, LetteringOverlay } from "@toony/schema";
import Link from "next/link";
import type { CutArt } from "@/lib/project";

export interface CutCanvasProps {
  cut: Cut;
  /** Overlays whose `cutId` matches this cut, in reading order. */
  bubbles: LetteringOverlay[];
  /** Resolved art src + natural dimensions (from `resolveCutArt`). */
  art: CutArt;
  /** Owning episode id, used to link to the focused cut editor (#8). */
  episodeId: string;
}

/** One bubble drawn as SVG from its geometry-core render plan. */
function Bubble({ plan }: { plan: BubbleRender }) {
  const fontSize = plan.text.fontSize;
  return (
    <g data-bubble-id={plan.id} data-overflow={plan.overflow ? "true" : undefined}>
      {plan.hasBubble && (
        <path
          d={plan.pathD}
          fill={plan.fill}
          fillOpacity={plan.fillOpacity}
          stroke={plan.stroke}
          strokeWidth={plan.strokeWidth}
          strokeLinejoin="round"
        />
      )}
      {plan.lines.map((line, i) => (
        <text
          // biome-ignore lint/suspicious/noArrayIndexKey: wrapped lines are a positional, read-only layout output — the index is the stable identity within a single layout pass.
          key={`${plan.id}-line-${i}`}
          x={line.centerX}
          y={line.y + fontSize}
          fontSize={fontSize}
          fontWeight={plan.kind === "shout" || plan.kind === "sfx" ? 700 : 400}
          textAnchor="middle"
          fill={plan.textColor}
          stroke={plan.kind === "sfx" ? plan.stroke : undefined}
          strokeWidth={plan.kind === "sfx" ? Math.max(1, fontSize * 0.06) : undefined}
          paintOrder="stroke"
        >
          {line.text}
        </text>
      ))}
    </g>
  );
}

export function CutCanvas({ cut, bubbles, art, episodeId }: CutCanvasProps) {
  const hasArt = Boolean(art.src);
  const plans = layoutCut(bubbles, art.width, art.height);
  const aspectRatio = `${art.width} / ${art.height}`;

  return (
    <div className="cut-block" data-testid={`cut-${cut.id}`}>
      <div className="seq-item-head">
        <span className="chip chip-accent">Cut</span>
        <span className="seq-id">{cut.id}</span>
        {bubbles.length > 0 && (
          <span className="chip">
            {bubbles.length} bubble{bubbles.length === 1 ? "" : "s"}
          </span>
        )}
        <Link
          href={`/episodes/${encodeURIComponent(episodeId)}/cuts/${encodeURIComponent(cut.id)}/edit`}
          className="cut-edit-link"
          data-testid={`cut-edit-${cut.id}`}
        >
          Edit lettering
        </Link>
      </div>

      {hasArt ? (
        <div className="cut-stage" style={{ aspectRatio }} data-testid={`cut-stage-${cut.id}`}>
          {/* The cut artwork. Read-only preview; no upload/import happens here. */}
          {/* biome-ignore lint/performance/noImgElement: local-first studio serves project files directly, not via the Next image optimizer. */}
          <img className="cut-art" src={art.src ?? undefined} alt={`Artwork for ${cut.id}`} />
          {plans.length > 0 && (
            <svg
              className="cut-overlays"
              viewBox={`0 0 ${art.width} ${art.height}`}
              preserveAspectRatio="none"
              role="presentation"
              aria-hidden="true"
            >
              {plans.map((plan) => (
                <Bubble key={plan.id} plan={plan} />
              ))}
            </svg>
          )}
        </div>
      ) : (
        <div className="cut-canvas">
          <span className="chip">No image yet</span>
          <span className="cut-canvas-hint">Link a cut image to see artwork here.</span>
        </div>
      )}

      {/* A compact, readable text list mirrors the overlaid bubbles for quick
          scanning and for cuts whose art is not yet linked. */}
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
