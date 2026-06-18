"use client";

// Cut craft + character + lint panel for the focused cut editor (issue #102).
//
// This is the editor-only control surface for the CUT-LEVEL v3 craft fields that
// the bubble inspector does not own:
//   - Cut craft metadata (#98): `shotType` preset, dominant `palette` color, and
//     free-form `layer` / `styleTag`. Saved through `/api/cut` (the same path-safe
//     route the cut prompts use), which writes only this episode's `cuts.yaml`.
//   - Character registry (#92): manage `webtoon.characters` (id/name/lockstring
//     with a small preview) and assign characters to THIS cut (`cut.characters`).
//     Saved through `/api/characters`, which writes `webtoon.json` (+ this cut's
//     `cuts.yaml` for the assignment) path-safely.
//   - Craft lint (#94/#100): the findings list for this episode (craft/*,
//     character/*, overflow). Run server-side via `@toony/lint` and refreshed
//     after a save so an unknown-ref / density / overflow warning appears inline.
//
// It lives in its own module so the editor route can lazy-load it (and its
// ColorPicker dependency) as an editor-only chunk, keeping the reader/library
// bundles lean. Nothing here re-derives render or lint logic: it edits the schema
// fields and shows `@toony/lint`'s own findings verbatim.

import type { Finding } from "@toony/lint";
import { type Character, type Cut, SHOT_TYPES, type ShotType } from "@toony/schema";
import { useCallback, useState } from "react";
import { ColorPicker } from "./color-picker";
import type { CutCraftFields } from "./cut-editor";

export interface CutCraftPanelProps {
  workId: string;
  episodeId: string;
  cutId: string;
  initialCraft: CutCraftFields;
  initialCharacters: Character[];
  initialFindings: Finding[];
}

type Saving = "idle" | "saving";
type Msg = { kind: "ok" | "error"; text: string } | null;

/** Severity → chip class, mirroring the editor's status-chip palette. */
function severityChipClass(severity: Finding["severity"]): string {
  if (severity === "error") return "chip chip-danger";
  if (severity === "warning") return "chip chip-warn";
  return "chip";
}

