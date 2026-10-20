"use client";

// The cut lettering editor, hosted by the episode editor. The interactive
// counterpart to the read-only cut preview.
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
// `/api/lettering`, which validates and writes the episode's lettering. A cut
// without artwork shows its scene text until the agent draws it; the person can
// ask the agent from here, or bring their own image by upload or drop.
// The person marks a cut final here; the agent never does.

import { layoutCut, legacyTextLayout } from "@toony/render";
import {
  applyLetteringTheme,
  type Character,
  LETTERING_STYLE_DEFAULTS,
  type LetteringOverlay,
  type LetteringTheme,
  type ReviewStatus,
} from "@toony/schema";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openAgentPanel } from "@/lib/agent/focus-store";
import { useBrowserMeasure } from "@/lib/browser-measure";
import { clamp } from "@/lib/clamp";
import { resolveCutStage } from "@/lib/cut-stage";
import { decodeEditorDraft, encodeEditorDraft } from "@/lib/editor-draft";
import { isConflictMessage, plainSaveError } from "@/lib/editor-messages";
import { persistWithGuard } from "@/lib/editor-save";
import { letteringClipboard, parseLetteringClipboard } from "@/lib/lettering-clipboard";
import { useEditorScope } from "@/lib/live/provider";
import { BALLOON_LIBRARY, libraryOverlay, newOverlay, tailDragPatch } from "@/lib/new-overlay";
import type { CutArt } from "@/lib/project";
import { bubbleMissingSpeaker, defaultSpeaker, needsSpeaker, speakerChoices } from "@/lib/speaker";
import { studioFetch } from "@/lib/studio-fetch";
import { suggestionOverlay, suggestionReplacePatch } from "@/lib/suggestions/insert";
import type { DialogueSuggestion } from "@/lib/suggestions/types";
import { AlignmentSymbol } from "./alignment-symbol";
import type { InspectorTab } from "./bubble-inspector";
import { DialogueSuggestions } from "./dialogue-suggestions";
import { FrameDialog, type FramePicture } from "./frame-dialog";
import type { InlineTextHandle, TextSelection } from "./inline-lettering-text";
import { LetteringCanvas } from "./lettering-canvas";
import { LETTERING_PRESET_MIME, LetteringPresets } from "./lettering-presets";
import { SaveState } from "./save-state";
import { StudioIcon } from "./studio-icon";
import { keyboardOwnedByField, useEditHistory } from "./use-edit-history";

// The pro-lettering inspector (typography/color/styling/arrangement) and its
// lightweight color picker are editor-only. Lazy-load them as a separate chunk
// via next/dynamic so the library/reader bundles never pull in this control
// surface — only the focused cut editor downloads it, on demand.
const BubbleInspector = dynamic(() => import("./bubble-inspector").then((m) => m.BubbleInspector), {
  ssr: false,
  loading: () => (
    <div className="inspector-form" data-testid="bubble-inspector-loading" aria-busy="true" />
  ),
});

/** One cut's saved data, built by the episode page on the server. */
export interface CutEditorProps {
  workId: string;
  episodeId: string;
  cutId: string;
  /** 1-based place in reading order ("Cut 3"). */
  cutNumber: number;
  art: CutArt;
  /** Whether the cut has artwork on disk (art-less cuts show their scene text). */
  hasArtwork: boolean;
  initialBubbles: LetteringOverlay[];
  initialLetteringRevision: string;
  reviewStatus?: ReviewStatus;
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
  /** The cut's scene description, shown read-only (the agent edits it). */
  scene: string;
  /** Characters the cut names, for the speaker picker. */
  cutCharacterIds: string[];
  /** The project's cast. */
  characters: readonly Character[];
  /** The project's lettering theme (#334), or null when none applies. */
  theme: LetteringTheme | null;
  /** The selected theme id, shown when the pack providing it is not installed. */
  themeId: string | null;
}

