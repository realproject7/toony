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

import { layoutCut } from "@toony/render";
import {
  applyLetteringTheme,
  type Character,
  defaultLetteringTextLayout,
  LETTERING_STYLE_DEFAULTS,
  type LetteringOverlay,
  type LetteringTheme,
  type ReviewStatus,
} from "@toony/schema";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBrowserMeasure } from "@/lib/browser-measure";
import { clamp } from "@/lib/clamp";
import type { CutFields } from "@/lib/cut-fields";
import { resolveCutStage } from "@/lib/cut-stage";
import { decodeEditorDraft, encodeEditorDraft } from "@/lib/editor-draft";
import { persistWithGuard } from "@/lib/editor-save";
import { letteringClipboard, parseLetteringClipboard } from "@/lib/lettering-clipboard";
import { BALLOON_LIBRARY, libraryOverlay, newOverlay, tailDragPatch } from "@/lib/new-overlay";
import type { CutArt } from "@/lib/project";
import { useAgentWorkspace } from "./agent-workspace";
import { AlignmentSymbol } from "./alignment-symbol";
import { ArtRevisions } from "./art-revisions";
import { CutFieldsEditor } from "./cut-fields-editor";
import { CutReviewControl } from "./cut-review-control";
import type { InlineTextHandle, TextSelection } from "./inline-lettering-text";
import { LetteringCanvas } from "./lettering-canvas";
import { LETTERING_PRESET_MIME, LetteringPresets } from "./lettering-presets";
import { StudioIcon } from "./studio-icon";
import { keyboardOwnedByField, useEditHistory } from "./use-edit-history";

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

export interface CutEditorProps {
  integrated?: boolean;
  registerNavigation?: (guard: ((next: () => void) => void) | null) => void;
  onSaved?: (bubbles: LetteringOverlay[], revision: string) => void;
  workId: string;
  episodeId: string;
  episodeTitle: string;
  webtoonTitle: string;
  cutId: string;
  art: CutArt;
  initialBubbles: LetteringOverlay[];
  initialLetteringRevision: string;
  cutNavigation: { id: string; href: string }[];
  initialReviewStatus?: ReviewStatus;
  artworkRevision: string;
  /**
   * The project's declared dialogue language (`languages.dialogueLanguage`). It
   * picks the default dialogue face (#213), so the editor lays out with the same
   * face the preview and the export raster resolve.
   */
  dialogueLanguage: string;
  /**
   * The project's resolved gutter strip width (#215), a fraction of the cut
   * width. It reserves the strip the artwork is inset from AND goes into
   * `layoutCut`, so the editor edits bubbles in the band the export letters in.
   */
  gutterBandWidth: number;
  referenceWidth: number;
  /** The cut's own editable fields (#332), shown beside the bubble inspector. */
  cutFields: CutFields;
  /** The project character registry, for the cut's character picker. */
  characters: readonly Character[];
  /** What produced the art on disk, shown read-only. */
  renderRecord: { imageSeed?: number; imageWorkflow?: string };
  /** The project's lettering theme (#334), or null when none applies. */
  theme: LetteringTheme | null;
  /** The selected theme id, shown when the pack providing it is not installed. */
  themeId: string | null;
}

