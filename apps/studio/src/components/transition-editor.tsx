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

import type { Cut } from "@toony/schema";
import {
  FADE_DIRECTIONS,
  FADE_TYPES,
  type FadeDirection,
  type FadeType,
  GUTTER_HEIGHT_MAX_PX,
  GUTTER_HEIGHT_MIN_PX,
  MOOD_COLOR_NAMES,
  MOOD_COLORS,
  PANEL_FOLD_SLICE_PX,
  REVIEW_STATUSES,
  type ReviewStatus,
  type SequenceItem,
  SPACING_PRESET_NAMES,
  SPACING_PRESETS,
  TEXT_ALIGNS,
  type TextAlign,
  TRANSITION_TYPES,
  type Transition,
  type TransitionType,
  VERTICAL_ALIGNS,
  type VerticalAlign,
} from "@toony/schema";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { clamp } from "@/lib/clamp";
import { ColorPicker } from "./color-picker";
import { TransitionBlock } from "./transition-block";

/**
 * Transition kinds whose treatment reuses `Transition.color` as the band fill
 * (#98/#99/#115). The color + mood-swatch controls are shown for these so a
 * letterer can set the panel tint; for the others (plain gutter/fade) it has no
 * visual effect, so it stays hidden to keep the inspector focused.
 */
const COLOR_AWARE_TYPES = new Set<TransitionType>([
  "black_band",
  "title_card",
  "palette_shift",
  "desaturate_repeat",
  "scene-break",
  "beat",
  // v4 interstitial fill panels (#115).
  "color_field",
  "void",
  "narration_card",
  "dialogue_card",
  "time_card",
]);

/**
 * The v4 text-panel kinds (#115) that honor the plan's resolved horizontal +
 * vertical text anchoring, so the editor exposes the H/V align controls only for
 * these (legacy cards keep their fixed centered layout and ignore them).
 */
