"use client";

// The episode editor: the sequence rail (cuts and the transitions between
// them) and one active editor, either a cut's lettering or a transition.
//
// Cuts are added, removed and reordered through the cut route, each change
// with Undo. Transition edits are held here and saved together. The editor
// follows the live feed: a change made elsewhere (the agent, another tab)
// refreshes a clean editor in place; an editor with unsaved work shows a slim
// banner and keeps the person's edits until they choose.

import type { SequenceItem, Transition } from "@toony/schema";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type DragEvent, useCallback, useEffect, useRef, useState } from "react";
import { setAgentFocus } from "@/lib/agent/focus-store";
import { isConflictMessage, plainSaveError } from "@/lib/editor-messages";
import { persistWithGuard } from "@/lib/editor-save";
import {
  type EpisodeRhythm,
  episodeSelection,
  readRhythmDraft,
  removeEpisodeTransition,
  transitionLabel,
} from "@/lib/episode-editing";
import {
  letteringEditorKey,
  rememberSave,
  type SavedCut,
  startingLettering,
} from "@/lib/lettering-cache";
import { useEditorScope } from "@/lib/live/provider";
import { useProjectSync } from "@/lib/live/use-project-sync";
import {
  cutNumberIn,
  cutOrder,
  dropTarget,
  stepTarget,
  transitionRemovedWith,
} from "@/lib/sequence-order";
import { studioFetch } from "@/lib/studio-fetch";
import { planTransitionInsert } from "@/lib/transition-insert";
import { episodeFocus } from "@/lib/workspace-focus";
import { ActionMenu } from "./action-menu";
import { ConfirmDialog } from "./confirm-dialog";
import { CutEditor, type CutEditorProps } from "./cut-editor";
import { SaveState } from "./save-state";
import { StudioIcon } from "./studio-icon";
import { TransitionBlock } from "./transition-block";
import { TransitionInspector } from "./transition-inspector";
import { useUndoToast } from "./undo-toast";
import { keyboardOwnedByField, useEditHistory } from "./use-edit-history";

interface Props {
  workId: string;
  episodeId: string;
  title: string;
  cuts: CutEditorProps[];
  initialRhythm: EpisodeRhythm;
  initialRevision: string;
  initialItem?: string;
  referenceWidth: number;
}

type Item = { type: "cut" | "transition"; id: string };

const sameRhythm = (a: EpisodeRhythm, b: EpisodeRhythm) => JSON.stringify(a) === JSON.stringify(b);

/** What removing a cut takes with it: a transition only when one actually goes. */
function removalNote(rhythm: EpisodeRhythm, cutId: string | null): string {
  const gone = cutId ? transitionRemovedWith(rhythm.sequence, cutId) : null;
  if (!gone) return "Its lettering goes with it. You can undo right after.";
  const type = rhythm.transitions.find((t) => t.id === gone.id)?.type ?? "gutter";
  return `Its lettering goes with it, and so does the ${transitionLabel(type)} transition ${gone.position} it. You can undo right after.`;
}

