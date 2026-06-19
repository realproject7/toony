"use client";

// Focused cut lettering editor (issue #8) — the interactive counterpart to the
// read-only cut preview (#7).
//
// One large cut canvas shows the artwork with its bubbles overlaid, laid out by
// `@toony/render`'s `layoutCut` at the art's NATURAL pixel dimensions inside an
// SVG whose viewBox matches them — the SAME geometry the preview and export
// consume, so what is edited is exactly what renders. No bubble math is
// re-derived here: positions, the balloon path, the tail triangle, the wrapped
// text, and the overflow flag all come from the render core.
//
// Direct manipulation: drag a bubble to move it, drag a corner handle to resize
// it (clamped to the 0..1 image bounds), drag the tail handle to aim the tail.
// The inspector edits the selected bubble's speaker, kind, text, and style. Add,
// duplicate, and delete operate on the selection. Save POSTs the overlay set to
// `/api/lettering`, which validates and writes `lettering.json`; cancel returns
// to the preview without writing.

import type { Finding } from "@toony/lint";
import {
  bubbleKindStyle,
  cutPlacementFrame,
  IMPACT_BURST_FILL,
  IMPACT_BURST_STROKE,
  IMPACT_RAY_COLOR,
  kindSupportsTail,
  layoutCut,
} from "@toony/render";
import type { Character, Cut } from "@toony/schema";
import { LETTERING_STYLE_DEFAULTS, type LetteringOverlay } from "@toony/schema";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { clamp } from "@/lib/clamp";
import type { CutArt } from "@/lib/project";
import { svgLetterSpacing, svgTextAnchor } from "@/lib/text-anchor";

// The pro-lettering inspector (typography/color/styling/arrangement) and its
// lightweight color picker are editor-only. Lazy-load them as a separate chunk
// via next/dynamic so the library/reader bundles never pull in this control
// surface — only the focused cut editor downloads it, on demand.
const BubbleInspector = dynamic(() => import("./bubble-inspector").then((m) => m.BubbleInspector), {
  ssr: false,
  loading: () => (
    <div className="inspector-form" data-testid="bubble-inspector-loading">
      <p className="empty">Loading inspector…</p>
    </div>
  ),
});

// The cut craft panel (shot/palette/layer/styleTag, character registry +
// assignment, and the craft-lint findings list) is editor-only too, so it is
// lazy-loaded as its own chunk — the library/reader never pull in these controls.
const CutCraftPanel = dynamic(() => import("./cut-craft-panel").then((m) => m.CutCraftPanel), {
  ssr: false,
  loading: () => (
    <div className="inspector-form" data-testid="cut-craft-panel-loading">
      <p className="empty">Loading craft controls…</p>
    </div>
  ),
});

/** The cut's craft metadata (#98) the editor surfaces, in one prop object. */
export interface CutCraftFields {
  shotType: Cut["shotType"];
  palette: Cut["palette"];
  layer: Cut["layer"];
  styleTag: Cut["styleTag"];
  characters: string[];
}

export interface CutEditorProps {
  workId: string;
  episodeId: string;
  episodeTitle: string;
  webtoonTitle: string;
  cutId: string;
  art: CutArt;
  initialBubbles: LetteringOverlay[];
  initialImagePrompt: string;
  initialNegativePrompt: string;
  /** The cut's craft metadata + character assignment (#98/#92). */
  initialCraft: CutCraftFields;
  /** The project character registry (#92), for the registry + assignment UI. */
  initialCharacters: Character[];
  /** Initial craft/character/overflow lint findings for this episode (#94). */
  initialFindings: Finding[];
}

/**
 * Default style fields for a freshly added overlay. `fill` is seeded with the
 * kind's default fill (the schema requires a non-empty fill string), so a new
 * bubble both validates and renders with its kind's default appearance.
 */
function newOverlay(cutId: string, index: number): LetteringOverlay {
  return {
    id: `ov-${cutId}-${Date.now().toString(36)}-${index}`,
    cutId,
    speaker: "",
    kind: "speech",
    text: "New bubble",
    font: "Nanum Gothic",
    fill: bubbleKindStyle("speech").fill,
    opacity: 1,
    border: null,
    tail: null,
    geometry: { x: 0.32, y: 0.32, width: 0.36, height: 0.22 },
    overflow: false,
    reviewStatus: "human-edited",
  };
}

