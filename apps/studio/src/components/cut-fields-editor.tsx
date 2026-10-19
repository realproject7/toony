"use client";

// The cut's own fields, beside the bubble inspector (#332): prompt, negative
// prompt, the characters it names, shot type, palette and declared shape. Saves
// independently of lettering through `/api/cut-fields`, which validates and
// writes only cuts.yaml and marks the cut human-edited. The render record is
// shown, not edited: only a render may change what produced the art.

import { PANEL_ASPECT_MAX, PANEL_ASPECT_MIN, SHOT_TYPES, type ShotType } from "@toony/schema";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import type { CutFields } from "@/lib/cut-fields";
import { studioFetch } from "@/lib/studio-fetch";

export interface CutFieldsEditorProps {
  workId: string;
  episodeId: string;
  cutId: string;
  initial: CutFields;
  characters: ReadonlyArray<{ id: string; name: string }>;
  renderRecord: { imageSeed?: number; imageWorkflow?: string };
}

function sameFields(a: CutFields, b: CutFields): boolean {
  return (
    a.imagePrompt === b.imagePrompt &&
    a.negativePrompt === b.negativePrompt &&
    a.characters.join("\n") === b.characters.join("\n") &&
    a.shotType === b.shotType &&
    (a.palette ?? "") === (b.palette ?? "") &&
    a.panelAspect === b.panelAspect
  );
}

export function CutFieldsEditor({
  workId,
  episodeId,
  cutId,
  initial,
  characters,
  renderRecord,
}: CutFieldsEditorProps) {
  const router = useRouter();
  const [fields, setFields] = useState<CutFields>(initial);
  const [saved, setSaved] = useState<CutFields>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const dirty = !sameFields(fields, saved);

  const patch = useCallback((next: Partial<CutFields>) => {
    setFields((prev) => ({ ...prev, ...next }));
    setMessage(null);
  }, []);

  const toggleCharacter = useCallback(
    (id: string) => {
      const has = fields.characters.includes(id);
      patch({
        characters: has ? fields.characters.filter((c) => c !== id) : [...fields.characters, id],
      });
    },
    [fields.characters, patch],
  );

  const save = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    const payload = fields;
    try {
      const response = await studioFetch("/api/cut-fields", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workId, episodeId, cutId, fields: payload }),
      });
      const data = (await response.json()) as { ok: boolean; error?: string; changed?: string[] };
      if (!response.ok || !data.ok) {
        setMessage({ kind: "error", text: data.error ?? "Could not save the cut." });
      } else {
        setSaved(payload);
        setMessage({
          kind: "ok",
          text:
            (data.changed?.length ?? 0) === 0
              ? "Nothing changed."
              : `Saved ${data.changed?.join(", ")} to cuts.yaml. The cut is marked human-edited.`,
        });
        router.refresh();
      }
    } catch (cause) {
      setMessage({ kind: "error", text: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setSaving(false);
    }
  }, [fields, workId, episodeId, cutId, router]);

  // Registry characters the cut names that are not in the registry stay
  // listed, so a person can see and clear a stale reference.
  const unknown = fields.characters.filter((id) => !characters.some((c) => c.id === id));

  return (
    <details className="cut-fields inspector-form" data-testid="cut-fields-editor">
      <summary className="cut-fields-summary">
        <span className="card-title">Cut</span>
        <span className="cut-fields-preview">
          {fields.imagePrompt.trim() === "" ? "no prompt yet" : fields.imagePrompt}
        </span>
        {dirty && <span className="chip chip-warn">unsaved</span>}
      </summary>

      <label className="field">
        <span>Prompt</span>
        <textarea
          rows={4}
          value={fields.imagePrompt}
          onChange={(e) => patch({ imagePrompt: e.target.value })}
          data-testid="cut-field-prompt"
        />
        <span className="field-hint">
          The cut's own scene text. Lockstrings, the story bible and the palette clause compose on
          top of it at generation.
        </span>
      </label>

      <label className="field">
        <span>Negative prompt</span>
        <textarea
          rows={2}
          value={fields.negativePrompt}
          onChange={(e) => patch({ negativePrompt: e.target.value })}
          data-testid="cut-field-negative"
        />
      </label>

      <fieldset className="field-group">
        <legend>Characters in this cut</legend>
        {characters.length === 0 && (
          <p className="field-hint">No characters in the registry yet. Add them in webtoon.json.</p>
        )}
        <div className="chip-row">
          {characters.map((character) => (
            <label className="field-inline cut-fields-character" key={character.id}>
              <input
                type="checkbox"
                checked={fields.characters.includes(character.id)}
                onChange={() => toggleCharacter(character.id)}
                data-testid={`cut-field-character-${character.id}`}
              />
              <span>{character.name}</span>
            </label>
          ))}
          {unknown.map((id) => (
            <label className="field-inline cut-fields-character" key={id}>
              <input type="checkbox" checked onChange={() => toggleCharacter(id)} />
              <span>
                {id} <span className="chip chip-warn">not in registry</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="field-row">
        <label className="field">
          <span>Shot type</span>
          <select
            value={fields.shotType ?? ""}
            onChange={(e) =>
              patch({ shotType: e.target.value === "" ? null : (e.target.value as ShotType) })
            }
            data-testid="cut-field-shot"
          >
            <option value="">Not set</option>
            {SHOT_TYPES.map((shot) => (
              <option key={shot} value={shot}>
                {shot}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Panel shape</span>
          <input
            type="number"
            step="0.01"
            min={PANEL_ASPECT_MIN}
            max={PANEL_ASPECT_MAX}
            value={fields.panelAspect ?? ""}
            placeholder="workflow default"
            onChange={(e) =>
              patch({ panelAspect: e.target.value === "" ? null : Number(e.target.value) })
            }
            data-testid="cut-field-aspect"
          />
          <span className="field-hint">Height as a multiple of the width.</span>
        </label>
      </div>

      <label className="field">
        <span>Palette</span>
        <span className="cut-fields-palette">
          <span
            className="script-swatch"
            style={{ background: fields.palette ?? "transparent" }}
            aria-hidden="true"
          />
          <input
            type="text"
            value={fields.palette ?? ""}
            placeholder="#hex or words, composed into the prompt"
            onChange={(e) => patch({ palette: e.target.value === "" ? null : e.target.value })}
            data-testid="cut-field-palette"
          />
        </span>
      </label>

      {(renderRecord.imageSeed !== undefined || renderRecord.imageWorkflow !== undefined) && (
        <p className="field-hint" data-testid="cut-field-record">
          Rendered with seed <code>{renderRecord.imageSeed ?? "unrecorded"}</code>
          {renderRecord.imageWorkflow ? (
            <>
              {" "}
              through workflow <code>{renderRecord.imageWorkflow}</code>
            </>
          ) : null}
          . A render changes this; this editor does not.
        </p>
      )}

      <div className="inspector-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={save}
          disabled={saving || !dirty}
          data-testid="cut-fields-save"
        >
          {saving ? "Saving…" : dirty ? "Save cut" : "Saved"}
        </button>
        {message && (
          <p
            className={
              message.kind === "ok"
                ? "editor-toast editor-toast-ok"
                : "editor-toast editor-toast-error"
            }
            role="status"
            data-testid="cut-fields-message"
          >
            {message.text}
          </p>
        )}
      </div>
    </details>
  );
}