const TEXT_PANEL_TYPES = new Set<TransitionType>(["narration_card", "dialogue_card", "time_card"]);

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
 * One transition row in the editor sequence: the REAL interstitial panel rendered
 * by the shared `TransitionBlock` (#118) — the identical panel the reader and
 * export produce, so editing is WYSIWYG. Wrapped in a selectable control with a
 * selection ring + review-status chip overlay. Clicking selects it for editing.
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
  return (
    <div
      className="transition-row-edit"
      data-selected={selected ? "true" : undefined}
      data-testid={`transition-row-${transition.id}`}
    >
      <TransitionBlock transition={transition} />
      {/* Transparent full-bleed hit target keeps the panel preview (a <div>) intact
          while giving the row real <button> semantics + keyboard support. */}
      <button
        type="button"
        className="transition-row-hit"
        onClick={onSelect}
        aria-label={`Select transition ${transition.id}`}
        aria-pressed={selected}
        data-testid={`transition-select-${transition.id}`}
      />
      <span className={`transition-row-status ${statusChipClass(transition.reviewStatus)}`}>
        {transition.reviewStatus}
      </span>
    </div>
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
          <div className="mood-swatches" data-testid="mood-swatches">
            {MOOD_COLOR_NAMES.map((name) => (
              <button
                key={name}
                type="button"
                className="mood-swatch"
                style={{ background: MOOD_COLORS[name] }}
                title={name}
                aria-label={`Mood color ${name}`}
                onClick={() => onChange({ color: MOOD_COLORS[name] })}
                data-testid={`mood-${name}`}
              />
            ))}
          </div>
          <span className="field-hint">
            Fills the panel (e.g. color_field, narration_card). Pick a mood swatch or a custom
            color. The panel preview updates live.
          </span>
        </div>
      )}

      <label className="field">
        <span>Panel height (px)</span>
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

      <div className="field">
        <span>Height presets (clock ladder)</span>
        <div className="preset-row" data-testid="spacing-presets">
          {SPACING_PRESET_NAMES.map((name) => (
            <button
              key={name}
              type="button"
              className="btn btn-chip"
              onClick={() => onChange({ gutterHeight: SPACING_PRESETS[name] })}
              data-testid={`spacing-${name}`}
            >
              {name} · {SPACING_PRESETS[name]}
            </button>
          ))}
        </div>
        {transition.gutterHeight > PANEL_FOLD_SLICE_PX && (
          <span className="field-hint field-warn" data-testid="slice-warning">
            Over {PANEL_FOLD_SLICE_PX}px — this panel will be sliced across the mobile fold and may
            not read as one beat.
          </span>
        )}
      </div>

      <label className="field">
        <span>Text</span>
        <textarea
          rows={2}
          value={transition.text ?? ""}
          onChange={(e) => onChange({ text: e.target.value.length > 0 ? e.target.value : null })}
          data-testid="field-text"
        />
      </label>

      {TEXT_PANEL_TYPES.has(transition.type) && (
        <div className="field-row">
          <label className="field">
            <span>Text align</span>
            <select
              value={transition.textAlign ?? "center"}
              onChange={(e) => onChange({ textAlign: e.target.value as TextAlign })}
              data-testid="field-text-align"
            >
              {TEXT_ALIGNS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Vertical align</span>
            <select
              value={transition.verticalAlign ?? "middle"}
              onChange={(e) => onChange({ verticalAlign: e.target.value as VerticalAlign })}
              data-testid="field-vertical-align"
            >
              {VERTICAL_ALIGNS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {COLOR_AWARE_TYPES.has(transition.type) && (
        <div className="field">
          <span>Gradient fill</span>
          {transition.gradient ? (
            <>
              <div className="field-row">
                <ColorPicker
                  label="From"
                  value={transition.gradient.from}
                  onChange={(hex) => {
                    const g = transition.gradient;
                    if (g) onChange({ gradient: { ...g, from: hex } });
                  }}
                  testId="field-gradient-from"
                />
                <ColorPicker
                  label="To"
                  value={transition.gradient.to}
                  onChange={(hex) => {
                    const g = transition.gradient;
                    if (g) onChange({ gradient: { ...g, to: hex } });
                  }}
                  testId="field-gradient-to"
                />
                <select
                  value={transition.gradient.direction}
                  onChange={(e) => {
                    const g = transition.gradient;
                    if (g)
                      onChange({ gradient: { ...g, direction: e.target.value as FadeDirection } });
                  }}
                  data-testid="field-gradient-direction"
                >
                  {FADE_DIRECTIONS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="btn btn-chip"
                onClick={() => onChange({ gradient: null })}
                data-testid="field-gradient-clear"
              >
                Clear gradient
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-chip"
              onClick={() =>
                onChange({
                  gradient: {
                    from: transition.color ?? "#1b2a3a",
                    to: "#0a0a0a",
                    direction: "top_bottom",
                  },
                })
              }
              data-testid="field-gradient-add"
            >
              + Add gradient
            </button>
          )}
          <span className="field-hint">
            A full-panel vertical gradient fill (overrides the solid color).
          </span>
        </div>
      )}

      <div className="field">
        <span>Fade</span>
        <div className="field-row">
          <select
            value={transition.fade?.type ?? ""}
            onChange={(e) => {
              const type = e.target.value;
              if (!type) {
                onChange({ fade: null });
                return;
              }
              const prev = transition.fade;
              onChange({
                fade: {
                  type: type as FadeType,
                  direction: prev?.direction ?? "top_bottom",
                  length: prev?.length ?? Math.max(1, Math.round(transition.gutterHeight * 0.4)),
                },
              });
            }}
            data-testid="field-fade-type"
          >
            <option value="">none</option>
            {FADE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {transition.fade && (
            <>
              <select
                value={transition.fade.direction}
                onChange={(e) => {
                  const fade = transition.fade;
                  if (!fade) return;
                  onChange({ fade: { ...fade, direction: e.target.value as FadeDirection } });
                }}
                data-testid="field-fade-direction"
              >
                {FADE_DIRECTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                max={GUTTER_HEIGHT_MAX_PX}
                step={1}
                value={transition.fade.length}
                onChange={(e) => {
                  const fade = transition.fade;
                  if (!fade) return;
                  onChange({
                    fade: {
                      ...fade,
                      length: clamp(
                        Math.round(Number(e.target.value) || 1),
                        1,
                        GUTTER_HEIGHT_MAX_PX,
                      ),
                    },
                  });
                }}
                data-testid="field-fade-length"
                aria-label="Fade length (px)"
              />
            </>
          )}
        </div>
        <span className="field-hint">Blends the panel into a color over the fade length (px).</span>
      </div>

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