export function CutCraftPanel({
  workId,
  episodeId,
  cutId,
  initialCraft,
  initialCharacters,
  initialFindings,
}: CutCraftPanelProps) {
  // --- Cut craft metadata (#98) -------------------------------------------
  const [shotType, setShotType] = useState<Cut["shotType"]>(initialCraft.shotType);
  const [palette, setPalette] = useState<Cut["palette"]>(initialCraft.palette);
  const [layer, setLayer] = useState<string>(initialCraft.layer ?? "");
  const [styleTag, setStyleTag] = useState<string>(initialCraft.styleTag ?? "");
  const [craftDirty, setCraftDirty] = useState(false);
  const [craftSaving, setCraftSaving] = useState<Saving>("idle");
  const [craftMsg, setCraftMsg] = useState<Msg>(null);

  // --- Character registry (#92) -------------------------------------------
  const [characters, setCharacters] = useState<Character[]>(initialCharacters);
  const [assigned, setAssigned] = useState<string[]>(initialCraft.characters);
  const [charDirty, setCharDirty] = useState(false);
  const [charSaving, setCharSaving] = useState<Saving>("idle");
  const [charMsg, setCharMsg] = useState<Msg>(null);
  // Draft for a NEW character row.
  const [draftId, setDraftId] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftLock, setDraftLock] = useState("");

  // --- Lint findings (#94) -------------------------------------------------
  const [findings, setFindings] = useState<Finding[]>(initialFindings);
  const [lintLoading, setLintLoading] = useState(false);

  const refreshLint = useCallback(async () => {
    setLintLoading(true);
    try {
      const response = await fetch("/api/lint", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workId, episodeId }),
      });
      const data = (await response.json()) as { ok: boolean; findings?: Finding[] };
      if (response.ok && data.ok && Array.isArray(data.findings)) {
        setFindings(data.findings);
      }
    } catch {
      // A failed refresh leaves the last findings shown; not fatal to editing.
    } finally {
      setLintLoading(false);
    }
  }, [workId, episodeId]);

  const saveCraft = useCallback(async () => {
    setCraftSaving("saving");
    setCraftMsg(null);
    try {
      const response = await fetch("/api/cut", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Omit imagePrompt/negativePrompt: the route preserves them when absent,
        // so saving craft never clobbers the prompts the prompt panel owns.
        body: JSON.stringify({
          workId,
          episodeId,
          cutId,
          shotType: shotType ?? null,
          palette: palette ?? null,
          layer: layer.length > 0 ? layer : null,
          styleTag: styleTag.length > 0 ? styleTag : null,
        }),
      });
      const data = (await response.json()) as { ok: boolean; error?: string };
      if (!response.ok || !data.ok) {
        setCraftMsg({ kind: "error", text: data.error ?? "Save failed." });
      } else {
        setCraftDirty(false);
        setCraftMsg({ kind: "ok", text: "Saved to cuts.yaml." });
        void refreshLint();
      }
    } catch (cause) {
      setCraftMsg({ kind: "error", text: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setCraftSaving("idle");
    }
  }, [workId, episodeId, cutId, shotType, palette, layer, styleTag, refreshLint]);

  const saveCharacters = useCallback(async () => {
    setCharSaving("saving");
    setCharMsg(null);
    try {
      const response = await fetch("/api/characters", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workId,
          characters,
          assignment: { episodeId, cutId, characters: assigned },
        }),
      });
      const data = (await response.json()) as { ok: boolean; error?: string };
      if (!response.ok || !data.ok) {
        setCharMsg({ kind: "error", text: data.error ?? "Save failed." });
      } else {
        setCharDirty(false);
        setCharMsg({ kind: "ok", text: "Saved to webtoon.json." });
        void refreshLint();
      }
    } catch (cause) {
      setCharMsg({ kind: "error", text: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setCharSaving("idle");
    }
  }, [workId, episodeId, cutId, characters, assigned, refreshLint]);

  const addCharacter = useCallback(() => {
    const id = draftId.trim();
    const name = draftName.trim();
    const lockstring = draftLock.trim();
    if (id.length === 0 || name.length === 0 || lockstring.length === 0) {
      setCharMsg({ kind: "error", text: "id, name, and lockstring are all required." });
      return;
    }
    if (characters.some((c) => c.id === id)) {
      setCharMsg({ kind: "error", text: `a character with id "${id}" already exists.` });
      return;
    }
    setCharacters((prev) => [...prev, { id, name, lockstring }]);
    setDraftId("");
    setDraftName("");
    setDraftLock("");
    setCharDirty(true);
    setCharMsg(null);
  }, [draftId, draftName, draftLock, characters]);

  const updateCharacter = useCallback((index: number, patch: Partial<Character>) => {
    setCharacters((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
    setCharDirty(true);
    setCharMsg(null);
  }, []);

  const removeCharacter = useCallback((id: string) => {
    setCharacters((prev) => prev.filter((c) => c.id !== id));
    // Keep the assignment as-is: removing a registry character should surface a
    // character/unknown-ref lint, not silently drop the ref.
    setCharDirty(true);
    setCharMsg(null);
  }, []);

  const toggleAssigned = useCallback((id: string) => {
    setAssigned((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setCharDirty(true);
    setCharMsg(null);
  }, []);

  return (
    <div className="inspector-form" data-testid="cut-craft-panel">
      <h2 className="card-title">Cut craft</h2>

      {/* --- Cut craft metadata (#98) ------------------------------------- */}
      {craftMsg && (
        <div
          className={
            craftMsg.kind === "ok"
              ? "editor-toast editor-toast-ok"
              : "editor-toast editor-toast-error"
          }
          role="status"
          data-testid="craft-message"
        >
          {craftMsg.text}
        </div>
      )}

      <label className="field">
        <span>Shot type</span>
        <select
          value={shotType ?? ""}
          onChange={(e) => {
            const value = e.target.value;
            setShotType(value === "" ? undefined : (value as ShotType));
            setCraftDirty(true);
            setCraftMsg(null);
          }}
          data-testid="field-shot-type"
        >
          <option value="">— none —</option>
          {SHOT_TYPES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>

      <div className="field">
        <span>Palette (dominant color)</span>
        <div className="field-inline">
          <ColorPicker
            label="Dominant"
            value={palette ?? "#888888"}
            onChange={(hex) => {
              setPalette(hex);
              setCraftDirty(true);
              setCraftMsg(null);
            }}
            testId="field-palette"
          />
          {palette !== undefined && (
            <button
              type="button"
              className="btn btn-chip"
              onClick={() => {
                setPalette(undefined);
                setCraftDirty(true);
                setCraftMsg(null);
              }}
              data-testid="field-palette-clear"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <label className="field">
        <span>Layer</span>
        <input
          type="text"
          value={layer}
          placeholder="e.g. reality, metaphor"
          onChange={(e) => {
            setLayer(e.target.value);
            setCraftDirty(true);
            setCraftMsg(null);
          }}
          data-testid="field-layer"
        />
      </label>

      <label className="field">
        <span>Style tag</span>
        <input
          type="text"
          value={styleTag}
          placeholder="free-form visual style tag"
          onChange={(e) => {
            setStyleTag(e.target.value);
            setCraftDirty(true);
            setCraftMsg(null);
          }}
          data-testid="field-style-tag"
        />
      </label>

      <button
        type="button"
        className="btn btn-primary"
        onClick={saveCraft}
        disabled={craftSaving === "saving" || !craftDirty}
        data-testid="craft-save"
      >
        {craftSaving === "saving" ? "Saving…" : craftDirty ? "Save cut craft" : "Saved"}
      </button>

      {/* --- Character registry (#92) ------------------------------------- */}
      <fieldset className="field-group" data-testid="group-characters">
        <legend>Characters</legend>
        <p className="field-hint">
          Define reusable characters once; their lockstring is injected into every cut they appear
          in so they stay on-model. Assign the ones present in this cut below.
        </p>

        {charMsg && (
          <div
            className={
              charMsg.kind === "ok"
                ? "editor-toast editor-toast-ok"
                : "editor-toast editor-toast-error"
            }
            role="status"
            data-testid="character-message"
          >
            {charMsg.text}
          </div>
        )}

        {characters.length === 0 ? (
          <p className="empty" data-testid="character-empty">
            No characters defined yet.
          </p>
        ) : (
          <ul className="character-list" data-testid="character-list">
            {characters.map((character, index) => {
              const isAssigned = assigned.includes(character.id);
              return (
                <li
                  key={character.id}
                  className="character-row"
                  data-testid={`character-${character.id}`}
                >
                  <label className="field field-inline character-assign">
                    <input
                      type="checkbox"
                      checked={isAssigned}
                      onChange={() => toggleAssigned(character.id)}
                      data-testid={`assign-${character.id}`}
                    />
                    <span>In this cut</span>
                  </label>
                  <label className="field">
                    <span>Name</span>
                    <input
                      type="text"
                      value={character.name}
                      onChange={(e) => updateCharacter(index, { name: e.target.value })}
                      data-testid={`character-name-${character.id}`}
                    />
                  </label>
                  <label className="field">
                    <span>Lockstring</span>
                    <textarea
                      rows={2}
                      value={character.lockstring}
                      onChange={(e) => updateCharacter(index, { lockstring: e.target.value })}
                      data-testid={`character-lock-${character.id}`}
                    />
                  </label>
                  <div
                    className="character-preview"
                    data-testid={`character-preview-${character.id}`}
                  >
                    <span className="character-id">{character.id}</span>
                    <span className="character-lock-preview">{character.lockstring}</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-chip btn-danger"
                    onClick={() => removeCharacter(character.id)}
                    data-testid={`character-remove-${character.id}`}
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="character-new" data-testid="character-new">
          <span className="color-section-title">Add character</span>
          <label className="field">
            <span>id</span>
            <input
              type="text"
              value={draftId}
              placeholder="e.g. rin"
              onChange={(e) => setDraftId(e.target.value)}
              data-testid="character-new-id"
            />
          </label>
          <label className="field">
            <span>name</span>
            <input
              type="text"
              value={draftName}
              placeholder="e.g. Rin"
              onChange={(e) => setDraftName(e.target.value)}
              data-testid="character-new-name"
            />
          </label>
          <label className="field">
            <span>lockstring</span>
            <textarea
              rows={2}
              value={draftLock}
              placeholder="locked palette + 2-3 invariant shape cues + style"
              onChange={(e) => setDraftLock(e.target.value)}
              data-testid="character-new-lock"
            />
          </label>
          <button type="button" className="btn" onClick={addCharacter} data-testid="character-add">
            + Add character
          </button>
        </div>

        <button
          type="button"
          className="btn btn-primary"
          onClick={saveCharacters}
          disabled={charSaving === "saving" || !charDirty}
          data-testid="character-save"
        >
          {charSaving === "saving" ? "Saving…" : charDirty ? "Save characters" : "Saved"}
        </button>
      </fieldset>

      {/* --- Craft lint (#94) -------------------------------------------- */}
      <fieldset className="field-group" data-testid="craft-lint-panel">
        <legend>
          Lint{" "}
          {findings.length > 0 && (
            <span className="chip chip-warn" data-testid="lint-count">
              {findings.length}
            </span>
          )}
        </legend>
        <div className="field-inline">
          <button
            type="button"
            className="btn btn-chip"
            onClick={refreshLint}
            disabled={lintLoading}
            data-testid="lint-refresh"
          >
            {lintLoading ? "Checking…" : "Re-check"}
          </button>
          <span className="field-hint">
            Craft, character, and overflow findings for this episode.
          </span>
        </div>
        {findings.length === 0 ? (
          <p className="empty" data-testid="lint-clean">
            No findings. This episode is clean.
          </p>
        ) : (
          <ul className="lint-list" data-testid="lint-list">
            {findings.map((f) => (
              <li
                key={`${f.code}-${f.targetId}-${f.message}`}
                className="lint-item"
                data-testid={`lint-${f.code}`}
                data-severity={f.severity}
              >
                <div className="lint-head">
                  <span className={severityChipClass(f.severity)}>{f.severity}</span>
                  <code className="lint-code">{f.code}</code>
                  <span className="lint-target">{f.targetId}</span>
                </div>
                <p className="lint-message">{f.message}</p>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
    </div>
  );
}