/** What the episode editor adds while a cut editor is open. */
export interface CutEditorRuntime {
  registerNavigation?: (guard: ((next: () => void) => void) | null) => void;
  onSaved?: (bubbles: LetteringOverlay[], revision: string) => void;
  /** The selected bubble ids, for the agent's focus. */
  onSelectionChange?: (bubbleIds: string[]) => void;
  /** Artwork or the final mark changed on disk: refresh the page data. */
  onProjectChanged?: () => void;
  /** The speaker the person used last in this episode. */
  lastSpeaker?: string | null;
  onSpeakerUsed?: (speaker: string) => void;
  /** Other cuts of the episode with a picture, for framing part of one here. */
  pictures?: readonly FramePicture[];
}

const ARTWORK_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
/** From this editor width, Properties opens on its own. */
const OPEN_INSPECTOR_WIDTH = 940;
/**
 * From this editor width, Properties sits beside the canvas (about 260 px) and
 * the cut fit shrinks to make room. A laptop with the agent panel docked and
 * the Cuts list open leaves the editor about 670 px. Narrower editors get a
 * drawer below the toolbar instead.
 */
const INLINE_INSPECTOR_WIDTH = 640;

/** Bubbles compared for the clean point: the stored overflow flag follows the render. */
function stableBubbles(bubbles: readonly LetteringOverlay[]): string {
  return JSON.stringify(bubbles.map(({ overflow: _overflow, ...rest }) => rest));
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
  cutId,
  cutNumber,
  art,
  hasArtwork,
  initialBubbles,
  initialLetteringRevision,
  reviewStatus,
  artworkRevision,
  dialogueLanguage,
  gutterBandWidth,
  referenceWidth,
  scene,
  cutCharacterIds,
  characters,
  theme,
  themeId,
  registerNavigation,
  onSaved,
  onSelectionChange,
  onProjectChanged,
  lastSpeaker,
  onSpeakerUsed,
  pictures = [],
}: CutEditorProps & CutEditorRuntime) {
  const [frameOpen, setFrameOpen] = useState(false);
  const router = useRouter();
  const [bubbles, setBubbles] = useState<LetteringOverlay[]>(initialBubbles);
  // The saved state, for the clean point: undoing back to it clears "unsaved".
  const savedJsonRef = useRef(stableBubbles(initialBubbles));
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
  const [inlineInspector, setInlineInspector] = useState(false);
  const inspectorOpen = inspectorPreference ?? wideWorkspace;
  useEffect(() => {
    const root = editorRoot.current;
    if (!root) return;
    const observer = new ResizeObserver(() => {
      setWideWorkspace(root.clientWidth >= OPEN_INSPECTOR_WIDTH);
      setInlineInspector(root.clientWidth >= INLINE_INSPECTOR_WIDTH);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  // The drawer starts below the bubble toolbar, so the tools stay in reach.
  const toolbarRowRef = useRef<HTMLDivElement>(null);
  const [drawerTop, setDrawerTop] = useState(0);
  useEffect(() => {
    const row = toolbarRowRef.current;
    if (!row) return;
    const measure = () => setDrawerTop(Math.ceil(row.offsetTop + row.offsetHeight));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, []);
  const [additionalIds, setAdditionalIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [textSelection, setTextSelection] = useState<TextSelection>({ start: 0, end: 0 });
  const [armed, setArmed] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.75),
    [fitMode, setFitMode] = useState<false | "cut" | "width">("cut");
  const [snap, setSnap] = useState(true);
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const viewportRef = useRef<HTMLDivElement>(null),
    inlineRef = useRef<InlineTextHandle>(null);
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null),
    spaceRef = useRef(false);
  // Align is a small menu: a click elsewhere closes it, except on the canvas,
  // where the person may be picking the bubbles to align.
  const alignMenuRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      const menu = alignMenuRef.current;
      const target = event.target as Node;
      if (!menu?.open || menu.contains(target)) return;
      if (viewportRef.current?.contains(target)) return;
      menu.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const revisionRef = useRef(initialLetteringRevision),
    allowUnloadRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [requestTab, setRequestTab] = useState<{ tab: InspectorTab; nonce: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [review, setReview] = useState<ReviewStatus>(reviewStatus ?? "draft");
  const [reviewBusy, setReviewBusy] = useState(false);
  const beforeFinalRef = useRef<ReviewStatus>(
    reviewStatus && reviewStatus !== "final" ? reviewStatus : "human-edited",
  );
  useEffect(() => {
    setReview(reviewStatus ?? "draft");
  }, [reviewStatus]);
  // Live sync: a change from the agent never replaces unsaved lettering.
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty || saving;
  useEditorScope(`lettering:${episodeId}/${cutId}`, () => dirtyRef.current);

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

  // Undo and redo know the saved state: stepping back to it is clean again.
  const travel = useCallback(
    (state: LetteringOverlay[] | null) => {
      if (state === null) return;
      setBubbles(state);
      setSelectedId((id) =>
        id !== null && state.some((b) => b.id === id) ? id : (state[0]?.id ?? null),
      );
      editGenRef.current += 1;
      setMessage(null);
      const clean = stableBubbles(state) === savedJsonRef.current;
      setDirty(!clean);
      if (clean) {
        try {
          sessionStorage.removeItem(draftKey);
        } catch {
          /* Storage may be disabled. */
        }
      }
    },
    [draftKey],
  );
  const undo = useCallback(() => travel(history.undo()), [history, travel]);
  const redo = useCallback(() => travel(history.redo()), [history, travel]);

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
      // Lettering saved before editable text layouts (for example what the
      // agent lettered) converts on the first edit, keeping the size it had.
      if (plan.lines.some((line) => line.sourceStart === undefined)) {
        update(b.id, {
          textLayout: b.textLayout ?? legacyTextLayout(b, { width, height }, referenceWidth),
          textRanges: b.textRanges ?? [],
        });
      }
      setEditingId(id);
      // The caret starts after the text, so typing adds to it instead of
      // replacing a line the person meant to fix.
      setTextSelection({ start: b.text.length, end: b.text.length });
    },
    [bubbles, plans, update, width, height, referenceWidth],
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

  const speakerFor = useCallback(
    () =>
      defaultSpeaker({
        lastUsed: lastSpeaker ?? null,
        cutCharacterIds,
        characters,
        bubbles,
      }),
    [lastSpeaker, cutCharacterIds, characters, bubbles],
  );
  const withSpeaker = useCallback(
    (overlay: LetteringOverlay): LetteringOverlay =>
      needsSpeaker(overlay.kind) && overlay.speaker.trim() === ""
        ? { ...overlay, speaker: speakerFor() }
        : overlay,
    [speakerFor],
  );

  const addBubble = useCallback(() => {
    const created = withSpeaker(
      newOverlay(cutId, bubbles.length, theme ?? undefined, referenceWidth),
    );
    setAdditionalIds([]);
    history.record();
    setBubbles((prev) => [...prev, created]);
    setSelectedId(created.id);
    setEditingId(created.id);
    markDirty();
  }, [cutId, bubbles.length, theme, referenceWidth, history, markDirty, withSpeaker]);

  // A suggested line becomes lettering only here, on the person's click: a new
  // bubble of its kind, or the text of the selected bubble. Both can be undone.
  const insertSuggestion = useCallback(
    (option: DialogueSuggestion, text: string, speakerName?: string) => {
      const base = newOverlay(cutId, bubbles.length, theme ?? undefined, referenceWidth);
      const created = suggestionOverlay(base, option, text, speakerName);
      setEditingId(null);
      setAdditionalIds([]);
      history.record();
      setBubbles((prev) => [...prev, created]);
      setSelectedId(created.id);
      markDirty();
    },
    [cutId, bubbles.length, theme, referenceWidth, history, markDirty],
  );
  const replaceWithSuggestion = useCallback(
    (option: DialogueSuggestion, text: string, speakerName?: string) => {
      if (!selected || selected.locked) return;
      const patch = suggestionReplacePatch(selected, option, text, speakerName);
      setEditingId(null);
      history.record();
      setBubbles((prev) => prev.map((b) => (b.id === selected.id ? { ...b, ...patch } : b)));
      markDirty();
    },
    [selected, history, markDirty],
  );

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
      const created = withSpeaker(
        libraryOverlay(cutId, bubbles.length, presetId, point, {
          width,
          height,
          referenceWidth,
          theme: theme ?? undefined,
        }),
      );
      history.record();
      setBubbles((prev) => [...prev, created]);
      setSelectedId(created.id);
      setAdditionalIds([]);
      setArmed(null);
      setEditingId(created.id);
      markDirty();
    },
    [cutId, bubbles.length, width, height, referenceWidth, theme, history, markDirty, withSpeaker],
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
            ? "Your lettering is copied. Reload, then paste to get it back."
            : "Copied. Paste in this or another cut.",
        });
      } catch {
        setMessage({
          kind: "error",
          text: "Toony could not copy the lettering. Your edits are still here.",
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
  // One clipboard: the system clipboard when it holds copied bubbles, else the
  // copy kept in this tab (which also survives a reload for draft recovery).
  const pasteBubbles = useCallback(async () => {
    let text: string | null = null;
    try {
      text = (await navigator.clipboard?.readText?.()) ?? null;
      if (text !== null) parseLetteringClipboard(text);
    } catch {
      text = null;
    }
    try {
      text ??= sessionStorage.getItem("toony-lettering-clipboard-v1");
      if (!text) throw new Error("Copy some bubbles first, then paste.");
      insertCopied(parseLetteringClipboard(text));
    } catch (cause) {
      setMessage({
        kind: "error",
        text: cause instanceof Error ? cause.message : "Toony could not paste these bubbles.",
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
          0.05,
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
    const silent = bubbleMissingSpeaker(bubbles);
    if (silent) {
      setSelectedId(silent.id);
      setAdditionalIds([]);
      setEditingId(null);
      setInspectorPreference(true);
      setRequestTab({ tab: "text", nonce: Date.now() });
      setMessage({ kind: "error", text: "Choose who says this bubble, then save." });
      return false;
    }
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
          studioFetch("/api/lettering", {
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
        setMessage({ kind: "error", text: plainSaveError(outcome.error) });
        return false;
      } else {
        // Do NOT write the snapshot back into state — an edit made during the
        // await would be reverted. Only clear dirty when no edit landed mid-save.
        if (outcome.revision) revisionRef.current = outcome.revision;
        savedJsonRef.current = stableBubbles(payload);
        onSaved?.(payload, revisionRef.current);
        if (outcome.clean) {
          setDirty(false);
          clearDraft();
        }
        setMessage({ kind: "ok", text: "Saved." });
        return outcome.clean;
      }
    } finally {
      setSaving(false);
    }
  }, [bubbles, plans, workId, episodeId, cutId, saving, dirty, clearDraft, onSaved]);

  // The selected bubbles, for the agent's focus chip.
  const selectionRef = useRef(onSelectionChange);
  selectionRef.current = onSelectionChange;
  const selectionKey = activeIds.join(",");
  useEffect(() => {
    selectionRef.current?.(selectionKey === "" ? [] : selectionKey.split(","));
  }, [selectionKey]);

  // Remember the speaker the person picks, so the next new bubble starts with it.
  const lastSpeakerRef = useRef(onSpeakerUsed);
  lastSpeakerRef.current = onSpeakerUsed;
  const selectedSpeaker = selected?.speaker.trim() ?? "";
  useEffect(() => {
    if (selectedSpeaker !== "") lastSpeakerRef.current?.(selectedSpeaker);
  }, [selectedSpeaker]);

  // Artwork for a cut that has none: upload a file or drop one on the cut.
  const uploadArtwork = useCallback(
    async (file: File) => {
      if (!ARTWORK_TYPES.includes(file.type)) {
        setMessage({ kind: "error", text: "Choose a PNG, JPEG, WebP or GIF image." });
        return;
      }
      setUploading(true);
      setMessage(null);
      try {
        const query = new URLSearchParams({ workId, episodeId, cutId });
        const response = await studioFetch(`/api/artwork?${query.toString()}`, {
          method: "POST",
          headers: { "content-type": file.type },
          body: file,
        });
        const data = (await response.json()) as { ok?: boolean; error?: string };
        if (!response.ok || !data.ok) {
          setMessage({ kind: "error", text: data.error ?? "Toony could not add this artwork." });
          return;
        }
        setMessage({ kind: "ok", text: "Artwork added." });
        onProjectChanged?.();
      } catch {
        setMessage({ kind: "error", text: "Toony could not add this artwork." });
      } finally {
        setUploading(false);
      }
    },
    [workId, episodeId, cutId, onProjectChanged],
  );

  // "Mark as final" is the person's sign-off on the artwork; the agent never sets it.
  const toggleFinal = useCallback(async () => {
    const next: ReviewStatus = review === "final" ? beforeFinalRef.current : "final";
    setReviewBusy(true);
    try {
      const response = await studioFetch("/api/cut-review", {
        method: "POST",
        body: JSON.stringify({ workId, episodeId, cutId, reviewStatus: next, artworkRevision }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        setMessage({
          kind: "error",
          text:
            response.status === 409
              ? "The artwork changed since this page opened. Reload the episode, then try again."
              : (data.error ?? "Toony could not change the final mark."),
        });
        return;
      }
      if (next === "final") beforeFinalRef.current = review === "final" ? "human-edited" : review;
      setReview(next);
      onProjectChanged?.();
    } catch {
      setMessage({ kind: "error", text: "Toony could not change the final mark." });
    } finally {
      setReviewBusy(false);
    }
  }, [review, workId, episodeId, cutId, artworkRevision, onProjectChanged]);

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

  const final = review === "final";
  const anyLocked = bubbles.some((b) => activeIds.includes(b.id) && b.locked);
  const choices = speakerChoices(characters, cutCharacterIds);

  return (
    <section
      ref={editorRoot}
      inert={!ready}
      aria-busy={!ready}
      aria-label={`Cut ${cutNumber} lettering`}
      className="editor editor-focus integrated-cut"
      data-inspector-open={inspectorOpen}
      data-inspector-inline={inlineInspector}
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
      <header className="cut-head">
        <div className="cut-head-title">
          <h2>Cut {cutNumber}</h2>
          <span className="page-meta">
            {bubbles.length} {bubbles.length === 1 ? "bubble" : "bubbles"}
          </span>
          {overflowCount > 0 && (
            <span className="chip chip-warn" data-testid="editor-overflow-count">
              {overflowCount} {overflowCount === 1 ? "does not fit" : "do not fit"}
            </span>
          )}
        </div>
        <div className="editor-actions">
          <SaveState
            dirty={dirty}
            saving={saving}
            onSave={() => void save()}
            testId="editor-save"
          />
          {hasArtwork && (
            <button
              type="button"
              className={final ? "btn btn-final" : "btn"}
              aria-pressed={final}
              disabled={reviewBusy}
              onClick={() => void toggleFinal()}
              title={
                final ? "Marked final. Click to undo the mark." : "Mark this cut's artwork as final"
              }
              data-testid="mark-final"
            >
              <StudioIcon name={final ? "check" : "star"} /> {final ? "Final" : "Mark as final"}
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            aria-pressed={inspectorOpen}
            onClick={() => setInspectorPreference(!inspectorOpen)}
          >
            Properties
          </button>
        </div>
      </header>

      <div
        hidden={!message}
        className={`lettering-status${message?.kind === "error" ? " is-error" : ""}`}
        role={message?.kind === "error" ? "alert" : "status"}
      >
        <span>{message?.text}</span>
        {message?.kind === "error" && isConflictMessage(message.text) && (
          <>
            <button type="button" className="btn btn-chip" onClick={() => copyBubbles(true)}>
              Copy my lettering
            </button>
            <button
              type="button"
              className="btn btn-chip"
              onClick={() => setPendingNavigation({ reload: true })}
            >
              Reload saved version
            </button>
          </>
        )}
        {message && (
          <button
            type="button"
            className="btn btn-chip btn-icon-only"
            aria-label="Dismiss"
            onClick={() => setMessage(null)}
          >
            ×
          </button>
        )}
      </div>

      <div className="editor-layout">
        <div className="editor-stage-wrap">
          <div className="editor-toolbar-row" ref={toolbarRowRef}>
            <fieldset className="editor-toolbar" aria-label="Bubble tools">
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
              <span className="toolbar-divider" aria-hidden="true" />
              <button type="button" className="btn" onClick={addBubble} data-testid="editor-add">
                <StudioIcon name="plus" /> Add bubble
              </button>
              <button
                type="button"
                aria-label="Copy"
                title="Copy (Cmd/Ctrl+C)"
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
                title="Paste (Cmd/Ctrl+V)"
                onClick={() => void pasteBubbles()}
              >
                <StudioIcon name="paste" />
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
                className="btn btn-icon"
                disabled={!activeIds.length}
                onClick={toggleLock}
                aria-label={anyLocked ? "Unlock" : "Lock"}
                title={anyLocked ? "Unlock" : "Lock in place"}
              >
                <StudioIcon name={anyLocked ? "unlock" : "lock"} />
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
              {themeId !== null && theme !== null && (
                <button
                  type="button"
                  className="btn"
                  onClick={applyThemeToSelected}
                  disabled={!selected || selected.locked}
                  title="Give this bubble the webtoon's lettering style"
                  data-testid="editor-apply-theme"
                >
                  Apply style
                </button>
              )}
              <details
                className="lettering-alignment-menu"
                aria-disabled={!activeIds.length}
                ref={alignMenuRef}
                onKeyDown={(event) => {
                  if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  event.stopPropagation();
                  event.currentTarget.open = false;
                  event.currentTarget.querySelector("summary")?.focus();
                }}
              >
                <summary>
                  Align <StudioIcon name="chevron" />
                </summary>
                <fieldset className="lettering-object-alignment" aria-label="Align bubbles">
                  <span>
                    {activeIds.length > 1 ? "Align the selected bubbles" : "Align to the cut"}
                  </span>
                  {(["left", "center", "right", "top", "middle", "bottom"] as const).map((mode) => (
                    <button
                      type="button"
                      className="btn btn-chip"
                      key={mode}
                      disabled={!hasEditableSelection}
                      onClick={() => alignObjects(mode)}
                      aria-label={`Align ${mode}`}
                    >
                      <AlignmentSymbol
                        mode={mode}
                        vertical={["top", "middle", "bottom"].includes(mode)}
                      />
                      {mode.charAt(0).toUpperCase() + mode.slice(1)}
                    </button>
                  ))}
                </fieldset>
              </details>
            </fieldset>
          </div>
          <div className="lettering-view-controls">
            <button
              className="btn btn-chip btn-icon-only"
              type="button"
              onClick={() => {
                setFitMode(false);
                setZoom((z) => Math.max(0.05, z - 0.1));
              }}
              aria-label="Zoom out"
            >
              <StudioIcon name="minus" />
            </button>
            <output aria-label="Zoom">{Math.round(zoom * 100)}%</output>
            <button
              className="btn btn-chip btn-icon-only"
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
            <label className="check-label">
              <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />{" "}
              Snap
            </label>
            <span className="view-hint">
              {editingId
                ? "Select words to style them. Esc finishes."
                : armed
                  ? "Click the cut to place the bubble."
                  : "Click text to type. Drag to move. Hold Space to pan."}
            </span>
          </div>
          <div className="scene-row">
            <p className="scene-caption" title={scene}>
              <b className="scene-caption-label">Scene</b>{" "}
              {scene.trim() || "No scene description yet."}{" "}
              <span className="scene-caption-hint">Ask the agent to change this.</span>
            </p>
            {hasArtwork && (
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => openAgentPanel({ view: "chat", prefill: "Change this cut's art: " })}
                data-testid="ask-change-art"
              >
                <StudioIcon name="chat" /> Change the art
              </button>
            )}
            {(hasArtwork || pictures.length > 0) && (
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => setFrameOpen(true)}
                title="Choose the part of a picture this cut shows"
                data-testid="frame-cut"
              >
                <StudioIcon name="image" /> Frame
              </button>
            )}
          </div>
          <FrameDialog
            open={frameOpen}
            workId={workId}
            episodeId={episodeId}
            cutId={cutId}
            cutNumber={cutNumber}
            art={hasArtwork ? art : { ...art, src: null }}
            pictures={pictures}
            onClose={() => setFrameOpen(false)}
            onSaved={() => onProjectChanged?.()}
          />
          {!hasArtwork && (
            <div
              className={`artwork-drop${dropActive ? " is-active" : ""}`}
              data-testid="artwork-drop"
            >
              <StudioIcon name="image" />
              <span>
                {uploading
                  ? "Adding artwork…"
                  : "No artwork yet. Ask the agent to draw this cut, or drop your own image here."}
              </span>
              {!uploading && (
                <>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => openAgentPanel({ view: "chat", prefill: "Draw this cut." })}
                    data-testid="ask-draw-art"
                  >
                    <StudioIcon name="chat" /> Ask the agent to draw it
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => fileInputRef.current?.click()}
                    data-testid="add-artwork"
                  >
                    <StudioIcon name="upload" /> Add your own image
                  </button>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept={ARTWORK_TYPES.join(",")}
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void uploadArtwork(file);
                }}
                data-testid="artwork-file"
              />
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
              aria-label="Cut canvas"
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
                } else if (!hasArtwork && event.dataTransfer.types.includes("Files")) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                  setDropActive(true);
                }
              }}
              onDragLeave={() => setDropActive(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDropActive(false);
                const file = event.dataTransfer.files?.[0];
                if (!hasArtwork && file) {
                  void uploadArtwork(file);
                  return;
                }
                const kind = event.dataTransfer.getData(LETTERING_PRESET_MIME);
                const pt = pointerToNorm(event);
                if (pt && BALLOON_LIBRARY.some((preset) => preset.id === kind)) addPreset(kind, pt);
              }}
              onPointerDownCapture={(event) => {
                if ((spaceRef.current || event.button === 1) && !editingId) {
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
                sceneText={hasArtwork ? null : scene.trim() || "No scene description yet."}
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
          aria-label="Bubble properties"
          style={{ "--inspector-drawer-top": `${drawerTop}px` } as CSSProperties}
        >
          {!inlineInspector && (
            <div className="inspector-drawer-heading">
              <span>Properties</span>
              <button
                type="button"
                className="btn btn-icon"
                aria-label="Close properties"
                onClick={() => setInspectorPreference(false)}
              >
                <StudioIcon name="close" />
              </button>
            </div>
          )}
          <DialogueSuggestions
            workId={workId}
            episodeId={episodeId}
            cutId={cutId}
            canReplace={Boolean(selected && !selected.locked)}
            onInsert={insertSuggestion}
            onReplace={replaceWithSuggestion}
          />
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
                projectPalette={projectPalette}
                dialogueLanguage={dialogueLanguage}
                speakerChoices={choices}
                defaultSpeaker={speakerFor()}
                requestTab={requestTab}
              />
            </fieldset>
          ) : (
            <div className="inspector-empty">
              <h2 className="card-title">No bubble selected</h2>
              <p className="empty-note">
                Click a bubble on the cut, or add one from the library on the left.
              </p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