type DragMode =
  | {
      kind: "move";
      id: string;
      startX: number;
      startY: number;
      clientX: number;
      clientY: number;
      originals: Record<string, LetteringOverlay["geometry"]>;
      moved: boolean;
    }
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
  initialLetteringRevision,
  cutNavigation,
  initialReviewStatus,
  artworkRevision,
  dialogueLanguage,
  gutterBandWidth,
  referenceWidth,
  cutFields,
  characters,
  renderRecord,
  theme,
  themeId,
  integrated,
  registerNavigation,
  onSaved,
}: CutEditorProps) {
  const router = useRouter();
  const { ask } = useAgentWorkspace();
  const [bubbles, setBubbles] = useState<LetteringOverlay[]>(initialBubbles);
  // Undo and redo over the bubble set (#333). Every mutation records the state
  // it is about to replace; a drag records once at its start.
  const history = useEditHistory<LetteringOverlay[]>(bubbles);
  const [selectedId, setSelectedId] = useState<string | null>(initialBubbles[0]?.id ?? null);
  const editorRoot = useRef<HTMLElement>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const [pendingNavigation, setPendingNavigation] = useState<
    { href: string } | { reload: true } | { action: () => void } | null
  >(null);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [inspectorPreference, setInspectorPreference] = useState<boolean | null>(null);
  const [wideWorkspace, setWideWorkspace] = useState(false);
  const inspectorOpen = inspectorPreference ?? wideWorkspace;
  useEffect(() => {
    const root = editorRoot.current;
    if (!root) return;
    const observer = new ResizeObserver(() => setWideWorkspace(root.clientWidth >= 940));
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  const [additionalIds, setAdditionalIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [legacyRequest, setLegacyRequest] = useState<string | null>(null);
  const [textSelection, setTextSelection] = useState<TextSelection>({ start: 0, end: 0 });
  const [armed, setArmed] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.75),
    [fitMode, setFitMode] = useState<false | "cut" | "width">(integrated ? "cut" : "width");
  const [panMode, setPanMode] = useState(false),
    [snap, setSnap] = useState(true);
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const viewportRef = useRef<HTMLDivElement>(null),
    inlineRef = useRef<InlineTextHandle>(null);
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null),
    spaceRef = useRef(false);
  const revisionRef = useRef(initialLetteringRevision),
    allowUnloadRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    registerNavigation?.((next) => {
      if (dirty || saving) setPendingNavigation({ action: next });
      else next();
    });
    return () => registerNavigation?.(null);
  }, [registerNavigation, dirty, saving]);

  const draftKey = `toony-lettering:${workId}/${episodeId}/${cutId}`;
  const draftReady = useRef(false);
  const clearDraft = useCallback(() => {
    try {
      sessionStorage.removeItem(draftKey);
    } catch {
      /* Storage may be disabled. */
    }
  }, [draftKey]);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(draftKey);
      const restored = raw ? decodeEditorDraft(raw, cutId) : null;
      if (restored) {
        revisionRef.current = restored.revision;
        setBubbles(restored.bubbles);
        setSelectedId(restored.bubbles[0]?.id ?? null);
        setDirty(true);
        setMessage({
          kind: "ok",
          text: "Your unsaved lettering draft was restored. Save when ready.",
        });
      }
    } catch {
      /* The normal leave-page guard still protects the editor. */
    }
    draftReady.current = true;
  }, [draftKey, cutId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a settled save changes the draft base revision even when the bubbles are unchanged.
  useEffect(() => {
    if (!draftReady.current || !dirty) return;
    try {
      sessionStorage.setItem(draftKey, encodeEditorDraft(revisionRef.current, bubbles));
    } catch {
      setMessage({
        kind: "error",
        text: "Draft recovery is unavailable. Save before leaving this cut.",
      });
    }
  }, [bubbles, dirty, draftKey, saving]);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragMode | null>(null);
  // Monotonic edit counter: every edit bumps it, and `save` compares it before
  // and after the await so an edit made DURING an in-flight save keeps the
  // editor dirty instead of being reverted or false-cleaned (#150).
  const editGenRef = useRef(0);

  const { width, height } = art;

  // Lay out every bubble through the render core at natural pixel dimensions,
  // using a real browser text measurer (#149) so the editor's wrap/auto-fit
  // matches the export raster (falls back to the approximation until fonts load,
  // then re-layouts). This IS a client component, so no boundary is needed here.
  const measure = useBrowserMeasure();
  const plans = useMemo(
    () =>
      layoutCut(bubbles, width, height, {
        ...(measure ? { measure } : {}),
        dialogueLanguage,
        gutterBandWidth,
      }),
    [bubbles, width, height, measure, dialogueLanguage, gutterBandWidth],
  );
  const overflowCount = plans.filter((plan) => plan.overflow).length;

  // Gutter placement (#98/#111): reserve the strip(s) so the focused editor's
  // artwork occupies only the `art` rect — the SAME cut-frame the preview and
  // export reserve — and gutter-aware overlay geometry sits over the inset art,
  // not full-bleed. With no gutter bubbles the art fills the stage (back-compat).
  const { reserved, artStyle } = useMemo(
    () => resolveCutStage(bubbles, width, height, gutterBandWidth),
    [bubbles, width, height, gutterBandWidth],
  );
  const activeIds = useMemo(
    () => [
      ...new Set(
        [selectedId, ...additionalIds].filter(
          (id): id is string => id !== null && bubbles.some((b) => b.id === id),
        ),
      ),
    ],
    [selectedId, additionalIds, bubbles],
  );
  const hasEditableSelection = bubbles.some((b) => activeIds.includes(b.id) && !b.locked);
  const selected = bubbles.find((b) => b.id === selectedId) ?? null;
  const selectedPlan = plans.find((plan) => plan.id === selectedId) ?? null;

  // Mark the editor dirty and advance the edit generation. Every mutation goes
  // through here so an in-flight save can detect edits that land during it.
  const markDirty = useCallback(() => {
    editGenRef.current += 1;
    setDirty(true);
    setMessage(null);
  }, []);

  const update = useCallback(
    (id: string, patch: Partial<LetteringOverlay>) => {
      const existing = bubbles.find((b) => b.id === id);
      if (
        !existing ||
        (existing.locked && patch.locked === undefined) ||
        Object.entries(patch).every(
          ([key, value]) =>
            JSON.stringify(existing[key as keyof LetteringOverlay]) === JSON.stringify(value),
        )
      )
        return;
      history.record({
        coalesce: patch.kind === undefined,
        key: `${id}:${Object.keys(patch).sort().join(",")}`,
      });
      setBubbles((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
      markDirty();
    },
    [markDirty, history, bubbles],
  );

  const undo = useCallback(() => {
    const state = history.undo();
    if (state === null) return;
    setBubbles(state);
    setSelectedId((id) =>
      id !== null && state.some((b) => b.id === id) ? id : (state[0]?.id ?? null),
    );
    markDirty();
  }, [history, markDirty]);

  const redo = useCallback(() => {
    const state = history.redo();
    if (state === null) return;
    setBubbles(state);
    setSelectedId((id) =>
      id !== null && state.some((b) => b.id === id) ? id : (state[0]?.id ?? null),
    );
    markDirty();
  }, [history, markDirty]);

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
      const drag = dragRef.current,
        pt = pointerToNorm(event);
      if (!drag || !pt) return;
      if (drag.kind === "move") {
        if (
          !drag.moved &&
          Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) < 4
        )
          return;
        if (!drag.moved) {
          history.record();
          drag.moved = true;
        }
        const originals = Object.values(drag.originals);
        if (!originals.length) return;
        let dx = pt.x - drag.startX,
          dy = pt.y - drag.startY;
        const minX = Math.min(...originals.map((g) => g.x)),
          maxX = Math.max(...originals.map((g) => g.x + g.width));
        const minY = Math.min(...originals.map((g) => g.y)),
          maxY = Math.max(...originals.map((g) => g.y + g.height));
        const guide: { x?: number; y?: number } = {};
        if (snap) {
          const cx = (minX + maxX) / 2,
            cy = (minY + maxY) / 2;
          const peers = bubbles.filter((b) => !drag.originals[b.id]).map((b) => b.geometry);
          const gx = [0.5, ...peers.map((g) => g.x + g.width / 2)].find(
            (x) => Math.abs(x - cx - dx) < 6 / (referenceWidth * zoom),
          );
          const gy = [0.5, ...peers.map((g) => g.y + g.height / 2)].find(
            (y) => Math.abs(y - cy - dy) < 6 / ((referenceWidth * zoom * height) / width),
          );
          if (gx !== undefined) {
            dx = gx - cx;
            guide.x = gx;
          }
          if (gy !== undefined) {
            dy = gy - cy;
            guide.y = gy;
          }
        }
        dx = clamp(dx, -minX, 1 - maxX);
        dy = clamp(dy, -minY, 1 - maxY);
        setGuides(guide);
        setBubbles((prev) =>
          prev.map((b) => {
            const g = drag.originals[b.id];
            return g ? { ...b, geometry: { ...g, x: g.x + dx, y: g.y + dy } } : b;
          }),
        );
      } else
        setBubbles((prev) =>
          prev.map((b) => {
            if (b.id !== drag.id || b.locked) return b;
            if (drag.kind === "tail") {
              const art = plans.find((plan) => plan.id === b.id)?.art;
              return art ? { ...b, ...tailDragPatch(pt, art, width, height) } : b;
            }
            const minW = 0.04,
              minH = 0.03,
              x = clamp(Math.min(pt.x, drag.fx), 0, 1 - minW),
              y = clamp(Math.min(pt.y, drag.fy), 0, 1 - minH);
            return {
              ...b,
              geometry: {
                x,
                y,
                width: clamp(Math.abs(pt.x - drag.fx), minW, 1 - x),
                height: clamp(Math.abs(pt.y - drag.fy), minH, 1 - y),
              },
            };
          }),
        );
      markDirty();
    },
    [pointerToNorm, history, markDirty, bubbles, plans, snap, referenceWidth, zoom, width, height],
  );

  const startEditing = useCallback(
    (id: string) => {
      const b = bubbles.find((b) => b.id === id),
        plan = plans.find((p) => p.id === id);
      if (!b || b.locked || !plan) return;
      setAdditionalIds([]);
      setSelectedId(id);
      setArmed(null);
      if (plan.lines.some((line) => line.sourceStart === undefined)) {
        setLegacyRequest(id);
        return;
      }
      setEditingId(id);
      setTextSelection({ start: 0, end: b.text.length });
    },
    [bubbles, plans],
  );
  // Capture the pointer on the SVG itself (the element that owns the move/up
  // handlers), not on the individual handle. Handles are re-created on every
  // state change, so capturing them would invalidate the capture mid-drag; the
  // SVG is stable for the editor's lifetime, so capture survives and release
  // always targets the same element.
  const capture = useCallback((pointerId: number) => {
    svgRef.current?.setPointerCapture?.(pointerId);
  }, []);

  const endDrag = useCallback(
    (event: React.PointerEvent) => {
      const drag = dragRef.current;
      if (drag) {
        svgRef.current?.releasePointerCapture?.(event.pointerId);
        dragRef.current = null;
        setGuides({});
        if (drag.kind === "move" && !drag.moved && event.type !== "pointercancel")
          startEditing(drag.id);
      }
    },
    [startEditing],
  );

  const startMove = useCallback(
    (event: React.PointerEvent, b: LetteringOverlay) => {
      event.stopPropagation();
      event.preventDefault();
      svgRef.current?.focus({ preventScroll: true });
      setEditingId(null);
      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        const ids = activeIds.includes(b.id)
          ? activeIds.filter((id) => id !== b.id)
          : [...activeIds, b.id];
        setSelectedId(ids.at(-1) ?? null);
        setAdditionalIds(ids.slice(0, -1));
        return;
      }
      const ids = activeIds.includes(b.id) ? activeIds : [b.id];
      setSelectedId(b.id);
      setAdditionalIds(ids.filter((id) => id !== b.id));
      if (b.locked) return;
      const pt = pointerToNorm(event);
      if (!pt) return;
      dragRef.current = {
        kind: "move",
        id: b.id,
        startX: pt.x,
        startY: pt.y,
        clientX: event.clientX,
        clientY: event.clientY,
        moved: false,
        originals: Object.fromEntries(
          bubbles
            .filter((b) => ids.includes(b.id) && !b.locked)
            .map((b) => [b.id, { ...b.geometry }]),
        ),
      };
      capture(event.pointerId);
    },
    [activeIds, bubbles, pointerToNorm, capture],
  );
  // Resize from any corner: the FIXED point is the opposite corner of the one
  // grabbed, so the box grows/shrinks toward the pointer from a stable anchor.
  const startResize = useCallback(
    (event: React.PointerEvent, b: LetteringOverlay, corner: "nw" | "ne" | "sw" | "se") => {
      event.stopPropagation();
      if (b.locked) return;
      event.preventDefault();
      svgRef.current?.focus({ preventScroll: true });
      setEditingId(null);
      setAdditionalIds([]);
      setSelectedId(b.id);
      const { x, y, width: w, height: h } = b.geometry;
      const fx = corner === "nw" || corner === "sw" ? x + w : x;
      const fy = corner === "nw" || corner === "ne" ? y + h : y;
      history.record();
      dragRef.current = { kind: "resize", id: b.id, fx, fy };
      capture(event.pointerId);
    },
    [capture, history],
  );

  const startTail = useCallback(
    (event: React.PointerEvent, b: LetteringOverlay) => {
      event.stopPropagation();
      if (b.locked) return;
      event.preventDefault();
      svgRef.current?.focus({ preventScroll: true });
      setEditingId(null);
      setAdditionalIds([]);
      setSelectedId(b.id);
      history.record();
      dragRef.current = { kind: "tail", id: b.id };
      capture(event.pointerId);
    },
    [capture, history],
  );

  const addBubble = useCallback(() => {
    const created = newOverlay(cutId, bubbles.length, theme ?? undefined, referenceWidth);
    setAdditionalIds([]);
    history.record();
    setBubbles((prev) => [...prev, created]);
    setSelectedId(created.id);
    setEditingId(created.id);
    markDirty();
  }, [cutId, bubbles.length, theme, referenceWidth, history, markDirty]);

  // Apply the project's theme to the selected bubble on request (#336): every
  // field the theme states for its kind is written; the rest stays.
  const applyThemeToSelected = useCallback(() => {
    if (!selected || theme === null) return;
    const themed = applyLetteringTheme(selected, theme);
    const patch: Partial<LetteringOverlay> = {};
    for (const key of [
      "fontFamily",
      "fontWeight",
      "fill",
      "textColor",
      "border",
      "cornerRadius",
      "opacity",
      "sfxMode",
    ] as const) {
      if (themed[key] !== selected[key]) Object.assign(patch, { [key]: themed[key] });
    }
    if (Object.keys(patch).length === 0) return;
    history.record();
    setBubbles((prev) => prev.map((b) => (b.id === selected.id ? { ...b, ...patch } : b)));
    markDirty();
  }, [selected, theme, history, markDirty]);

  const duplicateSelected = useCallback(() => {
    const copies = bubbles
      .filter((b) => activeIds.includes(b.id) && !b.locked)
      .map((b, index) => ({
        ...structuredClone(b),
        id: `ov-${cutId}-${crypto.randomUUID()}-${index}`,
        geometry: {
          ...b.geometry,
          x: clamp(b.geometry.x + 0.03, 0, 1 - b.geometry.width),
          y: clamp(b.geometry.y + 0.03, 0, 1 - b.geometry.height),
        },
      }));
    if (!copies.length) return;
    setEditingId(null);
    history.record();
    setBubbles((prev) => [...prev, ...copies]);
    setSelectedId(copies.at(-1)?.id ?? null);
    setAdditionalIds(copies.slice(0, -1).map((b) => b.id));
    markDirty();
  }, [bubbles, activeIds, cutId, history, markDirty]);

  const deleteSelected = useCallback(() => {
    const ids = activeIds.filter((id) => !bubbles.find((b) => b.id === id)?.locked);
    if (!ids.length) return;
    setEditingId(null);
    history.record();
    setBubbles((prev) => prev.filter((b) => !ids.includes(b.id)));
    setSelectedId(null);
    setAdditionalIds([]);
    markDirty();
  }, [activeIds, bubbles, history, markDirty]);

  const addPreset = useCallback(
    (presetId: string, point: { x: number; y: number }) => {
      const created = libraryOverlay(cutId, bubbles.length, presetId, point, {
        width,
        height,
        referenceWidth,
        theme: theme ?? undefined,
      });
      history.record();
      setBubbles((prev) => [...prev, created]);
      setSelectedId(created.id);
      setAdditionalIds([]);
      setArmed(null);
      setEditingId(created.id);
      markDirty();
    },
    [cutId, bubbles.length, width, height, referenceWidth, theme, history, markDirty],
  );

  const copyBubbles = useCallback(
    (all = false) => {
      try {
        const text = letteringClipboard(
          all ? bubbles : bubbles.filter((b) => activeIds.includes(b.id)),
        );
        sessionStorage.setItem("toony-lettering-clipboard-v1", text);
        void navigator.clipboard?.writeText(text).catch(() => {});
        setMessage({
          kind: all ? "error" : "ok",
          text: all
            ? "Draft copied in this tab. Reload, then paste to recover it."
            : "Bubbles copied in this tab. Paste in this or another cut.",
        });
      } catch {
        setMessage({
          kind: "error",
          text: "Could not copy the lettering. Your edits are still here.",
        });
      }
    },
    [bubbles, activeIds],
  );
  const insertCopied = useCallback(
    (copied: LetteringOverlay[]) => {
      const next = copied.map((b) => ({
        ...b,
        id: `ov-${cutId}-${crypto.randomUUID()}`,
        cutId,
        locked: false,
        geometry: {
          ...b.geometry,
          x: clamp(b.geometry.x + 0.02, 0, 1 - b.geometry.width),
          y: clamp(b.geometry.y + 0.02, 0, 1 - b.geometry.height),
        },
      }));
      history.record();
      setBubbles((prev) => [...prev, ...next]);
      setSelectedId(next.at(-1)?.id ?? null);
      setAdditionalIds(next.slice(0, -1).map((b) => b.id));
      setEditingId(null);
      markDirty();
    },
    [cutId, history, markDirty],
  );
  const pasteBubbles = useCallback(() => {
    try {
      const text = sessionStorage.getItem("toony-lettering-clipboard-v1");
      if (!text)
        throw new Error(
          "Copy bubbles in this tab first, or use Cmd/Ctrl+V for the system clipboard.",
        );
      insertCopied(parseLetteringClipboard(text));
    } catch (cause) {
      setMessage({
        kind: "error",
        text: cause instanceof Error ? cause.message : "Could not paste lettering.",
      });
    }
  }, [insertCopied]);
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (
        event.defaultPrevented ||
        !(event.target instanceof Node) ||
        !editorRoot.current?.contains(event.target)
      )
        return;
      if (keyboardOwnedByField(event)) return;
      const text = event.clipboardData?.getData("text/plain");
      if (!text) return;
      try {
        const copied = parseLetteringClipboard(text);
        event.preventDefault();
        insertCopied(copied);
      } catch {
        /* Other clipboard formats keep their native behavior. */
      }
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, [insertCopied]);
  const toggleLock = useCallback(() => {
    if (!activeIds.length) return;
    const unlock = bubbles.some((b) => activeIds.includes(b.id) && b.locked);
    setEditingId(null);
    history.record();
    setBubbles((prev) =>
      prev.map((b) => (activeIds.includes(b.id) ? { ...b, locked: !unlock } : b)),
    );
    markDirty();
  }, [activeIds, bubbles, history, markDirty]);
  const alignObjects = useCallback(
    (mode: "left" | "center" | "right" | "top" | "middle" | "bottom") => {
      const selected = bubbles.filter((b) => activeIds.includes(b.id));
      if (!selected.length) return;
      const minX = selected.length === 1 ? 0 : Math.min(...selected.map((b) => b.geometry.x)),
        maxX =
          selected.length === 1
            ? 1
            : Math.max(...selected.map((b) => b.geometry.x + b.geometry.width));
      const minY = selected.length === 1 ? 0 : Math.min(...selected.map((b) => b.geometry.y)),
        maxY =
          selected.length === 1
            ? 1
            : Math.max(...selected.map((b) => b.geometry.y + b.geometry.height));
      setEditingId(null);
      history.record();
      setBubbles((prev) =>
        prev.map((b) => {
          if (!activeIds.includes(b.id) || b.locked) return b;
          const g = b.geometry;
          const x =
            mode === "left"
              ? minX
              : mode === "center"
                ? (minX + maxX - g.width) / 2
                : mode === "right"
                  ? maxX - g.width
                  : g.x;
          const y =
            mode === "top"
              ? minY
              : mode === "middle"
                ? (minY + maxY - g.height) / 2
                : mode === "bottom"
                  ? maxY - g.height
                  : g.y;
          return { ...b, geometry: { ...g, x, y } };
        }),
      );
      markDirty();
    },
    [activeIds, bubbles, history, markDirty],
  );

  useEffect(() => {
    const element = viewportRef.current;
    if (!element || !fitMode) return;
    const fit = () =>
      setZoom(
        Math.max(
          0.25,
          Math.min(
            2.5,
            (element.clientWidth - 32) / referenceWidth,
            fitMode === "cut"
              ? (element.clientHeight - 32) / ((referenceWidth * height) / width)
              : 2.5,
          ),
        ),
      );
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [fitMode, referenceWidth, width, height]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty && !allowUnloadRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const guard = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      )
        return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (
        url.origin !== window.location.origin ||
        (url.pathname === location.pathname && url.search === location.search)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      setPendingNavigation({ href: url.pathname + url.search + url.hash });
    };
    document.addEventListener("click", guard, true);
    return () => document.removeEventListener("click", guard, true);
  }, [dirty]);

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
    if (!selected || selected.locked) return;
    const current = zOf(selected);
    // Step above the lowest peer that currently sits at or above this bubble.
    const above = bubbles
      .filter((b) => b.id !== selected.id && zOf(b) >= current)
      .map((b) => zOf(b))
      .sort((a, b) => a - b)[0];
    updateZ(above === undefined ? current : above + 1);
  }, [selected, bubbles, zOf, updateZ]);

  const sendBackward = useCallback(() => {
    if (!selected || selected.locked) return;
    const current = zOf(selected);
    const below = bubbles
      .filter((b) => b.id !== selected.id && zOf(b) <= current)
      .map((b) => zOf(b))
      .sort((a, b) => b - a)[0];
    updateZ(below === undefined ? current : Math.max(0, below - 1));
  }, [selected, bubbles, zOf, updateZ]);

  const bringToFront = useCallback(() => {
    if (!selected || selected.locked) return;
    const maxZ = bubbles.reduce((m, b) => Math.max(m, zOf(b)), 0);
    updateZ(maxZ + 1);
  }, [selected, bubbles, zOf, updateZ]);

  const sendToBack = useCallback(() => {
    if (!selected || selected.locked) return;
    // Push every other bubble up by one and place this one at 0, so it sits below
    // all peers while keeping their relative order.
    const minZ = bubbles.reduce((m, b) => Math.min(m, zOf(b)), Number.POSITIVE_INFINITY);
    if (minZ > 0) {
      updateZ(0);
      return;
    }
    history.record();
    setBubbles((prev) =>
      prev.map((b) =>
        b.id === selected.id
          ? { ...b, zIndex: 0 }
          : { ...b, zIndex: (b.zIndex ?? LETTERING_STYLE_DEFAULTS.zIndex) + 1 },
      ),
    );
    markDirty();
  }, [selected, bubbles, zOf, updateZ, markDirty, history]);

  const nudgeSelected = useCallback(
    (dx: number, dy: number) => {
      const items = bubbles.filter((b) => activeIds.includes(b.id) && !b.locked);
      if (!items.length) return;
      dx = clamp(
        dx,
        -Math.min(...items.map((b) => b.geometry.x)),
        1 - Math.max(...items.map((b) => b.geometry.x + b.geometry.width)),
      );
      dy = clamp(
        dy,
        -Math.min(...items.map((b) => b.geometry.y)),
        1 - Math.max(...items.map((b) => b.geometry.y + b.geometry.height)),
      );
      history.record({ coalesce: true, key: `nudge:${activeIds.join(",")}` });
      setBubbles((prev) =>
        prev.map((b) =>
          activeIds.includes(b.id) && !b.locked
            ? { ...b, geometry: { ...b.geometry, x: b.geometry.x + dx, y: b.geometry.y + dy } }
            : b,
        ),
      );
      markDirty();
    },
    [bubbles, activeIds, history, markDirty],
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

  useEffect(() => {
    const editor = confirmationRef.current;
    if (!pendingNavigation || !ready || !editor) return;
    const previous = document.activeElement;
    const fields = () =>
      Array.from(
        editor.querySelectorAll<HTMLElement>(
          'button,input,select,textarea,a[href],[contenteditable="true"],[tabindex="0"]',
        ),
      ).filter(
        (el) => !el.matches(":disabled") && el.getClientRects().length > 0 && el.tabIndex >= 0,
      );
    if (!editor.contains(document.activeElement)) fields()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.isComposing) return;
      const list = fields(),
        first = list[0],
        last = list.at(-1);
      if (!first || !last) return;
      if (
        event.shiftKey &&
        (document.activeElement === first || !editor.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !editor.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", trap, true);
    return () => {
      window.removeEventListener("keydown", trap, true);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [ready, pendingNavigation]);

  const save = useCallback(async () => {
    if (saving || !dirty) return !saving && !dirty;
    setSaving(true);
    setMessage(null);
    // Snapshot the payload AND the edit generation together. Persist the render
    // core's overflow flag so the on-disk model matches what the editor shows
    // (the schema overlay carries its own `overflow` field).
    const generationAtStart = editGenRef.current;
    const overflowById = new Map(plans.map((plan) => [plan.id, plan.overflow]));
    const payload = bubbles.map((b) => ({ ...b, overflow: overflowById.get(b.id) ?? b.overflow }));
    try {
      const outcome = await persistWithGuard({
        request: () =>
          fetch("/api/lettering", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              workId,
              episodeId,
              cutId,
              overlays: payload,
              baseRevision: revisionRef.current,
            }),
          }),
        generationAtStart,
        readGeneration: () => editGenRef.current,
      });
      if (!outcome.ok) {
        setMessage({ kind: "error", text: outcome.error });
        return false;
      } else {
        // Do NOT write the snapshot back into state — an edit made during the
        // await would be reverted. Only clear dirty when no edit landed mid-save.
        if (outcome.revision) revisionRef.current = outcome.revision;
        onSaved?.(payload, revisionRef.current);
        if (outcome.clean) {
          setDirty(false);
          clearDraft();
        }
        setMessage({ kind: "ok", text: "Lettering saved." });
        return outcome.clean;
      }
    } finally {
      setSaving(false);
    }
  }, [bubbles, plans, workId, episodeId, cutId, saving, dirty, clearDraft, onSaved]);

  const continueNavigation = () => {
    if (!pendingNavigation) return;
    allowUnloadRef.current = true;
    clearDraft();
    if ("reload" in pendingNavigation) window.location.reload();
    else if ("action" in pendingNavigation) pendingNavigation.action();
    else router.push(pendingNavigation.href);
    setPendingNavigation(null);
  };

  // Keyboard (#333): arrows nudge the selected bubble (Shift for a larger
  // step), Delete removes it, Cmd/Ctrl+D duplicates it, Cmd/Ctrl+Z undoes and
  // Shift+Cmd/Ctrl+Z or Cmd/Ctrl+Y redoes. A field that has focus keeps its own
  // keys, so typing in the inspector never moves or deletes a bubble.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.isComposing ||
        event.defaultPrevented ||
        !(event.target instanceof Node) ||
        !editorRoot.current?.contains(event.target)
      )
        return;
      if (pendingNavigation) {
        if (event.key === "Escape") {
          event.preventDefault();
          setPendingNavigation(null);
        }
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
        return;
      }
      if (keyboardOwnedByField(event)) return;
      if (
        event.target instanceof Element &&
        event.target.closest("button,a") &&
        ["Enter", " "].includes(event.key)
      )
        return;
      if (event.code === "Space") {
        event.preventDefault();
        spaceRef.current = true;
        return;
      }
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && key === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (mod && key === "d") {
        event.preventDefault();
        duplicateSelected();
        return;
      }
      if (mod && key === "a") {
        event.preventDefault();
        setSelectedId(bubbles.at(-1)?.id ?? null);
        setAdditionalIds(bubbles.slice(0, -1).map((b) => b.id));
        return;
      }
      if (mod && key === "c") {
        event.preventDefault();
        void copyBubbles();
        return;
      }
      if (event.key === "Escape") {
        setArmed(null);
        setEditingId(null);
        return;
      }
      if (event.key === "Enter" && selected) {
        event.preventDefault();
        startEditing(selected.id);
        return;
      }
      if (!hasEditableSelection) return;
      const step = event.shiftKey ? 0.05 : 0.01;
      switch (event.key) {
        case "ArrowUp":
          event.preventDefault();
          nudgeSelected(0, -step);
          break;
        case "ArrowDown":
          event.preventDefault();
          nudgeSelected(0, step);
          break;
        case "ArrowLeft":
          event.preventDefault();
          nudgeSelected(-step, 0);
          break;
        case "ArrowRight":
          event.preventDefault();
          nudgeSelected(step, 0);
          break;
        case "Delete":
        case "Backspace":
          event.preventDefault();
          deleteSelected();
          break;
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") spaceRef.current = false;
    };
    const blur = () => {
      spaceRef.current = false;
      panRef.current = null;
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [
    selected,
    hasEditableSelection,
    undo,
    redo,
    duplicateSelected,
    nudgeSelected,
    deleteSelected,
    save,
    bubbles,
    copyBubbles,
    startEditing,
    pendingNavigation,
  ]);

  return (
    <section
      ref={editorRoot}
      inert={!ready}
      aria-busy={!ready}
      aria-label="Lettering editor"
      className={`editor editor-focus${integrated ? " integrated-cut" : ""}`}
      data-inspector-open={inspectorOpen}
      data-workspace-wide={wideWorkspace}
      data-testid={`cut-editor-${cutId}`}
    >
      {pendingNavigation && (
        <div className="lettering-confirm-backdrop">
          <div
            className="lettering-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-label="Unsaved lettering"
            ref={confirmationRef}
          >
            <h2>Save your lettering before leaving?</h2>
            <p>Your changes are still on this cut. Save them, or discard them to continue.</p>
            {message?.kind === "error" && <p role="alert">{message.text}</p>}
            <div className="chip-row">
              <button
                type="button"
                className="btn"
                disabled={saving}
                onClick={() => setPendingNavigation(null)}
              >
                Keep editing
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={saving}
                onClick={continueNavigation}
              >
                Discard and continue
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving}
                onClick={async () => {
                  if (await save()) continueNavigation();
                }}
              >
                {saving ? "Saving…" : "Save and continue"}
              </button>
            </div>
          </div>
        </div>
      )}
      <header className="page-head">
        <div>
          <p className="page-eyebrow">{webtoonTitle}</p>
          <h1 className="page-title">Lettering</h1>
          <div className="page-meta">
            <span>
              {!integrated && <>{episodeTitle} · </>}Cut <code>{cutId}</code>
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
          {!integrated && (
            <label className="lettering-cut-picker">
              Cut
              <select
                aria-label="Edit cut"
                value={cutId}
                disabled={dirty}
                onChange={(event) => {
                  const target = cutNavigation.find((c) => c.id === event.target.value);
                  if (target) router.push(target.href);
                }}
              >
                {cutNavigation.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() =>
              ask(
                "Help me improve this cut. Discuss the scene and dialogue before proposing changes.",
                { episodeId, cutId },
              )
            }
          >
            Ask agent
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            aria-pressed={inspectorOpen}
            onClick={() => setInspectorPreference(!inspectorOpen)}
          >
            Properties
          </button>
          {!integrated && (
            <Link
              href={`/w/${encodeURIComponent(workId)}/episodes/${encodeURIComponent(episodeId)}`}
              className="btn btn-ghost"
              onClick={(event) => {
                if (dirty) {
                  event.preventDefault();
                  setPendingNavigation({
                    href: `/w/${encodeURIComponent(workId)}/episodes/${encodeURIComponent(episodeId)}`,
                  });
                }
              }}
            >
              Episode
            </Link>
          )}
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

      <div
        hidden={integrated && !message && !dirty}
        className={`lettering-status${message?.kind === "error" ? " is-error" : ""}`}
        role={message?.kind === "error" ? "alert" : "status"}
      >
        <span title={message?.text}>{message?.text ?? (dirty ? "Unsaved changes" : "Saved")}</span>
        {message?.kind === "error" && (
          <>
            <button type="button" className="btn btn-chip" onClick={() => copyBubbles(true)}>
              Copy draft
            </button>
            <button
              type="button"
              className="btn btn-chip"
              onClick={() => {
                setPendingNavigation({ reload: true });
              }}
            >
              Reload saved version
            </button>
          </>
        )}
        {message && (
          <button
            type="button"
            className="btn btn-chip"
            aria-label="Dismiss notification"
            onClick={() => setMessage(null)}
          >
            ×
          </button>
        )}
      </div>

      <div className="editor-layout">
        <div className="editor-stage-wrap">
          <fieldset className="editor-toolbar" aria-label="Bubble tools">
            <button
              type="button"
              aria-label="Copy"
              title="Copy"
              className="btn btn-icon"
              disabled={!activeIds.length}
              onClick={() => void copyBubbles()}
            >
              <StudioIcon name="copy" />
            </button>
            <button
              type="button"
              aria-label="Paste"
              className="btn btn-icon"
              title="Paste bubbles copied in this tab. Cmd/Ctrl+V uses the system clipboard."
              onClick={() => void pasteBubbles()}
            >
              <StudioIcon name="paste" />
            </button>
            <button
              type="button"
              className="btn btn-icon"
              disabled={!activeIds.length}
              onClick={toggleLock}
              aria-label={
                bubbles.some((b) => activeIds.includes(b.id) && b.locked) ? "Unlock" : "Lock"
              }
              title="Lock or unlock selection"
            >
              <StudioIcon
                name={bubbles.some((b) => activeIds.includes(b.id) && b.locked) ? "unlock" : "lock"}
              />
            </button>
            <button
              type="button"
              className="btn"
              disabled={!selected || selected.locked}
              onClick={() => selected && startEditing(selected.id)}
            >
              <StudioIcon name="text" /> Edit text
            </button>
            <button
              type="button"
              aria-label="Undo"
              className="btn btn-icon"
              onClick={undo}
              disabled={!history.canUndo}
              title="Undo (Cmd/Ctrl+Z)"
              data-testid="editor-undo"
            >
              <StudioIcon name="undo" />
            </button>
            <button
              type="button"
              aria-label="Redo"
              className="btn btn-icon"
              onClick={redo}
              disabled={!history.canRedo}
              title="Redo (Shift+Cmd/Ctrl+Z)"
              data-testid="editor-redo"
            >
              <StudioIcon name="redo" />
            </button>
            <button type="button" className="btn" onClick={addBubble} data-testid="editor-add">
              <StudioIcon name="plus" /> Add bubble
            </button>
            <button
              type="button"
              aria-label="Duplicate"
              className="btn btn-icon"
              onClick={duplicateSelected}
              disabled={!hasEditableSelection}
              title="Duplicate (Cmd/Ctrl+D)"
              data-testid="editor-duplicate"
            >
              <StudioIcon name="duplicate" />
            </button>
            <button
              type="button"
              aria-label="Delete"
              className="btn btn-icon btn-danger"
              onClick={deleteSelected}
              disabled={!hasEditableSelection}
              title="Delete (Delete key)"
              data-testid="editor-delete"
            >
              <StudioIcon name="trash" />
            </button>
            {themeId !== null && (!integrated || theme !== null) && (
              <button
                type="button"
                className="btn"
                onClick={applyThemeToSelected}
                disabled={!selected || selected.locked || theme === null}
                title={
                  theme === null
                    ? `Theme "${themeId}" is selected in webtoon.json but no installed pack provides it`
                    : `Apply the "${themeId}" theme's defaults to this bubble`
                }
                data-testid="editor-apply-theme"
              >
                Apply theme{theme === null ? " (not installed)" : ""}
              </button>
            )}
          </fieldset>

          <details className="lettering-alignment-menu" aria-disabled={!activeIds.length}>
            <summary>Align objects</summary>
            <fieldset className="lettering-object-alignment" aria-label="Align objects">
              <span>
                {activeIds.length > 1
                  ? `${activeIds.length} selected · align objects`
                  : "Align to artwork"}
              </span>
              {(["left", "center", "right", "top", "middle", "bottom"] as const).map((mode) => (
                <button
                  type="button"
                  className="btn btn-chip"
                  key={mode}
                  disabled={!hasEditableSelection}
                  onClick={() => alignObjects(mode)}
                  title={`Align objects ${mode}`}
                >
                  <AlignmentSymbol
                    mode={mode}
                    vertical={["top", "middle", "bottom"].includes(mode)}
                  />
                  {mode}
                </button>
              ))}
            </fieldset>
          </details>
          <div className="lettering-view-controls">
            <button
              className="btn btn-chip"
              type="button"
              onClick={() => {
                setFitMode(false);
                setZoom((z) => Math.max(0.25, z - 0.1));
              }}
              aria-label="Zoom out"
            >
              <StudioIcon name="minus" />
            </button>
            <output>{Math.round(zoom * 100)}%</output>
            <button
              className="btn btn-chip"
              type="button"
              onClick={() => {
                setFitMode(false);
                setZoom((z) => Math.min(2.5, z + 0.1));
              }}
              aria-label="Zoom in"
            >
              <StudioIcon name="plus" />
            </button>
            <button
              className="btn btn-chip"
              type="button"
              aria-pressed={fitMode === "width"}
              onClick={() => setFitMode("width")}
            >
              Fit width
            </button>
            <button
              className="btn btn-chip"
              type="button"
              aria-pressed={fitMode === "cut"}
              onClick={() => setFitMode("cut")}
            >
              Fit cut
            </button>
            <button
              className="btn btn-chip"
              type="button"
              aria-pressed={panMode}
              onClick={() => {
                setPanMode((p) => !p);
                viewportRef.current?.focus();
              }}
            >
              Pan
            </button>
            <label>
              <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />{" "}
              Snap guides
            </label>
            {editingId && (
              <button className="btn btn-primary" type="button" onClick={() => setEditingId(null)}>
                Done typing
              </button>
            )}
            <span>
              {editingId
                ? "Select words for text formatting. Esc finishes."
                : armed
                  ? "Click the art to place, or drag a preset."
                  : "Click text to type. Drag to move. Shift-click to select several."}
            </span>
          </div>
          {legacyRequest && (
            <div className="editor-toast editor-toast-warn">
              Direct text editing uses consistent text sizing and bundled font fallback. Convert
              this bubble to enable it.
              <button
                type="button"
                className="btn btn-chip"
                onClick={() => {
                  const b = bubbles.find((b) => b.id === legacyRequest);
                  if (!b) return;
                  update(b.id, {
                    textLayout: b.textLayout ?? defaultLetteringTextLayout(referenceWidth),
                    textRanges: b.textRanges ?? [],
                  });
                  setEditingId(b.id);
                  setLegacyRequest(null);
                }}
              >
                Enable direct editing
              </button>
              <button type="button" className="btn btn-chip" onClick={() => setLegacyRequest(null)}>
                Keep current layout
              </button>
            </div>
          )}
          <div className="lettering-workspace">
            <LetteringPresets
              dialogueLanguage={dialogueLanguage}
              gutterBandWidth={gutterBandWidth}
              width={art.width}
              height={art.height}
              referenceWidth={referenceWidth}
              theme={theme ?? undefined}
              armed={armed}
              onArm={(kind) => {
                setEditingId(null);
                setArmed(kind);
              }}
            />
            <section
              className="lettering-viewport"
              aria-label="Artwork viewport"
              tabIndex={-1}
              ref={viewportRef}
              data-testid="lettering-viewport"
              onKeyDown={(event) => {
                if (event.target === event.currentTarget && event.key.startsWith("Arrow")) {
                  event.preventDefault();
                  event.stopPropagation();
                  event.currentTarget.scrollBy(
                    event.key === "ArrowRight" ? 40 : event.key === "ArrowLeft" ? -40 : 0,
                    event.key === "ArrowDown" ? 40 : event.key === "ArrowUp" ? -40 : 0,
                  );
                }
              }}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes(LETTERING_PRESET_MIME)) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                const kind = event.dataTransfer.getData(LETTERING_PRESET_MIME);
                const pt = pointerToNorm(event);
                if (pt && BALLOON_LIBRARY.some((preset) => preset.id === kind)) addPreset(kind, pt);
              }}
              onPointerDownCapture={(event) => {
                if ((panMode || spaceRef.current || event.button === 1) && !editingId) {
                  event.preventDefault();
                  event.stopPropagation();
                  const el = event.currentTarget;
                  panRef.current = {
                    x: event.clientX,
                    y: event.clientY,
                    left: el.scrollLeft,
                    top: el.scrollTop,
                  };
                  el.setPointerCapture(event.pointerId);
                }
              }}
              onPointerMoveCapture={(event) => {
                const p = panRef.current;
                if (!p) return;
                event.stopPropagation();
                event.currentTarget.scrollLeft = p.left - event.clientX + p.x;
                event.currentTarget.scrollTop = p.top - event.clientY + p.y;
              }}
              onPointerUpCapture={(event) => {
                if (panRef.current) {
                  panRef.current = null;
                  event.currentTarget.releasePointerCapture(event.pointerId);
                  event.stopPropagation();
                }
              }}
            >
              <LetteringCanvas
                art={art}
                plans={plans}
                bubbles={bubbles}
                selectedIds={activeIds}
                editingId={editingId}
                svgRef={svgRef}
                inlineRef={inlineRef}
                guides={guides}
                displayWidth={referenceWidth * zoom}
                artStyle={artStyle}
                reserved={reserved}
                onMove={startMove}
                onResize={startResize}
                onTail={startTail}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onBackground={(event) => {
                  if (armed) {
                    event.preventDefault();
                    const pt = pointerToNorm(event);
                    if (pt) addPreset(armed, pt);
                  } else {
                    setSelectedId(null);
                    setAdditionalIds([]);
                    setEditingId(null);
                  }
                }}
                onTextChange={(patch) => {
                  if (editingId) update(editingId, patch);
                }}
                onTextSelection={setTextSelection}
                onFinish={() => setEditingId(null)}
                onUndo={undo}
                onRedo={redo}
              />
            </section>
          </div>
        </div>

        <aside
          className="editor-inspector"
          hidden={!inspectorOpen}
          data-testid="editor-inspector"
          aria-label="Lettering properties"
        >
          {/* The cut's own fields (#332): prompt, cast, shot, palette, shape.
              Collapsed by default so the bubble stays the inspector's subject;
              saves on its own path and never touches the render record. */}
          {selected ? (
            <fieldset className="lettering-object-settings" disabled={Boolean(selected.locked)}>
              <BubbleInspector
                overlay={selected}
                artWidth={art.width}
                artHeight={art.height}
                gutterBandWidth={gutterBandWidth}
                referenceWidth={referenceWidth}
                directSelection={editingId === selected.id ? textSelection : undefined}
                onRestoreSelection={() => inlineRef.current?.focusSelection(textSelection)}
                overflow={selectedPlan?.overflow ?? false}
                fontSegments={selectedPlan?.lines.flatMap((line) => line.segments ?? [])}
                onChange={(patch) => update(selected.id, patch)}
                onBringForward={bringForward}
                onSendBackward={sendBackward}
                onBringToFront={bringToFront}
                onSendToBack={sendToBack}
                onNudge={nudgeSelected}
                projectPalette={projectPalette}
                dialogueLanguage={dialogueLanguage}
              />
            </fieldset>
          ) : (
            <div className="inspector-empty">
              <h2 className="card-title">Inspector</h2>
              <p className="empty">
                Select a bubble on the canvas, or add one, to edit its speaker, text, and style.
              </p>
            </div>
          )}
          <details className="lettering-art-review">
            <summary>Artwork review</summary>
            <CutReviewControl
              key={artworkRevision}
              workId={workId}
              episodeId={episodeId}
              cutId={cutId}
              initialReviewStatus={initialReviewStatus}
              artworkRevision={artworkRevision}
            />
          </details>
          <ArtRevisions
            workId={workId}
            episodeId={episodeId}
            cutId={cutId}
            sourceDigest={
              art.src ? new URL(art.src, "http://local.invalid").searchParams.get("revision") : null
            }
            characters={characters}
            dirty={dirty}
          />
          <details className="inspector-cut-context">
            <summary>Scene details</summary>
            <CutFieldsEditor
              workId={workId}
              episodeId={episodeId}
              cutId={cutId}
              initial={cutFields}
              characters={characters}
              renderRecord={renderRecord}
            />
          </details>
        </aside>
      </div>
    </section>
  );
}
