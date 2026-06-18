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

import {
  type BubbleRender,
  cutPlacementFrame,
  IMPACT_BURST_FILL,
  IMPACT_BURST_STROKE,
  IMPACT_RAY_COLOR,
  layoutCut,
} from "@toony/render";
import type { Cut, LetteringOverlay } from "@toony/schema";
import Link from "next/link";
import type { CutArt } from "@/lib/project";
import { svgLetterSpacing, svgTextAnchor } from "@/lib/text-anchor";

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
   * Distraction-free reader mode (#49): drop all edit chrome — the cut-id chip
   * header, the "Edit lettering" link, and the secondary bubble text list — so
   * only the rendered artwork + on-art bubbles remain, exactly as a reader sees
   * the published episode. The artwork/overlay render path is unchanged, so the
   * reader stays WYSIWYG with the preview and the export.
   */
  readOnly?: boolean;
}

/** One bubble drawn as SVG from its geometry-core render plan. */
function Bubble({ plan }: { plan: BubbleRender }) {
  const fontSize = plan.text.fontSize;
  const impact = plan.impact;
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
      {/* impact_band SFX (#99): speed-lines + burst behind the text, from the
          SAME pure-segment plan the export canvas traces → pixel parity. */}
      {impact && (
        <g data-testid={`impact-${plan.id}`}>
          {impact.rays.map((ray, i) => (
            <line
              // biome-ignore lint/suspicious/noArrayIndexKey: rays are a positional, read-only layout output — the index is the stable identity within one layout pass.
              key={`${plan.id}-ray-${i}`}
              x1={ray.x1}
              y1={ray.y1}
              x2={ray.x2}
              y2={ray.y2}
              stroke={IMPACT_RAY_COLOR}
              strokeWidth={impact.rayWidth}
            />
          ))}
          <polygon
            points={impact.burst.map((p) => `${p.x},${p.y}`).join(" ")}
            fill={IMPACT_BURST_FILL}
            stroke={IMPACT_BURST_STROKE}
            strokeWidth={impact.burstStrokeWidth}
            strokeLinejoin="round"
          />
        </g>
      )}
      {plan.lines.map((line, i) => (
        <text
          // biome-ignore lint/suspicious/noArrayIndexKey: wrapped lines are a positional, read-only layout output — the index is the stable identity within a single layout pass.
          key={`${plan.id}-line-${i}`}
          x={line.anchorX}
          y={line.y + fontSize}
          fontFamily={plan.fontStack}
          fontSize={fontSize}
          fontWeight={plan.fontWeight}
          textAnchor={svgTextAnchor(plan.textAlign)}
          letterSpacing={svgLetterSpacing(plan.letterSpacing, fontSize)}
          fill={plan.textColor}
          // SFX bare text is outlined so it reads on any background. Width comes
          // from the render plan (single source: `textOutlineWidth`, >0 ⟺ SFX),
          // so the SVG preview and the export raster stroke it identically (#112).
          stroke={plan.textOutlineWidth > 0 ? plan.stroke : undefined}
          strokeWidth={plan.textOutlineWidth > 0 ? plan.textOutlineWidth : undefined}
          paintOrder="stroke"
        >
          {line.text}
        </text>
      ))}
    </g>
  );
}

export function CutCanvas({ cut, bubbles, art, workId, episodeId, readOnly }: CutCanvasProps) {
  const hasArt = Boolean(art.src);
  const plans = layoutCut(bubbles, art.width, art.height);
  const aspectRatio = `${art.width} / ${art.height}`;
  // Gutter placement (#98): reserve the strip(s) — the artwork occupies only the
  // `art` rect (the band(s) become a white reading margin where gutter bubbles
  // sit), using the SAME cut-frame the export canvas reserves → parity. With no
  // gutter bubbles the art fills the whole stage (back-compat, unchanged).
  const frame = cutPlacementFrame(bubbles, art.width, art.height);
  const reserved = frame.bands.length > 0;
  const artStyle = reserved
    ? {
        position: "absolute" as const,
        left: `${(frame.art.x / art.width) * 100}%`,
        top: 0,
        width: `${(frame.art.width / art.width) * 100}%`,
        height: "100%",
      }
    : undefined;

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

      {hasArt ? (
        <div
          className="cut-stage"
          style={reserved ? { aspectRatio, background: "#ffffff" } : { aspectRatio }}
          data-reserved={reserved ? "true" : undefined}
          data-testid={`cut-stage-${cut.id}`}
        >
          {/* The cut artwork. Read-only preview; no upload/import happens here. */}
          {/* biome-ignore lint/performance/noImgElement: local-first studio serves project files directly, not via the Next image optimizer. */}
          <img
            className="cut-art"
            style={artStyle}
            src={art.src ?? undefined}
            alt={`Artwork for ${cut.id}`}
          />
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