type DragMode =
  | { kind: "move"; id: string; grabDX: number; grabDY: number }
  | { kind: "resize"; id: string; fx: number; fy: number }
  | { kind: "tail"; id: string };

export function CutEditor({
  workId,
  episodeId,
  episodeTitle,
  webtoonTitle,
  cutId,
  art,
  initialBubbles,
  initialImagePrompt,
  initialNegativePrompt,
  initialCraft,
  initialCharacters,
  initialFindings,
}: CutEditorProps) {
  const [bubbles, setBubbles] = useState<LetteringOverlay[]>(initialBubbles);
  const [selectedId, setSelectedId] = useState<string | null>(initialBubbles[0]?.id ?? null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // Cut-level prompt fields (issue #38) are persisted separately from bubbles
  // via /api/cut, so they carry their own state, dirty flag, and save status.
  const [imagePrompt, setImagePrompt] = useState(initialImagePrompt);
  const [negativePrompt, setNegativePrompt] = useState(initialNegativePrompt);
  const [promptDirty, setPromptDirty] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptMessage, setPromptMessage] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragMode | null>(null);

  const hasArt = Boolean(art.src);
  const { width, height } = art;
  const aspectRatio = `${width} / ${height}`;

  // Lay out every bubble through the render core at natural pixel dimensions.
  const plans = useMemo(() => layoutCut(bubbles, width, height), [bubbles, width, height]);
  const overflowCount = plans.filter((plan) => plan.overflow).length;

  // Gutter placement (#98/#111): reserve the strip(s) so the focused editor's
  // artwork occupies only the `art` rect — the SAME cut-frame the preview and
  // export reserve — and gutter-aware overlay geometry sits over the inset art,
  // not full-bleed. With no gutter bubbles the art fills the stage (back-compat).
  const frame = useMemo(() => cutPlacementFrame(bubbles, width, height), [bubbles, width, height]);
  const reserved = frame.bands.length > 0;
  const artStyle = reserved
    ? {
        position: "absolute" as const,
        left: `${(frame.art.x / width) * 100}%`,
        top: 0,
        width: `${(frame.art.width / width) * 100}%`,
        height: "100%",
      }
    : undefined;
  const selected = bubbles.find((b) => b.id === selectedId) ?? null;
  const selectedPlan = plans.find((plan) => plan.id === selectedId) ?? null;

  const update = useCallback((id: string, patch: Partial<LetteringOverlay>) => {
    setBubbles((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    setDirty(true);
    setMessage(null);
  }, []);

  // Convert a pointer event to normalized 0..1 image coordinates.
  const pointerToNorm = useCallback((event: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    };
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const pt = pointerToNorm(event);
      if (!pt) return;
      setBubbles((prev) =>
        prev.map((b) => {
          if (b.id !== drag.id) return b;
          if (drag.kind === "move") {
            const w = b.geometry.width;
            const h = b.geometry.height;
            const x = clamp(pt.x - drag.grabDX, 0, 1 - w);
            const y = clamp(pt.y - drag.grabDY, 0, 1 - h);
            return { ...b, geometry: { ...b.geometry, x, y } };
          }
          if (drag.kind === "resize") {
            // Resize the box as the rect between the FIXED opposite corner
            // (`fx,fy`, captured at drag start) and the pointer — so any of the
            // four corner handles works. Keep a positive minimum and stay inside
            // the image bounds.
            const minW = 0.04;
            const minH = 0.03;
            const x = clamp(Math.min(pt.x, drag.fx), 0, 1 - minW);
            const y = clamp(Math.min(pt.y, drag.fy), 0, 1 - minH);
            const w = clamp(Math.abs(pt.x - drag.fx), minW, 1 - x);
            const h = clamp(Math.abs(pt.y - drag.fy), minH, 1 - y);
            return { ...b, geometry: { x, y, width: w, height: h } };
          }
          // tail: aim the tail tip at the pointer (image-space normalized point).
          return { ...b, tail: { x: pt.x, y: pt.y } };
        }),
      );
      setDirty(true);
      setMessage(null);
    },
    [pointerToNorm],
  );

  // Capture the pointer on the SVG itself (the element that owns the move/up
  // handlers), not on the individual handle. Handles are re-created on every
  // state change, so capturing them would invalidate the capture mid-drag; the
  // SVG is stable for the editor's lifetime, so capture survives and release
  // always targets the same element.
  const capture = useCallback((pointerId: number) => {
    svgRef.current?.setPointerCapture?.(pointerId);
  }, []);

  const endDrag = useCallback((event: React.PointerEvent) => {
    if (dragRef.current) {
      svgRef.current?.releasePointerCapture?.(event.pointerId);
      dragRef.current = null;
    }
  }, []);

  const startMove = useCallback(
    (event: React.PointerEvent, b: LetteringOverlay) => {
      event.stopPropagation();
      setSelectedId(b.id);
      const pt = pointerToNorm(event);
      if (!pt) return;
      dragRef.current = {
        kind: "move",
        id: b.id,
        grabDX: pt.x - b.geometry.x,
        grabDY: pt.y - b.geometry.y,
      };
      capture(event.pointerId);
    },
    [pointerToNorm, capture],
  );

  // Resize from any corner: the FIXED point is the opposite corner of the one
  // grabbed, so the box grows/shrinks toward the pointer from a stable anchor.
  const startResize = useCallback(
    (event: React.PointerEvent, b: LetteringOverlay, corner: "nw" | "ne" | "sw" | "se") => {
      event.stopPropagation();
      setSelectedId(b.id);
      const { x, y, width: w, height: h } = b.geometry;
      const fx = corner === "nw" || corner === "sw" ? x + w : x;
      const fy = corner === "nw" || corner === "ne" ? y + h : y;
      dragRef.current = { kind: "resize", id: b.id, fx, fy };
      capture(event.pointerId);
    },
    [capture],
  );

  const startTail = useCallback(
    (event: React.PointerEvent, b: LetteringOverlay) => {
      event.stopPropagation();
      setSelectedId(b.id);
      dragRef.current = { kind: "tail", id: b.id };
      capture(event.pointerId);
    },
    [capture],
  );

  const addBubble = useCallback(() => {
    setBubbles((prev) => {
      const created = newOverlay(cutId, prev.length);
      setSelectedId(created.id);
      return [...prev, created];
    });
    setDirty(true);
    setMessage(null);
  }, [cutId]);

  const duplicateSelected = useCallback(() => {
    if (!selected) return;
    setBubbles((prev) => {
      const copy: LetteringOverlay = {
        ...selected,
        id: `ov-${cutId}-${Date.now().toString(36)}-${prev.length}`,
        geometry: {
          ...selected.geometry,
          x: clamp(selected.geometry.x + 0.04, 0, 1 - selected.geometry.width),
          y: clamp(selected.geometry.y + 0.04, 0, 1 - selected.geometry.height),
        },
      };
      setSelectedId(copy.id);
      return [...prev, copy];
    });
    setDirty(true);
    setMessage(null);
  }, [selected, cutId]);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    setBubbles((prev) => {
      const next = prev.filter((b) => b.id !== selectedId);
      setSelectedId(next[0]?.id ?? null);
      return next;
    });
    setDirty(true);
    setMessage(null);
  }, [selectedId]);

  // --- Arrangement: z-order + nudge ---------------------------------------
  //
  // The render core sorts overlays by `zIndex` (ascending, ties by input order),
  // so changing a bubble's `zIndex` restacks it in the live preview, the reader,
  // and the export. These helpers compute the next integer z that moves the
  // selected bubble one step, or all the way, relative to its peers.

  const updateZ = useCallback(
    (next: number) => {
      if (!selectedId) return;
      update(selectedId, { zIndex: Math.max(0, Math.round(next)) });
    },
    [selectedId, update],
  );

  const zOf = useCallback((b: LetteringOverlay) => b.zIndex ?? LETTERING_STYLE_DEFAULTS.zIndex, []);

  const bringForward = useCallback(() => {
    if (!selected) return;
    const current = zOf(selected);
    // Step above the lowest peer that currently sits at or above this bubble.
    const above = bubbles
      .filter((b) => b.id !== selected.id && zOf(b) >= current)
      .map((b) => zOf(b))
      .sort((a, b) => a - b)[0];
    updateZ(above === undefined ? current : above + 1);
  }, [selected, bubbles, zOf, updateZ]);

  const sendBackward = useCallback(() => {
    if (!selected) return;
    const current = zOf(selected);
    const below = bubbles
      .filter((b) => b.id !== selected.id && zOf(b) <= current)
      .map((b) => zOf(b))
      .sort((a, b) => b - a)[0];
    updateZ(below === undefined ? current : Math.max(0, below - 1));
  }, [selected, bubbles, zOf, updateZ]);

  const bringToFront = useCallback(() => {
    if (!selected) return;
    const maxZ = bubbles.reduce((m, b) => Math.max(m, zOf(b)), 0);
    updateZ(maxZ + 1);
  }, [selected, bubbles, zOf, updateZ]);

  const sendToBack = useCallback(() => {
    if (!selected) return;
    // Push every other bubble up by one and place this one at 0, so it sits below
    // all peers while keeping their relative order.
    const minZ = bubbles.reduce((m, b) => Math.min(m, zOf(b)), Number.POSITIVE_INFINITY);
    if (minZ > 0) {
      updateZ(0);
      return;
    }
    setBubbles((prev) =>
      prev.map((b) =>
        b.id === selected.id
          ? { ...b, zIndex: 0 }
          : { ...b, zIndex: (b.zIndex ?? LETTERING_STYLE_DEFAULTS.zIndex) + 1 },
      ),
    );
    setDirty(true);
    setMessage(null);
  }, [selected, bubbles, zOf, updateZ]);

  const nudgeSelected = useCallback(
    (dx: number, dy: number) => {
      if (!selected) return;
      const g = selected.geometry;
      update(selected.id, {
        geometry: {
          ...g,
          x: clamp(g.x + dx, 0, 1 - g.width),
          y: clamp(g.y + dy, 0, 1 - g.height),
        },
      });
    },
    [selected, update],
  );

  // The cut's own colors (text / fill / border) form a small "project palette"
  // the color picker surfaces so a letterer can reuse a consistent set.
  const projectPalette = useMemo(() => {
    const set = new Set<string>();
    for (const b of bubbles) {
      if (b.fill) set.add(b.fill);
      if (b.textColor) set.add(b.textColor);
      if (b.border?.color) set.add(b.border.color);
    }
    return [...set];
  }, [bubbles]);

  const save = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    // Persist the render core's overflow flag so the on-disk model matches what
    // the editor shows (the schema overlay carries its own `overflow` field).
    const overflowById = new Map(plans.map((plan) => [plan.id, plan.overflow]));
    const payload = bubbles.map((b) => ({ ...b, overflow: overflowById.get(b.id) ?? b.overflow }));
    try {
      const response = await fetch("/api/lettering", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workId, episodeId, overlays: payload }),
      });
      const data = (await response.json()) as { ok: boolean; error?: string };
      if (!response.ok || !data.ok) {
        setMessage({ kind: "error", text: data.error ?? "Save failed." });
      } else {
        setBubbles(payload);
        setDirty(false);
        setMessage({ kind: "ok", text: "Saved to lettering.json." });
      }
    } catch (cause) {
      setMessage({ kind: "error", text: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setSaving(false);
    }
  }, [bubbles, plans, workId, episodeId]);

  const savePrompts = useCallback(async () => {
    setPromptSaving(true);
    setPromptMessage(null);
    try {
      const response = await fetch("/api/cut", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workId, episodeId, cutId, imagePrompt, negativePrompt }),
      });
      const data = (await response.json()) as { ok: boolean; error?: string };
      if (!response.ok || !data.ok) {
        setPromptMessage({ kind: "error", text: data.error ?? "Save failed." });
      } else {
        setPromptDirty(false);
        setPromptMessage({ kind: "ok", text: "Saved to cuts.yaml." });
      }
    } catch (cause) {
      setPromptMessage({
        kind: "error",
        text: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setPromptSaving(false);
    }
  }, [workId, episodeId, cutId, imagePrompt, negativePrompt]);

  return (
    <div className="editor" data-testid={`cut-editor-${cutId}`}>
      <header className="page-head">
        <div>
          <p className="page-eyebrow">{webtoonTitle}</p>
          <h1 className="page-title">Edit cut lettering</h1>
          <div className="page-meta">
            <span>
              {episodeTitle} · cut <code>{cutId}</code>
            </span>
            <span>
              <b>{bubbles.length}</b> bubble{bubbles.length === 1 ? "" : "s"}
            </span>
            {overflowCount > 0 && (
              <span className="chip chip-warn" data-testid="editor-overflow-count">
                {overflowCount} overflowing
              </span>
            )}
          </div>
        </div>
        <div className="editor-actions">
          <Link
            href={`/w/${encodeURIComponent(workId)}/episodes/${encodeURIComponent(episodeId)}`}
            className="btn btn-ghost"
          >
            Cancel
          </Link>
          <button
            type="button"
            className="btn btn-primary"
            onClick={save}
            disabled={saving || !dirty}
            data-testid="editor-save"
          >
            {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </button>
        </div>
      </header>

      {message && (
        <div
          className={
            message.kind === "ok"
              ? "editor-toast editor-toast-ok"
              : "editor-toast editor-toast-error"
          }
          role="status"
          data-testid="editor-message"
        >
          {message.text}
        </div>
      )}

      <div className="editor-layout">
        <div className="editor-stage-wrap">
          <div className="editor-toolbar">
            <button type="button" className="btn" onClick={addBubble} data-testid="editor-add">
              + Add bubble
            </button>
            <button
              type="button"
              className="btn"
              onClick={duplicateSelected}
              disabled={!selected}
              data-testid="editor-duplicate"
            >
              Duplicate
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={deleteSelected}
              disabled={!selected}
              data-testid="editor-delete"
            >
              Delete
            </button>
          </div>

          {hasArt ? (
            <div
              className="editor-stage"
              style={reserved ? { aspectRatio, background: "#ffffff" } : { aspectRatio }}
              data-reserved={reserved ? "true" : undefined}
              data-testid={`editor-stage-${cutId}`}
            >
              {/* biome-ignore lint/performance/noImgElement: local-first studio serves project files directly, not via the Next image optimizer. */}
              <img
                className="cut-art"
                style={artStyle}
                src={art.src ?? undefined}
                alt={`Artwork for ${cutId}`}
              />
              <svg
                ref={svgRef}
                className="editor-overlays"
                viewBox={`0 0 ${width} ${height}`}
                preserveAspectRatio="none"
                role="img"
                aria-label={`Bubble editing surface for cut ${cutId}`}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onPointerDown={() => setSelectedId(null)}
              >
                <title>{`Bubble editing surface for cut ${cutId}`}</title>
                {plans.map((plan) => {
                  const b = bubbles.find((x) => x.id === plan.id);
                  if (!b) return null;
                  const isSelected = plan.id === selectedId;
                  const bx = b.geometry.x * width;
                  const by = b.geometry.y * height;
                  const bw = b.geometry.width * width;
                  const bh = b.geometry.height * height;
                  const fontSize = plan.text.fontSize;
                  const handle = Math.max(width, height) * 0.012;
                  const impact = plan.impact;
                  return (
                    <g key={plan.id} data-bubble-id={plan.id}>
                      {plan.tail && (
                        <line
                          x1={plan.box.x + plan.box.width / 2}
                          y1={plan.box.y + plan.box.height / 2}
                          x2={plan.tail.tip.x}
                          y2={plan.tail.tip.y}
                          stroke="var(--color-accent)"
                          strokeWidth={Math.max(1, height * 0.002)}
                          strokeDasharray="4 4"
                          opacity={isSelected ? 0.8 : 0}
                        />
                      )}
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
                      {/* impact_band SFX (#99/#110): speed-lines + burst behind the
                          text, from the SAME pure-segment plan the preview and
                          export trace → the editor surface matches what renders. */}
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
                          // biome-ignore lint/suspicious/noArrayIndexKey: wrapped lines are a positional layout output; the index is the stable identity within one layout pass.
                          key={`${plan.id}-line-${i}`}
                          x={line.anchorX}
                          y={line.y + fontSize}
                          fontFamily={plan.fontStack}
                          fontSize={fontSize}
                          fontWeight={plan.fontWeight}
                          textAnchor={svgTextAnchor(plan.textAlign)}
                          letterSpacing={svgLetterSpacing(plan.letterSpacing, fontSize)}
                          fill={plan.textColor}
                          // SFX outline width comes from the render plan (single
                          // source: `textOutlineWidth`, >0 ⟺ SFX) so the editor,
                          // preview, and export stroke it identically (#112).
                          stroke={plan.textOutlineWidth > 0 ? plan.stroke : undefined}
                          strokeWidth={
                            plan.textOutlineWidth > 0 ? plan.textOutlineWidth : undefined
                          }
                          paintOrder="stroke"
                        >
                          {line.text}
                        </text>
                      ))}

                      {/* Selection chrome + interaction handles. */}
                      <rect
                        x={bx}
                        y={by}
                        width={bw}
                        height={bh}
                        fill="transparent"
                        stroke={isSelected ? "var(--color-accent)" : "transparent"}
                        strokeWidth={Math.max(1, height * 0.0025)}
                        strokeDasharray="6 4"
                        style={{ cursor: "move" }}
                        data-handle="move"
                        data-bubble-id={plan.id}
                        onPointerDown={(event) => startMove(event, b)}
                      />
                      {plan.overflow && (
                        <rect
                          x={bx}
                          y={by}
                          width={bw}
                          height={bh}
                          fill="none"
                          stroke="var(--color-warning)"
                          strokeWidth={Math.max(1, height * 0.003)}
                          pointerEvents="none"
                          data-overflow="true"
                        />
                      )}
                      {isSelected && (
                        <>
                          {(
                            [
                              { corner: "nw", cx: bx, cy: by, cursor: "nwse-resize" },
                              { corner: "ne", cx: bx + bw, cy: by, cursor: "nesw-resize" },
                              { corner: "sw", cx: bx, cy: by + bh, cursor: "nesw-resize" },
                              { corner: "se", cx: bx + bw, cy: by + bh, cursor: "nwse-resize" },
                            ] as const
                          ).map((c) => (
                            <rect
                              key={c.corner}
                              x={c.cx - handle}
                              y={c.cy - handle}
                              width={handle * 2}
                              height={handle * 2}
                              fill="var(--color-accent)"
                              stroke="#ffffff"
                              strokeWidth={handle * 0.25}
                              style={{ cursor: c.cursor }}
                              data-handle={`resize-${c.corner}`}
                              onPointerDown={(event) => startResize(event, b, c.corner)}
                            />
                          ))}
                          {kindSupportsTail(b.kind) && b.tail && (
                            <circle
                              cx={b.tail.x * width}
                              cy={b.tail.y * height}
                              r={handle}
                              fill="#ffffff"
                              stroke="var(--color-accent)"
                              strokeWidth={handle * 0.4}
                              style={{ cursor: "grab" }}
                              data-handle="tail"
                              onPointerDown={(event) => startTail(event, b)}
                            />
                          )}
                        </>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>
          ) : (
            <div className="editor-stage editor-stage-empty" data-testid={`editor-stage-${cutId}`}>
              <span className="chip">No image yet</span>
              <span className="cut-canvas-hint">
                This cut has no linked artwork. You can still place and edit bubbles on a default
                page frame; positions are normalized 0..1 and apply once art is linked.
              </span>
              {/* The empty-state stage still hosts the same editing surface so a cut
                  without art is not a dead end. */}
              <svg
                ref={svgRef}
                className="editor-overlays editor-overlays-empty"
                viewBox={`0 0 ${width} ${height}`}
                preserveAspectRatio="none"
                role="img"
                aria-label={`Bubble editing surface for cut ${cutId}`}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onPointerDown={() => setSelectedId(null)}
              >
                <title>{`Bubble editing surface for cut ${cutId}`}</title>
                {plans.map((plan) => {
                  const b = bubbles.find((x) => x.id === plan.id);
                  if (!b) return null;
                  const isSelected = plan.id === selectedId;
                  const bx = b.geometry.x * width;
                  const by = b.geometry.y * height;
                  const bw = b.geometry.width * width;
                  const bh = b.geometry.height * height;
                  return (
                    <g key={plan.id} data-bubble-id={plan.id}>
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
                          // biome-ignore lint/suspicious/noArrayIndexKey: positional layout output.
                          key={`${plan.id}-eline-${i}`}
                          x={line.anchorX}
                          y={line.y + plan.text.fontSize}
                          fontFamily={plan.fontStack}
                          fontSize={plan.text.fontSize}
                          fontWeight={plan.fontWeight}
                          textAnchor={svgTextAnchor(plan.textAlign)}
                          letterSpacing={svgLetterSpacing(plan.letterSpacing, plan.text.fontSize)}
                          fill={plan.textColor}
                        >
                          {line.text}
                        </text>
                      ))}
                      <rect
                        x={bx}
                        y={by}
                        width={bw}
                        height={bh}
                        fill="transparent"
                        stroke={isSelected ? "var(--color-accent)" : "var(--color-line-strong)"}
                        strokeWidth={Math.max(1, height * 0.0025)}
                        strokeDasharray="6 4"
                        style={{ cursor: "move" }}
                        data-handle="move"
                        onPointerDown={(event) => startMove(event, b)}
                      />
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
        </div>

        <aside className="editor-inspector" data-testid="editor-inspector">
          <CutPromptPanel
            cutId={cutId}
            imagePrompt={imagePrompt}
            negativePrompt={negativePrompt}
            dirty={promptDirty}
            saving={promptSaving}
            message={promptMessage}
            onImagePromptChange={(value) => {
              setImagePrompt(value);
              setPromptDirty(true);
              setPromptMessage(null);
            }}
            onNegativePromptChange={(value) => {
              setNegativePrompt(value);
              setPromptDirty(true);
              setPromptMessage(null);
            }}
            onSave={savePrompts}
          />
          <CutCraftPanel
            workId={workId}
            episodeId={episodeId}
            cutId={cutId}
            initialCraft={initialCraft}
            initialCharacters={initialCharacters}
            initialFindings={initialFindings}
          />
          {selected ? (
            <BubbleInspector
              overlay={selected}
              overflow={selectedPlan?.overflow ?? false}
              onChange={(patch) => update(selected.id, patch)}
              onBringForward={bringForward}
              onSendBackward={sendBackward}
              onBringToFront={bringToFront}
              onSendToBack={sendToBack}
              onNudge={nudgeSelected}
              projectPalette={projectPalette}
            />
          ) : (
            <div className="inspector-empty">
              <h2 className="card-title">Inspector</h2>
              <p className="empty">
                Select a bubble on the canvas, or add one, to edit its speaker, text, and style.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

/**
 * Cut-level prompt panel (issue #38). Edits the cut's `imagePrompt` and
 * `negativePrompt` — author-authored generation prompts that live on the cut
 * record, distinct from per-bubble lettering. Saves through `/api/cut`, which
 * validates and writes only this episode's `cuts.yaml`.
 */
function CutPromptPanel({
  cutId,
  imagePrompt,
  negativePrompt,
  dirty,
  saving,
  message,
  onImagePromptChange,
  onNegativePromptChange,
  onSave,
}: {
  cutId: string;
  imagePrompt: string;
  negativePrompt: string;
  dirty: boolean;
  saving: boolean;
  message: { kind: "ok" | "error"; text: string } | null;
  onImagePromptChange: (value: string) => void;
  onNegativePromptChange: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <div className="inspector-form" data-testid="cut-prompt-panel">
      <h2 className="card-title">Cut prompts</h2>
      <p className="field-hint">
        Generation prompts for cut <code>{cutId}</code>. These describe the artwork itself, separate
        from speech bubbles.
      </p>

      {message && (
        <div
          className={
            message.kind === "ok"
              ? "editor-toast editor-toast-ok"
              : "editor-toast editor-toast-error"
          }
          role="status"
          data-testid="cut-prompt-message"
        >
          {message.text}
        </div>
      )}

      <label className="field">
        <span>Image prompt</span>
        <textarea
          rows={4}
          value={imagePrompt}
          placeholder="Describe the artwork to generate for this cut."
          onChange={(e) => onImagePromptChange(e.target.value)}
          data-testid="field-image-prompt"
        />
      </label>

      <label className="field">
        <span>Negative prompt</span>
        <textarea
          rows={3}
          value={negativePrompt}
          placeholder="Describe what to avoid (e.g. blurry, watermark)."
          onChange={(e) => onNegativePromptChange(e.target.value)}
          data-testid="field-negative-prompt"
        />
      </label>

      <button
        type="button"
        className="btn btn-primary"
        onClick={onSave}
        disabled={saving || !dirty}
        data-testid="cut-prompt-save"
      >
        {saving ? "Saving…" : dirty ? "Save cut prompts" : "Saved"}
      </button>
    </div>
  );
}
