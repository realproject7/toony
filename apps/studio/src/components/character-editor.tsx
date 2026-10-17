"use client";

// The character registry editor (#328). Name and lockstring edit inline, a
// reference sheet is a path under `characters/<id>/` the person placed there
// and lists here, and each character shows the cuts that name it. One Save
// posts the whole registry to `/api/characters`. An id is made once from the
// name and never edited, because every cut and script line keys to it.

import type { Character } from "@toony/schema";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import type { CharacterUse } from "@/lib/characters";

export interface CharacterEditorRow {
  character: Character;
  uses: CharacterUse[];
  sheets: Array<{ path: string; present: boolean; src: string | null }>;
}

function slug(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base === "" ? "character" : base;
}

export function CharacterEditor({
  workId,
  initial,
}: {
  workId: string;
  initial: CharacterEditorRow[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<CharacterEditorRow[]>(initial);
  const [saved, setSaved] = useState<string>(JSON.stringify(initial.map((r) => r.character)));
  const [newName, setNewName] = useState("");
  const [sheetInputs, setSheetInputs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const dirty = useMemo(
    () => JSON.stringify(rows.map((r) => r.character)) !== saved,
    [rows, saved],
  );

  const patch = useCallback((id: string, change: Partial<Character>) => {
    setRows((prev) =>
      prev.map((row) =>
        row.character.id === id ? { ...row, character: { ...row.character, ...change } } : row,
      ),
    );
    setMessage(null);
  }, []);

  const addCharacter = useCallback(() => {
    const name = newName.trim();
    if (name === "") return;
    const existing = new Set(rows.map((r) => r.character.id));
    let id = slug(name);
    for (let n = 2; existing.has(id); n++) id = `${slug(name)}-${n}`;
    setRows((prev) => [...prev, { character: { id, name, lockstring: "" }, uses: [], sheets: [] }]);
    setNewName("");
    setMessage(null);
  }, [newName, rows]);

  const removeCharacter = useCallback((id: string) => {
    setRows((prev) => prev.filter((row) => row.character.id !== id));
    setMessage(null);
  }, []);

  const addSheet = useCallback(
    (id: string) => {
      const raw = (sheetInputs[id] ?? "").trim();
      if (raw === "") return;
      const path = raw.startsWith(`characters/${id}/`) ? raw : `characters/${id}/${raw}`;
      setRows((prev) =>
        prev.map((row) => {
          if (row.character.id !== id) return row;
          const references = [...(row.character.references ?? [])];
          if (references.includes(path)) return row;
          references.push(path);
          return {
            ...row,
            character: { ...row.character, references },
            sheets: [...row.sheets, { path, present: false, src: null }],
          };
        }),
      );
      setSheetInputs((prev) => ({ ...prev, [id]: "" }));
      setMessage(null);
    },
    [sheetInputs],
  );

  const removeSheet = useCallback((id: string, path: string) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.character.id !== id) return row;
        const references = (row.character.references ?? []).filter((r) => r !== path);
        const character = { ...row.character };
        if (references.length > 0) character.references = references;
        else delete character.references;
        return { ...row, character, sheets: row.sheets.filter((s) => s.path !== path) };
      }),
    );
    setMessage(null);
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    const characters = rows.map((r) => r.character);
    try {
      const response = await fetch("/api/characters", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workId, characters }),
      });
      const data = (await response.json()) as { ok: boolean; error?: string; changed?: boolean };
      if (!response.ok || !data.ok) {
        setMessage({ kind: "error", text: data.error ?? "Could not save the characters." });
      } else {
        setSaved(JSON.stringify(characters));
        setMessage({
          kind: "ok",
          text: data.changed ? "Saved to webtoon.json." : "Nothing changed.",
        });
        router.refresh();
      }
    } catch (cause) {
      setMessage({ kind: "error", text: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setSaving(false);
    }
  }, [rows, workId, router]);

  return (
    <div className="character-editor" data-testid="character-editor">
      <div className="editor-actions character-actions">
        <input
          type="text"
          className="new-work-input"
          placeholder="New character name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addCharacter();
          }}
          data-testid="character-new-name"
        />
        <button
          type="button"
          className="btn"
          onClick={addCharacter}
          disabled={newName.trim() === ""}
          data-testid="character-add"
        >
          + Add character
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={save}
          disabled={saving || !dirty}
          data-testid="character-save"
        >
          {saving ? "Saving…" : dirty ? "Save registry" : "Saved"}
        </button>
      </div>
      {message && (
        <p
          className={
            message.kind === "ok"
              ? "editor-toast editor-toast-ok"
              : "editor-toast editor-toast-error"
          }
          role="status"
          data-testid="character-message"
        >
          {message.text}
        </p>
      )}

      {rows.length === 0 && (
        <p className="empty" data-testid="character-empty">
          No characters yet. Add one above; its id becomes the key every cut uses and the folder its
          reference sheets live in.
        </p>
      )}

      <ul className="character-list">
        {rows.map((row) => {
          const { character } = row;
          return (
            <li
              className="card character-row"
              key={character.id}
              data-testid={`character-${character.id}`}
            >
              <div className="character-head">
                <code className="character-id">{character.id}</code>
                <span className="chip">
                  {row.uses.length} cut{row.uses.length === 1 ? "" : "s"}
                </span>
                <button
                  type="button"
                  className="btn btn-danger btn-chip"
                  onClick={() => removeCharacter(character.id)}
                  disabled={row.uses.length > 0}
                  title={
                    row.uses.length > 0
                      ? "Cuts still name this character; remove them from the cuts first."
                      : "Remove from the registry"
                  }
                  data-testid={`character-remove-${character.id}`}
                >
                  Remove
                </button>
              </div>
              <div className="character-fields">
                <label className="field">
                  <span>Name</span>
                  <input
                    type="text"
                    value={character.name}
                    onChange={(e) => patch(character.id, { name: e.target.value })}
                    data-testid={`character-name-${character.id}`}
                  />
                </label>
                <label className="field">
                  <span>Lockstring</span>
                  <textarea
                    rows={2}
                    value={character.lockstring}
                    onChange={(e) => patch(character.id, { lockstring: e.target.value })}
                    data-testid={`character-lockstring-${character.id}`}
                  />
                  <span className="field-hint">
                    The short invariant description prepended to every prompt that names this
                    character.
                  </span>
                </label>
              </div>

              <div className="character-sheets">
                <span className="field-label">Reference sheets</span>
                {row.sheets.length === 0 && (
                  <p className="field-hint">
                    None. Put an image under <code>characters/{character.id}/</code> and list it
                    here; a workflow that declares a reference input will condition on the first.
                  </p>
                )}
                <ul className="character-sheet-list">
                  {row.sheets.map((sheet) => (
                    <li className="character-sheet" key={sheet.path}>
                      {sheet.src ? (
                        // biome-ignore lint/performance/noImgElement: local file served by /api/asset, not a web image.
                        <img src={sheet.src} alt={`${character.name} reference`} loading="lazy" />
                      ) : (
                        <div className="character-sheet-missing">
                          {sheet.present ? "not an image" : "missing"}
                        </div>
                      )}
                      <code className="character-sheet-path">{sheet.path}</code>
                      <button
                        type="button"
                        className="btn btn-chip"
                        onClick={() => removeSheet(character.id, sheet.path)}
                        data-testid={`character-sheet-remove-${character.id}`}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="character-sheet-add">
                  <input
                    type="text"
                    placeholder={`file name under characters/${character.id}/`}
                    value={sheetInputs[character.id] ?? ""}
                    onChange={(e) =>
                      setSheetInputs((prev) => ({ ...prev, [character.id]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addSheet(character.id);
                    }}
                    data-testid={`character-sheet-input-${character.id}`}
                  />
                  <button
                    type="button"
                    className="btn btn-chip"
                    onClick={() => addSheet(character.id)}
                    data-testid={`character-sheet-add-${character.id}`}
                  >
                    + Add sheet
                  </button>
                </div>
              </div>

              {row.uses.length > 0 && (
                <div className="character-uses">
                  <span className="field-label">Named in</span>
                  {row.uses.map((use) => (
                    <Link
                      key={`${use.episodeId}-${use.cutId}`}
                      className="chip chip-accent"
                      href={`/w/${encodeURIComponent(workId)}/episodes/${encodeURIComponent(use.episodeId)}/cuts/${encodeURIComponent(use.cutId)}/edit`}
                    >
                      {use.episodeId} · {use.cutId}
                    </Link>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
