"use client";

import type { LetteringOverlay, SequenceItem, Transition } from "@toony/schema";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { persistWithGuard } from "@/lib/editor-save";
import {
  type EpisodeRhythm,
  episodeSelection,
  readRhythmDraft,
  removeEpisodeTransition,
  transitionLabel,
} from "@/lib/episode-editing";
import { planTransitionInsert } from "@/lib/transition-insert";
import { CutEditor, type CutEditorProps } from "./cut-editor";
import { StudioIcon } from "./studio-icon";
import { TransitionBlock } from "./transition-block";
import { TransitionInspector } from "./transition-inspector";
import { keyboardOwnedByField, useEditHistory } from "./use-edit-history";

interface Props {
  workId: string;
  episodeId: string;
  title: string;
  cuts: CutEditorProps[];
  initialRhythm: EpisodeRhythm;
  initialRevision: string;
  initialItem?: string;
  imageUrls: Record<string, string | null>;
  referenceWidth: number;
}
type SavedCut = { base: string; revision: string; bubbles: LetteringOverlay[] };

export function EpisodeEditor({
  workId,
  episodeId,
  title,
  cuts,
  initialRhythm,
  initialRevision,
  initialItem,
  imageUrls,
  referenceWidth,
}: Props) {
  const router = useRouter();
  const href = `/w/${encodeURIComponent(workId)}/episodes/${encodeURIComponent(episodeId)}`;
  const [rhythm, setRhythm] = useState(initialRhythm);
  const [selection, setSelection] = useState(() =>
    episodeSelection(initialRhythm.sequence, initialItem),
  );
  const [sequenceOpen, setSequenceOpen] = useState(true);
  const [savedCuts, setSavedCuts] = useState<Record<string, SavedCut>>({});
  const history = useEditHistory(rhythm);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const transitionRoot = useRef<HTMLElement>(null);
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
  const selectedTransition =
    selection?.type === "transition"
      ? rhythm.transitions.find((t) => t.id === selection.id)
      : undefined;
  const selectedCut =
    selection?.type === "cut" ? cuts.find((c) => c.cutId === selection.id) : undefined;
  const cached = selectedCut && savedCuts[selectedCut.cutId];
  const cut =
    selectedCut &&
    cached &&
    [cached.base, cached.revision].includes(selectedCut.initialLetteringRevision)
      ? {
          ...selectedCut,
          initialBubbles: cached.bubbles,
          initialLetteringRevision: cached.revision,
        }
      : selectedCut;
  const itemKey = selection ? `${selection.type}:${selection.id}` : "";
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
        setNotice({ text: "Your unsaved transition draft was restored." });
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
      setNotice({ text: "Draft recovery is unavailable. Save before leaving.", error: true });
    }
  }, [rhythm, dirty, saving, draftKey]);
  useEffect(() => {
    if (pending) dialog.current?.showModal();
    else dialog.current?.close();
  }, [pending]);

  const choose = (item: SequenceItem | null) => {
    setSelection(item);
    const suffix = item ? `?item=${encodeURIComponent(`${item.type}:${item.id}`)}` : "";
    // Let the app router synchronize its canonical URL and search state.
    window.history.replaceState(null, "", href + suffix);
  };
  const request = (next: () => void, staysInTransitions = false) => {
    if (dirty && !staysInTransitions) setPending(() => next);
    else if (cutGuard.current) cutGuard.current(next);
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
    setDirty(true);
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
          fetch("/api/transitions", {
            method: "POST",
            headers: { "content-type": "application/json" },
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
        setNotice({ text: outcome.error, error: true });
        return false;
      }
      if (outcome.revision) revision.current = savedRevision.current = outcome.revision;
      saved.current = snapshot;
      if (outcome.clean) {
        setDirty(false);
        clearDraft();
      }
      setNotice({ text: "Episode transitions saved." });
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

  const cutCount = rhythm.sequence.filter((item) => item.type === "cut").length;

  return (
    <section className="episode-editor" aria-label="Episode editor" data-testid="episode-editor">
      <header className="episode-editor-head">
        <div className="episode-heading">
          <Link href={`/w/${encodeURIComponent(workId)}/episodes`}>Episodes</Link>
          <h1>{title}</h1>
          <span>
            {cutCount} {cutCount === 1 ? "cut" : "cuts"} · {rhythm.transitions.length}{" "}
            {rhythm.transitions.length === 1 ? "transition" : "transitions"}
          </span>
        </div>
        <div className="editor-actions">
          <button
            type="button"
            className="btn"
            aria-pressed={sequenceOpen}
            onClick={() => setSequenceOpen(!sequenceOpen)}
          >
            <StudioIcon name="sequence" /> Sequence
          </button>
          <Link
            className="btn btn-primary"
            href={`${href}/read?item=${encodeURIComponent(itemKey)}`}
            data-testid="episode-preview"
          >
            <StudioIcon name="eye" /> Preview
          </Link>
          <details className="episode-more">
            <summary
              className="btn btn-icon"
              aria-label="More episode actions"
              title="More episode actions"
            >
              <StudioIcon name="more" />
            </summary>
            <div>
              <Link href={`${href}/export`}>
                <StudioIcon name="export" />
                Export
              </Link>
              <Link href={`${href}/script`}>
                <StudioIcon name="text" />
                Script &amp; draft
              </Link>
            </div>
          </details>
        </div>
      </header>
      <div className="episode-edit-body" data-sequence-open={sequenceOpen}>
        <nav className="episode-sequence-rail" aria-label="Episode sequence" hidden={!sequenceOpen}>
          <h2>Sequence</h2>
          {rhythm.sequence.map((item, index) => {
            const data = item.type === "cut" ? cuts.find((c) => c.cutId === item.id) : undefined;
            const transition =
              item.type === "transition"
                ? rhythm.transitions.find((t) => t.id === item.id)
                : undefined;
            const number = rhythm.sequence
              .slice(0, index + 1)
              .filter((i) => i.type === "cut").length;
            return (
              <div key={`${item.type}:${item.id}`}>
                {item.type === "cut" && rhythm.sequence[index - 1]?.type === "cut" && (
                  <button
                    type="button"
                    className="episode-insert"
                    onClick={() => insert(index)}
                    aria-label={`Add transition before cut ${number}`}
                  >
                    + Transition
                  </button>
                )}
                <button
                  type="button"
                  className={`episode-sequence-item is-${item.type}`}
                  aria-current={
                    selection?.type === item.type && selection.id === item.id ? "true" : undefined
                  }
                  onClick={() => {
                    if (selection?.type !== item.type || selection.id !== item.id)
                      request(() => choose(item), item.type === "transition");
                  }}
                  data-testid={`select-${item.type}-${item.id}`}
                >
                  {data?.art.src && (
                    <>
                      {/* biome-ignore lint/performance/noImgElement: local cut thumbnail. */}
                      <img src={data.art.src} alt="" loading="lazy" />
                    </>
                  )}
                  <span>
                    {item.type === "cut"
                      ? `Cut ${String(number).padStart(2, "0")}`
                      : transitionLabel(transition?.type ?? "Transition")}
                  </span>
                  <small>
                    {item.type === "cut" ? item.id : `${transition?.gutterHeight ?? 0} px`}
                  </small>
                </button>
              </div>
            );
          })}
          {rhythm.sequence.length === 0 && (
            <p className="empty">No cuts yet. Start with your episode script.</p>
          )}
        </nav>
        <div className="episode-active-editor">
          {cut && selectedCut ? (
            <CutEditor
              {...cut}
              key={cut.cutId}
              integrated
              registerNavigation={registerNavigation}
              onSaved={(bubbles, revision) =>
                setSavedCuts((prev) => ({
                  ...prev,
                  [cut.cutId]: { base: selectedCut.initialLetteringRevision, bubbles, revision },
                }))
              }
            />
          ) : (
            <section
              className="episode-transition-editor"
              ref={transitionRoot}
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
              <header>
                <div>
                  <h2>
                    {selectedTransition
                      ? transitionLabel(selectedTransition.type)
                      : "Episode transitions"}
                  </h2>
                  <span>{dirty ? "Unsaved changes" : "Between the surrounding cuts"}</span>
                </div>
                <div className="editor-actions">
                  <button
                    className="btn"
                    type="button"
                    onClick={() => travel("undo")}
                    disabled={!history.canUndo}
                  >
                    <StudioIcon name="undo" /> Undo
                  </button>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => travel("redo")}
                    disabled={!history.canRedo}
                  >
                    <StudioIcon name="redo" /> Redo
                  </button>
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={() => void save()}
                    disabled={!dirty || saving}
                    data-testid="save-transitions"
                  >
                    {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
                  </button>
                </div>
              </header>
              {notice && (
                <p
                  className={`episode-notice${notice.error ? " is-error" : ""}`}
                  role={notice.error ? "alert" : "status"}
                >
                  {notice.text}
                </p>
              )}
              {selectedTransition ? (
                <div className="episode-transition-body">
                  <div className="episode-transition-stage">
                    <p>Transition preview</p>
                    <div className="episode-band-preview">
                      <TransitionBlock
                        transition={selectedTransition}
                        referenceWidth={referenceWidth}
                        readOnly
                      />
                    </div>
                    <small>
                      Height scales with the episode width. Preview shows it between the cuts.
                    </small>
                  </div>
                  <aside className="episode-transition-properties">
                    <TransitionInspector
                      transition={selectedTransition}
                      imageUrl={imageUrls[selectedTransition.id] ?? null}
                      onChange={update}
                      onMarkHumanEdited={() => update({ reviewStatus: "human-edited" })}
                      onDelete={remove}
                    />
                  </aside>
                </div>
              ) : (
                <div className="episode-editor-empty">
                  <h2>
                    {rhythm.sequence.length
                      ? "Choose a cut or transition"
                      : "Your episode starts here"}
                  </h2>
                  <p>Select an item from the sequence to edit it here.</p>
                  {!rhythm.sequence.length && (
                    <Link href={`${href}/script`} className="btn">
                      Open script
                    </Link>
                  )}
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
        <p>Save your changes before continuing, or discard this draft.</p>
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
    </section>
  );
}