export function EpisodeEditor({
  workId,
  episodeId,
  title,
  cuts,
  initialRhythm,
  initialRevision,
  initialItem,
  referenceWidth,
}: Props) {
  const router = useRouter();
  const href = `/w/${encodeURIComponent(workId)}/episodes/${encodeURIComponent(episodeId)}`;
  const [rhythm, setRhythm] = useState(initialRhythm);
  const [selection, setSelection] = useState<Item | null>(() =>
    episodeSelection(initialRhythm.sequence, initialItem),
  );
  const editorRoot = useRef<HTMLElement>(null);
  const [compact, setCompact] = useState(true);
  const [sequencePreference, setSequencePreference] = useState<boolean | null>(null);
  const sequenceOpen = sequencePreference ?? !compact;
  useEffect(() => {
    const root = editorRoot.current;
    if (!root) return;
    const observer = new ResizeObserver(() => setCompact(root.clientWidth <= 600));
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  const [savedCuts, setSavedCuts] = useState<Record<string, SavedCut>>({});
  const [reloadNonce, setReloadNonce] = useState<Record<string, number>>({});
  const [lastSpeaker, setLastSpeaker] = useState<string | null>(null);
  const [bubbleIds, setBubbleIds] = useState<string[]>([]);
  const history = useEditHistory(rhythm);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [cutBusy, setCutBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const toast = useUndoToast(workId);
  const dialog = useRef<HTMLDialogElement>(null);
  const cutGuard = useRef<((next: () => void) => void) | null>(null);
  const registerNavigation = useCallback((guard: ((next: () => void) => void) | null) => {
    cutGuard.current = guard;
  }, []);
  const revision = useRef(initialRevision);
  const savedRevision = useRef(initialRevision);
  const saved = useRef(initialRhythm);
  const generation = useRef(0);
  const saveLock = useRef(false);
  const recoveryReady = useRef(false);
  const draftKey = `toony-episode-rhythm:${workId}/${episodeId}`;

  // Live sync. The rhythm editor registers its unsaved state; the cut editor
  // registers its own. A clean editor follows saved changes in place.
  const rhythmDirty = useRef(false);
  rhythmDirty.current = dirty || saving;
  useEditorScope(`sequence:${episodeId}`, () => rhythmDirty.current);
  const sync = useProjectSync(workId, [{ kind: "episode", episodeId }]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow a new saved revision only.
  useEffect(() => {
    if (initialRevision === savedRevision.current || rhythmDirty.current) return;
    setRhythm(initialRhythm);
    revision.current = savedRevision.current = initialRevision;
    saved.current = initialRhythm;
    history.reset();
  }, [initialRevision]);

  const order = cutOrder(rhythm.sequence);
  const selectedTransition =
    selection?.type === "transition"
      ? rhythm.transitions.find((t) => t.id === selection.id)
      : undefined;
  const selectedCut =
    selection?.type === "cut" ? cuts.find((c) => c.cutId === selection.id) : undefined;
  const cached = selectedCut ? savedCuts[selectedCut.cutId] : undefined;
  const cutStart = selectedCut
    ? startingLettering(selectedCut.initialBubbles, selectedCut.initialLetteringRevision, cached)
    : null;
  const cutKey = selectedCut
    ? letteringEditorKey(
        selectedCut.cutId,
        selectedCut.initialLetteringRevision,
        cached,
        reloadNonce[selectedCut.cutId] ?? 0,
      )
    : "";
  const itemKey = selection ? `${selection.type}:${selection.id}` : "";

  // Report what the person is looking at to the agent panel.
  useEffect(() => {
    const focus = episodeFocus(episodeId, selection, selection?.type === "cut" ? bubbleIds : []);
    focus.labels = { episode: title };
    if (selection?.type === "cut") {
      focus.labels.cut = `Cut ${cutNumberIn(rhythm.sequence, selection.id)}`;
    } else if (selection?.type === "transition") {
      const at = rhythm.sequence.findIndex((i) => i.type === "transition" && i.id === selection.id);
      const before = rhythm.sequence
        .slice(0, Math.max(0, at))
        .filter((i) => i.type === "cut")
        .at(-1);
      focus.labels.transition = before
        ? `After Cut ${cutNumberIn(rhythm.sequence, before.id)}`
        : "Transition";
    }
    setAgentFocus(focus);
  }, [episodeId, title, selection, bubbleIds, rhythm.sequence]);

  const clearDraft = useCallback(() => {
    try {
      sessionStorage.removeItem(draftKey);
    } catch {}
  }, [draftKey]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(draftKey);
      const restored = raw && readRhythmDraft(raw);
      if (restored) {
        revision.current = restored.revision;
        setRhythm({ sequence: restored.sequence, transitions: restored.transitions });
        setSelection(restored.sequence.find((item) => item.type === "transition") ?? null);
        setDirty(true);
        setNotice({ text: "Your unsaved transition changes were restored." });
      }
    } catch {}
    recoveryReady.current = true;
  }, [draftKey]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a save advances the base revision even when newer local edits keep the draft dirty.
  useEffect(() => {
    if (!recoveryReady.current || !dirty) return;
    try {
      sessionStorage.setItem(draftKey, JSON.stringify({ ...rhythm, revision: revision.current }));
    } catch {
      setNotice({
        text: "Save before leaving: this browser cannot keep a recovery copy.",
        error: true,
      });
    }
  }, [rhythm, dirty, saving, draftKey]);
  useEffect(() => {
    if (pending) dialog.current?.showModal();
    else dialog.current?.close();
  }, [pending]);

  // A selection that no longer exists (a cut removed or undone) falls back to
  // the first item; a cut just added is awaited until the refreshed page has it.
  const awaitingCut = useRef<string | null>(null);
  useEffect(() => {
    if (!selection) return;
    if (rhythm.sequence.some((i) => i.type === selection.type && i.id === selection.id)) {
      if (awaitingCut.current === selection.id) awaitingCut.current = null;
      return;
    }
    if (selection.type === "cut" && awaitingCut.current === selection.id) return;
    setSelection(rhythm.sequence[0] ?? null);
  }, [rhythm.sequence, selection]);

  const choose = (item: Item | null) => {
    setSelection(item);
    setBubbleIds([]);
    if (compact) setSequencePreference(false);
    const suffix = item ? `?item=${encodeURIComponent(`${item.type}:${item.id}`)}` : "";
    // Let the app router synchronize its canonical URL and search state.
    window.history.replaceState(null, "", href + suffix);
  };
  /** Run `next` once unsaved transition and lettering edits are saved or discarded. */
  const request = (next: () => void, staysInTransitions = false) => {
    const afterCut = () => (cutGuard.current ? cutGuard.current(next) : next());
    if (dirty && !staysInTransitions) setPending(() => afterCut);
    else afterCut();
  };
  // A link to another item of this episode (for example "Open Cut 3" in the
  // agent panel) arrives as new server props with the same editor mounted.
  // Follow it like a click on that item, with the same unsaved-edit guard.
  const followedItem = useRef(initialItem);
  // biome-ignore lint/correctness/useExhaustiveDependencies: react to a new link target only.
  useEffect(() => {
    if (initialItem === followedItem.current) return;
    followedItem.current = initialItem;
    const next = episodeSelection(rhythm.sequence, initialItem);
    if (!next || (selection && next.type === selection.type && next.id === selection.id)) return;
    request(() => choose(next), next.type === "transition");
  }, [initialItem]);
  /** Run `next` once unsaved transition edits are saved or discarded (the open cut stays). */
  const requestSavedRhythm = (next: () => void) => {
    if (dirty) setPending(() => next);
    else next();
  };
  const change = (next: EpisodeRhythm, coalesce = false) => {
    history.record({ coalesce });
    setRhythm(next);
    generation.current++;
    setDirty(true);
    setNotice(null);
  };
  const update = (patch: Partial<Transition>) => {
    if (!selectedTransition) return;
    change(
      {
        ...rhythm,
        transitions: rhythm.transitions.map((t) =>
          t.id === selectedTransition.id ? { ...t, reviewStatus: "human-edited", ...patch } : t,
        ),
      },
      true,
    );
  };
  const travel = (direction: "undo" | "redo") => {
    const next = history[direction]();
    if (!next) return;
    setRhythm(next);
    if (selection?.type === "transition" && !next.transitions.some((t) => t.id === selection.id))
      choose(null);
    generation.current++;
    const clean = sameRhythm(next, saved.current);
    setDirty(!clean);
    if (clean) clearDraft();
    setNotice(null);
  };
  const insert = (index: number) =>
    request(() => {
      const plan = planTransitionInsert(rhythm.transitions, rhythm.sequence, index, () => ({
        id: `tr-${crypto.randomUUID()}`,
        type: "gutter",
        gutterHeight: 48,
        text: null,
        sfx: null,
        agentNote: null,
        humanNote: null,
        image: null,
        reviewStatus: "human-edited",
      }));
      change({ sequence: plan.sequence, transitions: plan.transitions });
      choose({ type: "transition", id: plan.created.id });
    }, true);
  const remove = () => {
    if (!selectedTransition) return;
    change(removeEpisodeTransition(rhythm, selectedTransition.id));
    choose(null);
  };
  const save = async (): Promise<boolean> => {
    if (saveLock.current) return false;
    if (!dirty) return true;
    saveLock.current = true;
    setSaving(true);
    setNotice(null);
    const snapshot = rhythm;
    try {
      const outcome = await persistWithGuard({
        request: () =>
          studioFetch("/api/transitions", {
            method: "POST",
            body: JSON.stringify({
              workId,
              episodeId,
              ...snapshot,
              baseRevision: revision.current,
            }),
          }),
        generationAtStart: generation.current,
        readGeneration: () => generation.current,
      });
      if (!outcome.ok) {
        setNotice({ text: plainSaveError(outcome.error), error: true });
        return false;
      }
      if (outcome.revision) revision.current = savedRevision.current = outcome.revision;
      saved.current = snapshot;
      if (outcome.clean) {
        setDirty(false);
        clearDraft();
      }
      setNotice({ text: "Saved." });
      return outcome.clean;
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  };
  const discard = () => {
    setRhythm(saved.current);
    revision.current = savedRevision.current;
    history.reset();
    setDirty(false);
    clearDraft();
    setNotice(null);
  };
  /** After a conflict: drop local transition edits and load the saved episode. */
  const reloadEpisode = () => {
    discard();
    savedRevision.current = "";
    router.refresh();
  };

  // --- Cuts: add, remove, reorder, each through the cut route with Undo ----
  const runCutOp = async (
    body: Record<string, unknown>,
    select?: (added: string[]) => Item | null,
  ) => {
    setCutBusy(true);
    try {
      const response = await studioFetch("/api/cuts", {
        method: "POST",
        body: JSON.stringify({ workId, episodeId, ...body }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        added?: string[];
        change?: { summary?: string } | null;
        changeId?: string | null;
      };
      if (!response.ok || !data.ok) {
        toast.show({ text: data.error ?? "Toony could not change the cuts.", tone: "error" });
        return;
      }
      toast.show({ text: `${data.change?.summary ?? "Done"}.`, changeId: data.changeId ?? null });
      const next = select?.(data.added ?? []);
      if (next) {
        // Navigate (not replaceState + refresh): the router fetches the page for
        // the new selection, so the new cut's data arrives with it.
        if (next.type === "cut") awaitingCut.current = next.id;
        setSelection(next);
        setBubbleIds([]);
        router.replace(`${href}?item=${encodeURIComponent(`${next.type}:${next.id}`)}`, {
          scroll: false,
        });
      } else {
        router.refresh();
      }
    } catch {
      toast.show({ text: "Toony could not change the cuts.", tone: "error" });
    } finally {
      setCutBusy(false);
    }
  };
  const anchorCut = (): string | null => {
    if (selection?.type === "cut") return selection.id;
    if (selection?.type === "transition") {
      const index = rhythm.sequence.findIndex(
        (i) => i.type === "transition" && i.id === selection.id,
      );
      for (let i = index; i >= 0; i--) {
        const item = rhythm.sequence[i];
        if (item?.type === "cut") return item.id;
      }
    }
    return order.at(-1) ?? null;
  };
  const addCut = () =>
    request(() => {
      const after = anchorCut();
      void runCutOp({ action: "add", ...(after ? { after } : {}) }, (added) =>
        added[0] ? { type: "cut", id: added[0] } : null,
      );
    });
  const moveCut = (cutId: string, after: string | null | undefined) => {
    if (after === undefined) return;
    requestSavedRhythm(() => void runCutOp({ action: "move", cutId, after }));
  };
  const confirmRemove = () => {
    const cutId = removing;
    setRemoving(null);
    if (!cutId) return;
    request(() => void runCutOp({ action: "remove", cutId }));
  };
  const selectedCutId = selection?.type === "cut" ? selection.id : null;
  const canUp =
    selectedCutId !== null && stepTarget(rhythm.sequence, selectedCutId, "up") !== undefined;
  const canDown =
    selectedCutId !== null && stepTarget(rhythm.sequence, selectedCutId, "down") !== undefined;

  const onRailDragOver = (event: DragEvent<HTMLElement>, cutIndex: number) => {
    if (!dragging) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setDropIndex(event.clientY < rect.top + rect.height / 2 ? cutIndex : cutIndex + 1);
  };
  const onRailDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const cutId = dragging;
    const index = dropIndex;
    setDragging(null);
    setDropIndex(null);
    if (cutId && index !== null) moveCut(cutId, dropTarget(rhythm.sequence, cutId, index));
  };

  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const navigate = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      )
        return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const target = new URL(link.href, location.href);
      if (target.origin !== location.origin || target.href === location.href) return;
      event.preventDefault();
      event.stopPropagation();
      setPending(() => () => router.push(target.pathname + target.search + target.hash));
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", navigate, true);
    };
  }, [dirty, router]);

  // The agent (or another tab) changed something an open editor holds unsaved.
  const changed = sync.changedWhileDirty;
  const changedThisCut =
    changed !== null &&
    selection?.type === "cut" &&
    changed.scopes.some(
      (scope) =>
        (scope.kind === "lettering" || scope.kind === "cut") &&
        scope.episodeId === episodeId &&
        scope.cutId === selection.id,
    );
  const reloadChanged = () => {
    if (selection?.type === "cut") {
      try {
        sessionStorage.removeItem(`toony-lettering:${workId}/${episodeId}/${selection.id}`);
      } catch {}
      const cutId = selection.id;
      setSavedCuts((prev) => {
        const { [cutId]: _dropped, ...rest } = prev;
        return rest;
      });
      setReloadNonce((prev) => ({ ...prev, [cutId]: (prev[cutId] ?? 0) + 1 }));
    }
    if (dirty) {
      discard();
      savedRevision.current = "";
    }
    sync.reload();
  };

  const cutCount = order.length;
  const neighbors = (transitionId: string) => {
    const index = rhythm.sequence.findIndex(
      (i) => i.type === "transition" && i.id === transitionId,
    );
    const before = rhythm.sequence[index - 1];
    const after = rhythm.sequence[index + 1];
    const art = (item: SequenceItem | undefined) =>
      item?.type === "cut" ? (cuts.find((c) => c.cutId === item.id)?.art.src ?? null) : null;
    return { before: art(before), after: art(after) };
  };

  return (
    <section
      ref={editorRoot}
      className="episode-editor"
      aria-label="Episode editor"
      data-testid="episode-editor"
    >
      <header className="episode-editor-head">
        <div className="episode-heading">
          <h1>{title}</h1>
          <span>
            {cutCount} {cutCount === 1 ? "cut" : "cuts"}
          </span>
        </div>
        <div className="editor-actions">
          <button
            type="button"
            className="btn btn-ghost episode-sequence-toggle"
            aria-pressed={sequenceOpen}
            onClick={() => setSequencePreference(!sequenceOpen)}
          >
            <StudioIcon name="sequence" /> Cuts
          </button>
          <Link
            className="btn btn-primary"
            href={`${href}/read?item=${encodeURIComponent(itemKey)}`}
            data-testid="episode-preview"
          >
            <StudioIcon name="eye" /> Preview
          </Link>
          <ActionMenu
            label="More episode actions"
            actions={[
              { label: "Export", href: `${href}/export`, testId: "episode-export" },
              { label: "Script (advanced)", href: `${href}/script`, testId: "episode-script" },
            ]}
          />
        </div>
      </header>
      {changed && (
        <div className="sync-banner" role="status" data-testid="sync-banner">
          <span>
            {changed.actor === "agent"
              ? changedThisCut
                ? "The agent changed this cut."
                : "The agent changed this episode."
              : changedThisCut
                ? "This cut changed in another tab."
                : "This episode changed in another tab."}
          </span>
          <button type="button" className="btn btn-chip" onClick={reloadChanged}>
            Reload it
          </button>
          <button type="button" className="btn btn-chip" onClick={sync.dismiss}>
            Keep editing
          </button>
        </div>
      )}
      <div className="episode-edit-body" data-sequence-open={sequenceOpen}>
        <nav
          className="episode-sequence-rail"
          aria-label="Cuts and transitions"
          hidden={!sequenceOpen}
        >
          <div className="rail-tools" role="toolbar" aria-label="Cut tools">
            <button
              type="button"
              className="btn btn-chip"
              onClick={addCut}
              disabled={cutBusy}
              title="Add a cut after the selected one"
              data-testid="add-cut"
            >
              <StudioIcon name="plus" /> Cut
            </button>
            <button
              type="button"
              className="btn btn-chip btn-icon-only"
              aria-label="Move cut up"
              title="Move up"
              disabled={cutBusy || !canUp}
              onClick={() =>
                selectedCutId &&
                moveCut(selectedCutId, stepTarget(rhythm.sequence, selectedCutId, "up"))
              }
              data-testid="move-cut-up"
            >
              <StudioIcon name="arrow" rotate={-90} />
            </button>
            <button
              type="button"
              className="btn btn-chip btn-icon-only"
              aria-label="Move cut down"
              title="Move down"
              disabled={cutBusy || !canDown}
              onClick={() =>
                selectedCutId &&
                moveCut(selectedCutId, stepTarget(rhythm.sequence, selectedCutId, "down"))
              }
              data-testid="move-cut-down"
            >
              <StudioIcon name="arrow" rotate={90} />
            </button>
            <button
              type="button"
              className="btn btn-chip btn-icon-only btn-danger"
              aria-label="Remove cut"
              title="Remove cut"
              disabled={cutBusy || selectedCutId === null || cutCount <= 1}
              onClick={() => selectedCutId && setRemoving(selectedCutId)}
              data-testid="remove-cut"
            >
              <StudioIcon name="trash" />
            </button>
          </div>
          <ol className="rail-list" onDragLeave={() => setDropIndex(null)}>
            {rhythm.sequence.map((item, index) => {
              const data = item.type === "cut" ? cuts.find((c) => c.cutId === item.id) : undefined;
              const transition =
                item.type === "transition"
                  ? rhythm.transitions.find((t) => t.id === item.id)
                  : undefined;
              const number = item.type === "cut" ? cutNumberIn(rhythm.sequence, item.id) : 0;
              const cutIndex = number - 1;
              const current = selection?.type === item.type && selection.id === item.id;
              return (
                <li
                  key={`${item.type}:${item.id}`}
                  className={
                    item.type === "cut" && dragging && dropIndex !== null
                      ? dropIndex === cutIndex
                        ? "drop-before"
                        : dropIndex === cutIndex + 1 && cutIndex === cutCount - 1
                          ? "drop-after"
                          : undefined
                      : undefined
                  }
                >
                  {item.type === "cut" && rhythm.sequence[index - 1]?.type === "cut" && (
                    <button
                      type="button"
                      className="episode-insert"
                      onClick={() => insert(index)}
                      aria-label={`Add a transition before cut ${number}`}
                    >
                      <StudioIcon name="plus" /> Transition
                    </button>
                  )}
                  <button
                    type="button"
                    className={`episode-sequence-item is-${item.type}`}
                    aria-current={current ? "true" : undefined}
                    draggable={item.type === "cut" && !cutBusy}
                    onDragStart={(event) => {
                      if (item.type !== "cut") return;
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", `Cut ${number}`);
                      setDragging(item.id);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setDropIndex(null);
                    }}
                    onDragOver={(event) => item.type === "cut" && onRailDragOver(event, cutIndex)}
                    onDrop={onRailDrop}
                    onKeyDown={(event) => {
                      if (item.type !== "cut" || !event.altKey) return;
                      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                        event.preventDefault();
                        moveCut(
                          item.id,
                          stepTarget(
                            rhythm.sequence,
                            item.id,
                            event.key === "ArrowUp" ? "up" : "down",
                          ),
                        );
                      }
                    }}
                    onClick={() => {
                      if (!current) request(() => choose(item), item.type === "transition");
                      else if (compact) setSequencePreference(false);
                    }}
                    title={item.type === "cut" ? "Drag, or Alt+Arrow keys, to reorder" : undefined}
                    data-testid={`select-${item.type}-${item.id}`}
                  >
                    {item.type === "cut" ? (
                      <>
                        <span className="rail-thumb">
                          {data?.hasArtwork && data.art.src ? (
                            // biome-ignore lint/performance/noImgElement: local cut thumbnail.
                            <img src={data.art.src} alt="" loading="lazy" />
                          ) : (
                            <span className="rail-thumb-empty" aria-hidden="true">
                              <StudioIcon name="image" />
                            </span>
                          )}
                        </span>
                        <span className="rail-label">
                          Cut {number}
                          {data?.reviewStatus === "final" && (
                            <span className="rail-final" title="Marked final">
                              <StudioIcon name="check" />
                              <span className="sr-only">final</span>
                            </span>
                          )}
                        </span>
                      </>
                    ) : (
                      <span className="rail-label rail-transition">
                        {transitionLabel(transition?.type ?? "gutter")}
                        <small>{transition?.gutterHeight ?? 0} px</small>
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
          {rhythm.sequence.length === 0 && <p className="empty-note">No cuts yet.</p>}
        </nav>
        <div className="episode-active-editor">
          {selectedCut && cutStart ? (
            <CutEditor
              {...selectedCut}
              initialBubbles={cutStart.bubbles}
              initialLetteringRevision={cutStart.revision}
              cutNumber={cutNumberIn(rhythm.sequence, selectedCut.cutId) || selectedCut.cutNumber}
              key={cutKey}
              registerNavigation={registerNavigation}
              lastSpeaker={lastSpeaker}
              onSpeakerUsed={setLastSpeaker}
              onSelectionChange={setBubbleIds}
              onProjectChanged={() => router.refresh()}
              onSaved={(bubbles, savedRevisionValue) =>
                setSavedCuts((prev) => ({
                  ...prev,
                  [selectedCut.cutId]: rememberSave(
                    prev[selectedCut.cutId],
                    selectedCut.initialLetteringRevision,
                    bubbles,
                    savedRevisionValue,
                  ),
                }))
              }
            />
          ) : selection?.type === "cut" ? (
            <div className="episode-editor-empty" aria-busy="true">
              <p className="empty-note">Opening the cut…</p>
            </div>
          ) : (
            <section
              className="episode-transition-editor"
              aria-label="Transition editor"
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.defaultPrevented) return;
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                  event.preventDefault();
                  void save();
                  return;
                }
                if (keyboardOwnedByField(event.nativeEvent)) return;
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
                  event.preventDefault();
                  travel(event.shiftKey ? "redo" : "undo");
                }
              }}
            >
              <header className="cut-head">
                <div className="cut-head-title">
                  <h2>
                    {selectedTransition ? transitionLabel(selectedTransition.type) : "Transitions"}
                  </h2>
                  <span className="page-meta">Between two cuts</span>
                </div>
                <div className="editor-actions">
                  <SaveState
                    dirty={dirty}
                    saving={saving}
                    onSave={() => void save()}
                    testId="save-transitions"
                  />
                  <button
                    className="btn btn-icon"
                    type="button"
                    aria-label="Undo"
                    title="Undo"
                    onClick={() => travel("undo")}
                    disabled={!history.canUndo}
                  >
                    <StudioIcon name="undo" />
                  </button>
                  <button
                    className="btn btn-icon"
                    type="button"
                    aria-label="Redo"
                    title="Redo"
                    onClick={() => travel("redo")}
                    disabled={!history.canRedo}
                  >
                    <StudioIcon name="redo" />
                  </button>
                </div>
              </header>
              {notice && (
                <p
                  className={`episode-notice${notice.error ? " is-error" : ""}`}
                  role={notice.error ? "alert" : "status"}
                >
                  {notice.text}
                  {notice.error && isConflictMessage(notice.text) && (
                    <button type="button" className="btn btn-chip" onClick={reloadEpisode}>
                      Reload the episode
                    </button>
                  )}
                </p>
              )}
              {selectedTransition ? (
                <div className="episode-transition-body">
                  <div className="episode-transition-stage">
                    <div className="transition-context">
                      {(() => {
                        const near = neighbors(selectedTransition.id);
                        return (
                          <>
                            <div className="transition-neighbor is-before" aria-hidden="true">
                              {near.before && (
                                // biome-ignore lint/performance/noImgElement: local cut thumbnail.
                                <img src={near.before} alt="" />
                              )}
                            </div>
                            <div className="episode-band-preview">
                              <TransitionBlock
                                transition={selectedTransition}
                                referenceWidth={referenceWidth}
                                readOnly
                              />
                            </div>
                            <div className="transition-neighbor is-after" aria-hidden="true">
                              {near.after && (
                                // biome-ignore lint/performance/noImgElement: local cut thumbnail.
                                <img src={near.after} alt="" />
                              )}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                    <small>The band between the two cuts, at reading width.</small>
                  </div>
                  <aside className="episode-transition-properties">
                    <TransitionInspector
                      transition={selectedTransition}
                      onChange={update}
                      onDelete={remove}
                    />
                  </aside>
                </div>
              ) : (
                <div className="episode-editor-empty">
                  <h2>
                    {rhythm.sequence.length
                      ? "Choose a cut or transition"
                      : "This episode has no cuts"}
                  </h2>
                  <p className="empty-note">
                    {rhythm.sequence.length
                      ? "Pick one from the list on the left."
                      : "Add a cut, or ask the agent to write this episode."}
                  </p>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
      <dialog
        ref={dialog}
        className="episode-leave-dialog"
        onCancel={(event) => {
          if (saving) event.preventDefault();
          else setPending(null);
        }}
        aria-labelledby="episode-leave-title"
      >
        <h2 id="episode-leave-title">Save your transition changes?</h2>
        <p>Save them before continuing, or discard them.</p>
        {notice?.error && <p role="alert">{notice.text}</p>}
        <div className="editor-actions">
          <button className="btn" type="button" disabled={saving} onClick={() => setPending(null)}>
            Keep editing
          </button>
          <button
            className="btn btn-danger"
            type="button"
            disabled={saving}
            onClick={() => {
              discard();
              const next = pending;
              setPending(null);
              next?.();
            }}
          >
            Discard and continue
          </button>
          <button
            className="btn btn-primary"
            type="button"
            disabled={saving}
            onClick={async () => {
              if (await save()) {
                const next = pending;
                setPending(null);
                next?.();
              }
            }}
          >
            {saving ? "Saving…" : "Save and continue"}
          </button>
        </div>
      </dialog>
      <ConfirmDialog
        open={removing !== null}
        title={`Remove Cut ${removing ? cutNumberIn(rhythm.sequence, removing) : ""}?`}
        confirmLabel="Remove cut"
        danger
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      >
        <p>{removalNote(rhythm, removing)}</p>
      </ConfirmDialog>
      {toast.element}
    </section>
  );
}
