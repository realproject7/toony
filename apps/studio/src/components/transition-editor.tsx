"use client";

// Transition editor (issue #9) — editing transitions as first-class sequence
// objects, the interactive counterpart to the read-only transition block (#7).
//
// Transitions live in `episode.sequence` BETWEEN cuts. This editor renders the
// episode's reading sequence top-to-bottom; between any two adjacent cuts that
// have no transition it offers an insert point, and every existing transition is
// a selectable band whose rhythm is rendered through `@toony/render`'s
// `layoutTransition` — the SAME core the preview and export consume, so the
// gutter height/treatment shown here is exactly what renders. No markdown
// editing: the inspector edits the selected transition's type, gutter height,
// text, SFX, and notes, and marks it human-edited. Save POSTs the transitions +
// sequence to `/api/transitions`, which validates and writes `transitions.yaml`
// + `episode.yaml`; cancel returns to the preview without writing.

import { layoutTransition } from "@toony/render";
import {
  type Cut,
  GUTTER_HEIGHT_MAX_PX,
  GUTTER_HEIGHT_MIN_PX,
  REVIEW_STATUSES,
  type ReviewStatus,
  type SequenceItem,
  TRANSITION_TYPES,
  type Transition,
  type TransitionType,
} from "@toony/schema";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { clamp } from "@/lib/clamp";
import { ColorPicker } from "./color-picker";

/**
 * Transition kinds whose treatment reuses `Transition.color` as the band fill
 * (#98/#99). The color control is shown for these so a letterer can set the band
 * tint; for the others (plain gutter/fade/etc.) it has no visual effect, so it
 * stays hidden to keep the inspector focused.
 */
const COLOR_AWARE_TYPES = new Set<TransitionType>([
  "black_band",
  "title_card",
  "palette_shift",
  "desaturate_repeat",
  "scene-break",
  "beat",
]);

export interface TransitionEditorProps {
  workId: string;
  episodeId: string;
  episodeTitle: string;
  webtoonTitle: string;
  cuts: Cut[];
  initialTransitions: Transition[];
  initialSequence: SequenceItem[];
  /** Served asset URL for each transition's image (by transition id), or null. */
  imageUrls: Record<string, string | null>;
}

/** A freshly inserted transition with schema-valid defaults. */
function newTransition(index: number): Transition {
  return {
    id: `tr-${Date.now().toString(36)}-${index}`,
    type: "gutter",
    gutterHeight: 48,
    text: null,
    sfx: null,
    agentNote: null,
    humanNote: null,
    image: null,
    reviewStatus: "human-edited",
  };
}

/** A status chip class for a review status, mirroring the cut editor palette. */
function statusChipClass(status: ReviewStatus): string {
  if (status === "final") return "chip chip-ok";
  if (status === "human-edited") return "chip chip-accent";
  return "chip";
}

