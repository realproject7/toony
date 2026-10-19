"use client";

import {
  type BubbleRender,
  IMPACT_BURST_FILL,
  IMPACT_BURST_STROKE,
  IMPACT_RAY_COLOR,
} from "@toony/render";
import type { LetteringOverlay } from "@toony/schema";
import type { PointerEvent, Ref } from "react";
import type { CutArt } from "@/lib/project";
import { BubbleBody } from "./bubble-body";
import { BubbleText } from "./bubble-text";
import {
  InlineLetteringText,
  type InlineTextHandle,
  type TextSelection,
} from "./inline-lettering-text";

export function LetteringCanvas({
  art,
  plans,
  bubbles,
  selectedIds,
  editingId,
  svgRef,
  inlineRef,
  displayWidth,
  artStyle,
  reserved,
  guides,
  onMove,
  onResize,
  onTail,
  onPointerMove,
  onPointerUp,
  onBackground,
  onTextChange,
  onTextSelection,
  onFinish,
  onUndo,
  onRedo,
}: {
  art: CutArt;
  plans: BubbleRender[];
  bubbles: LetteringOverlay[];
  selectedIds: readonly string[];
  editingId: string | null;
  svgRef: Ref<SVGSVGElement>;
  inlineRef: Ref<InlineTextHandle>;
  displayWidth: number;
  artStyle: React.CSSProperties | undefined;
  reserved: boolean;
  guides: { x?: number; y?: number };
  onMove: (e: PointerEvent, b: LetteringOverlay) => void;
  onResize: (e: PointerEvent, b: LetteringOverlay, c: "nw" | "ne" | "sw" | "se") => void;
  onTail: (e: PointerEvent, b: LetteringOverlay) => void;
  onPointerMove: (e: PointerEvent) => void;
  onPointerUp: (e: PointerEvent) => void;
  onBackground: (event: PointerEvent) => void;
  onTextChange: (patch: Partial<LetteringOverlay>) => void;
  onTextSelection: (selection: TextSelection) => void;
  onFinish: () => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const { width, height } = art,
    handle = (5 * width) / displayWidth;
  const editing = bubbles.find((b) => b.id === editingId),
    editingPlan = plans.find((p) => p.id === editingId);
  return (
    <div
      className="editor-stage"
      style={{
        width: displayWidth,
        maxWidth: "none",
        aspectRatio: `${width} / ${height}`,
        background: reserved ? "#ffffff" : undefined,
      }}
      data-testid="lettering-canvas"
    >
      {art.src ? (
        // biome-ignore lint/performance/noImgElement: local project asset served directly.
        <img className="cut-art" style={artStyle} src={art.src} alt="Cut artwork" />
      ) : (
        <span className="lettering-no-art">No image yet</span>
      )}
      <svg
        ref={svgRef}
        className="editor-overlays"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="application"
        tabIndex={-1}
        aria-label="Bubble editing surface"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerDown={onBackground}
      >
        <title>Bubble editing surface</title>
        {plans.map((plan) => {
          const b = bubbles.find((b) => b.id === plan.id);
          if (!b) return null;
          const selected = selectedIds.includes(b.id),
            g = plan.box,
            impact = plan.impact;
          return (
            <g key={b.id} data-bubble-id={b.id}>
              <BubbleBody plan={plan} />
              {impact && (
                <g>
                  {impact.rays.map((ray, i) => (
                    <line
                      // biome-ignore lint/suspicious/noArrayIndexKey: positional decoration output.
                      key={i}
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
                  />
                </g>
              )}
              {editingId !== b.id && <BubbleText plan={plan} />}
              <rect
                {...g}
                fill="transparent"
                stroke={selected ? "var(--color-accent)" : "transparent"}
                strokeWidth={(1.5 * width) / displayWidth}
                strokeDasharray="5 3"
                style={{ cursor: b.locked ? "not-allowed" : "move" }}
                data-handle="move"
                data-bubble-id={b.id}
                onPointerDown={(e) => onMove(e, b)}
              />
              {plan.overflow && (
                <rect
                  {...g}
                  fill="none"
                  stroke="var(--color-warning)"
                  strokeWidth={(2 * width) / displayWidth}
                  pointerEvents="none"
                />
              )}
              {selected && !b.locked && editingId !== b.id && (
                <>
                  {(
                    [
                      { c: "nw", x: g.x, y: g.y, cursor: "nwse-resize" },
                      { c: "ne", x: g.x + g.width, y: g.y, cursor: "nesw-resize" },
                      { c: "sw", x: g.x, y: g.y + g.height, cursor: "nesw-resize" },
                      { c: "se", x: g.x + g.width, y: g.y + g.height, cursor: "nwse-resize" },
                    ] as const
                  ).map((p) => (
                    <rect
                      key={p.c}
                      x={p.x - handle}
                      y={p.y - handle}
                      width={handle * 2}
                      height={handle * 2}
                      fill="var(--color-accent)"
                      stroke="#fff"
                      strokeWidth={width / displayWidth}
                      style={{ cursor: p.cursor }}
                      data-handle={`resize-${p.c}`}
                      onPointerDown={(e) => onResize(e, b, p.c)}
                    />
                  ))}
                  {plan.tail && (
                    <>
                      <line
                        x1={g.x + g.width / 2}
                        y1={g.y + g.height / 2}
                        x2={plan.tail.tip.x}
                        y2={plan.tail.tip.y}
                        stroke="var(--color-accent)"
                        strokeDasharray="4 4"
                        pointerEvents="none"
                      />
                      <circle
                        cx={plan.tail.tip.x}
                        cy={plan.tail.tip.y}
                        r={handle + 1}
                        fill="#fff"
                        stroke="var(--color-accent)"
                        strokeWidth={width / displayWidth}
                        style={{ cursor: "crosshair" }}
                        data-handle="tail"
                        onPointerDown={(e) => onTail(e, b)}
                      />
                    </>
                  )}
                </>
              )}
            </g>
          );
        })}
        {guides.x !== undefined && (
          <line
            x1={guides.x * width}
            y1={0}
            x2={guides.x * width}
            y2={height}
            stroke="var(--color-accent)"
            strokeWidth={width / displayWidth}
            strokeDasharray="4 4"
            pointerEvents="none"
          />
        )}
        {guides.y !== undefined && (
          <line
            y1={guides.y * height}
            x1={0}
            y2={guides.y * height}
            x2={width}
            stroke="var(--color-accent)"
            strokeWidth={width / displayWidth}
            strokeDasharray="4 4"
            pointerEvents="none"
          />
        )}
        {editing && editingPlan && (
          <foreignObject x={0} y={0} width={width} height={height}>
            <InlineLetteringText
              key={editing.id}
              ref={inlineRef}
              overlay={editing}
              plan={editingPlan}
              width={width}
              height={height}
              onChange={onTextChange}
              onSelection={onTextSelection}
              onFinish={onFinish}
              onUndo={onUndo}
              onRedo={onRedo}
            />
          </foreignObject>
        )}
      </svg>
    </div>
  );
}