export function TransitionEditor({
  workId,
  episodeId,
  episodeTitle,
  webtoonTitle,
  cuts,
  initialTransitions,
  initialSequence,
  imageUrls,
}: TransitionEditorProps) {
  const [transitions, setTransitions] = useState<Transition[]>(initialTransitions);
  const [sequence, setSequence] = useState<SequenceItem[]>(initialSequence);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const transitionById = useMemo(
    () => new Map(transitions.map((tr) => [tr.id, tr])),
    [transitions],
  );
  const cutById = useMemo(() => new Map(cuts.map((cut) => [cut.id, cut])), [cuts]);
  const selected = selectedId ? (transitionById.get(selectedId) ?? null) : null;
  const transitionCount = sequence.filter((item) => item.type === "transition").length;

  const update = useCallback((id: string, patch: Partial<Transition>) => {
    setTransitions((prev) => prev.map((tr) => (tr.id === id ? { ...tr, ...patch } : tr)));
    setDirty(true);
    setMessage(null);
  }, []);

  // Insert a transition into the sequence at `sequenceIndex` (between the cut
  // before it and the cut at it), and create its record.
  const insertAt = useCallback((sequenceIndex: number) => {
    setSequence((prevSeq) => {
      const created = newTransition(prevSeq.length);
      setTransitions((prevTr) => [...prevTr, created]);
      setSelectedId(created.id);
      const next = [...prevSeq];
      next.splice(sequenceIndex, 0, { type: "transition", id: created.id });
      return next;
    });
    setDirty(true);
    setMessage(null);
  }, []);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    setSequence((prev) => prev.filter((item) => item.id !== selectedId));
    setTransitions((prev) => prev.filter((tr) => tr.id !== selectedId));
    setSelectedId(null);
    setDirty(true);
    setMessage(null);
  }, [selectedId]);

  const save = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/transitions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workId, episodeId, sequence, transitions }),
      });
      const data = (await response.json()) as { ok: boolean; error?: string };
      if (!response.ok || !data.ok) {
        setMessage({ kind: "error", text: data.error ?? "Save failed." });
      } else {
        setDirty(false);
        setMessage({ kind: "ok", text: "Saved to transitions.yaml + episode.yaml." });
      }
    } catch (cause) {
      setMessage({ kind: "error", text: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setSaving(false);
    }
  }, [workId, episodeId, sequence, transitions]);

  return (
    <div className="editor" data-testid="transition-editor">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">{webtoonTitle}</p>
          <h1 className="page-title">Edit transitions</h1>
          <div className="page-meta">
            <span>{episodeTitle}</span>
            <span>
              <b>{transitionCount}</b> transition{transitionCount === 1 ? "" : "s"}
            </span>
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
          <div className="seq-rhythm" data-testid="transition-sequence">
            {sequence.length === 0 && (
              <p className="empty">This episode has no sequence items yet.</p>
            )}
            {sequence.map((item, index) => {
              const key = `${index}-${item.type}-${item.id}`;
              if (item.type === "transition") {
                const transition = transitionById.get(item.id);
                if (!transition) {
                  return (
                    <div className="transition-block notice-danger" key={key}>
                      <span className="transition-type">Missing transition</span>
                      <span className="seq-id">{item.id}</span>
                    </div>
                  );
                }
                return (
                  <TransitionRow
                    key={key}
                    transition={transition}
                    selected={transition.id === selectedId}
                    onSelect={() => setSelectedId(transition.id)}
                  />
                );
              }
              const cut = cutById.get(item.id);
              const prev = sequence[index - 1];
              // Offer an insert point above a cut only when the slot above is
              // itself a cut (or the start) — a transition must sit BETWEEN two
              // cuts, never doubled or leading.
              const canInsertAbove = index > 0 && prev?.type === "cut";
              return (
                <div key={key} className="seq-cut-group">
                  {canInsertAbove && (
                    <button
                      type="button"
                      className="seq-insert"
                      onClick={() => insertAt(index)}
                      data-testid={`insert-transition-${index}`}
                    >
                      + Insert transition
                    </button>
                  )}
                  <div className="seq-cut-row" data-testid={`seq-cut-${item.id}`}>
                    <span className="chip chip-accent">Cut</span>
                    <span className="seq-id">{item.id}</span>
                    {!cut && <span className="chip chip-danger">missing record</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <aside className="editor-inspector" data-testid="editor-inspector">
          {selected ? (
            <TransitionInspector
              transition={selected}
              imageUrl={imageUrls[selected.id] ?? null}
              onChange={(patch) => update(selected.id, patch)}
              onMarkHumanEdited={() => update(selected.id, { reviewStatus: "human-edited" })}
              onDelete={deleteSelected}
            />
          ) : (
            <div className="inspector-empty">
              <h2 className="card-title">Inspector</h2>
              <p className="empty">
                Select a transition in the sequence, or insert one between two cuts, to edit its
                type, gutter height, text, SFX, and notes.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

/**
 * One transition row in the editor sequence: a real rhythm preview rendered
 * through `@toony/render`'s `layoutTransition`, occupying its actual gutter
 * height so the scroll rhythm is literal — the identical treatment the read-only
 * preview shows. Clicking selects it for editing.
 */
function TransitionRow({
  transition,
  selected,
  onSelect,
}: {
  transition: Transition;
  selected: boolean;
  onSelect: () => void;
}) {
  const plan = layoutTransition(transition);
  const reserved =
    plan.isCard || plan.treatment === "band" ? Math.max(plan.gutterHeight, 56) : plan.gutterHeight;
  // Same resolved band fill the read-only preview + export use (#98/#99), so the
  // editor row previews the actual band color.
  const background = plan.bandFill ?? plan.color;
  return (
    <button
      type="button"
      className={selected ? "transition-block transition-block-selected" : "transition-block"}
      data-testid={`transition-${transition.id}`}
      data-treatment={plan.treatment}
      data-selected={selected ? "true" : undefined}
      style={
        background ? { minHeight: `${reserved}px`, background } : { minHeight: `${reserved}px` }
      }
      onClick={onSelect}
    >
      <div className="transition-rule" aria-hidden="true" />
      <div className="transition-band">
        <span className="transition-type">{plan.label}</span>
        {plan.detail && (
          <span className={plan.isSfx ? "transition-sfx" : "transition-detail"}>{plan.detail}</span>
        )}
        <span className={statusChipClass(transition.reviewStatus)}>{transition.reviewStatus}</span>
      </div>
      <span className="transition-gutter">{plan.gutterHeight}px</span>
    </button>
  );
}

function TransitionInspector({
  transition,
  imageUrl,
  onChange,
  onMarkHumanEdited,
  onDelete,
}: {
  transition: Transition;
  imageUrl: string | null;
  onChange: (patch: Partial<Transition>) => void;
  onMarkHumanEdited: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="inspector-form" data-testid="transition-inspector">
      <div className="inspector-head">
        <h2 className="card-title">Transition</h2>
        <span className={statusChipClass(transition.reviewStatus)} data-testid="inspector-status">
          {transition.reviewStatus}
        </span>
      </div>

      <label className="field">
        <span>Type</span>
        <select
          value={transition.type}
          onChange={(e) => onChange({ type: e.target.value as TransitionType })}
          data-testid="field-type"
        >
          {TRANSITION_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>

      {COLOR_AWARE_TYPES.has(transition.type) && (
        <div className="field">
          <span>Band color</span>
          <div className="field-inline">
            <ColorPicker
              label="Fill"
              value={transition.color ?? "#101010"}
              onChange={(hex) => onChange({ color: hex })}
              testId="field-color"
            />
            {transition.color != null && (
              <button
                type="button"
                className="btn btn-chip"
                onClick={() => onChange({ color: null })}
                data-testid="field-color-clear"
              >
                Clear
              </button>
            )}
          </div>
          <span className="field-hint">
            Fills the transition band (e.g. black_band, palette_shift). The rhythm preview updates
            live.
          </span>
        </div>
      )}

      <label className="field">
        <span>Gutter height (px)</span>
        <input
          type="number"
          min={GUTTER_HEIGHT_MIN_PX}
          max={GUTTER_HEIGHT_MAX_PX}
          step={1}
          value={transition.gutterHeight}
          onChange={(e) =>
            onChange({
              // Keep an integer inside the schema's allowed range so the edit
              // always validates; the rhythm preview updates live.
              gutterHeight: clamp(
                Math.round(Number(e.target.value) || 0),
                GUTTER_HEIGHT_MIN_PX,
                GUTTER_HEIGHT_MAX_PX,
              ),
            })
          }
          data-testid="field-gutter"
        />
      </label>

      <label className="field">
        <span>Text</span>
        <textarea
          rows={2}
          value={transition.text ?? ""}
          onChange={(e) => onChange({ text: e.target.value.length > 0 ? e.target.value : null })}
          data-testid="field-text"
        />
      </label>

      <label className="field">
        <span>SFX</span>
        <input
          type="text"
          value={transition.sfx ?? ""}
          onChange={(e) => onChange({ sfx: e.target.value.length > 0 ? e.target.value : null })}
          data-testid="field-sfx"
        />
      </label>

      <label className="field">
        <span>Agent note</span>
        <textarea
          rows={2}
          value={transition.agentNote ?? ""}
          onChange={(e) =>
            onChange({ agentNote: e.target.value.length > 0 ? e.target.value : null })
          }
          data-testid="field-agent-note"
        />
      </label>

      <label className="field">
        <span>Human note</span>
        <textarea
          rows={2}
          value={transition.humanNote ?? ""}
          onChange={(e) =>
            onChange({ humanNote: e.target.value.length > 0 ? e.target.value : null })
          }
          data-testid="field-human-note"
        />
      </label>

      <label className="field">
        <span>Review status</span>
        <select
          value={transition.reviewStatus}
          onChange={(e) => onChange({ reviewStatus: e.target.value as ReviewStatus })}
          data-testid="field-review"
        >
          {REVIEW_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="field-group">
        <legend>Transition image</legend>
        {transition.image && imageUrl ? (
          <>
            {/* biome-ignore lint/performance/noImgElement: local-first studio serves project files directly, not via the Next image optimizer. */}
            <img
              className="transition-image-preview"
              src={imageUrl}
              alt={`Transition ${transition.id}`}
            />
            <span className="field-hint" data-testid="transition-image-path">
              {transition.image}
            </span>
          </>
        ) : (
          <span className="field-hint" data-testid="transition-image-empty">
            No image associated. Associate one through the provider import workflow:{" "}
            <code>
              toony import-image --episode &lt;ep&gt; --transition {transition.id} --from
              &lt;file&gt;
            </code>
            , which strips metadata and writes a project-relative path. Re-open this editor to see
            it.
          </span>
        )}
      </fieldset>

      <div className="inspector-actions">
        <button
          type="button"
          className="btn"
          onClick={onMarkHumanEdited}
          disabled={transition.reviewStatus === "human-edited"}
          data-testid="mark-human-edited"
        >
          Mark human-edited
        </button>
        <button
          type="button"
          className="btn btn-danger"
          onClick={onDelete}
          data-testid="delete-transition"
        >
          Delete transition
        </button>
      </div>
    </div>
  );
}
