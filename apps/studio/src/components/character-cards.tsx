"use client";

// The cast as readable cards, edited in place one character at a time. Each
// save merges just that character into the cast (so another character changed
// meanwhile by the agent is never overwritten), and removing one asks first and
// offers Undo. Ids stay internal; a reference sheet shows as a thumbnail.

import type { Character, CharacterDevelopment, CharacterWardrobe } from "@toony/schema";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { studioFetch } from "@/lib/studio-fetch";
import { ActionMenu } from "./action-menu";
import { ConfirmDialog } from "./confirm-dialog";
import { StudioIcon } from "./studio-icon";
import { useUndoToast } from "./undo-toast";

export interface CastCard {
  character: Character;
  sheets: string[];
  appearances: Array<{ episode: string; cuts: Array<{ number: number; href: string }> }>;
}

const DEVELOPMENT_FIELDS: Array<{ key: keyof CharacterDevelopment; label: string; hint: string }> =
  [
    { key: "role", label: "Role", hint: "Their place in the story" },
    { key: "desire", label: "Wants", hint: "What they want most" },
    { key: "flaw", label: "Flaw", hint: "What gets in their way" },
    { key: "voice", label: "Voice", hint: "How they talk" },
    { key: "arc", label: "Arc", hint: "How they change" },
  ];

interface Draft {
  id?: string;
  name: string;
  lockstring: string;
  visualIdentity: string;
  development: Record<keyof CharacterDevelopment, string>;
  wardrobe: CharacterWardrobe[];
}

function draftOf(character?: Character): Draft {
  return {
    ...(character ? { id: character.id } : {}),
    name: character?.name ?? "",
    lockstring: character?.lockstring ?? "",
    visualIdentity: character?.visualIdentity ?? "",
    development: {
      role: character?.development?.role ?? "",
      desire: character?.development?.desire ?? "",
      flaw: character?.development?.flaw ?? "",
      voice: character?.development?.voice ?? "",
      arc: character?.development?.arc ?? "",
    },
    wardrobe: character?.wardrobe?.map((outfit) => ({ ...outfit })) ?? [],
  };
}

function outfitId(): string {
  const random =
    globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10);
  return `outfit-${random}`;
}

function initial(name: string): string {
  return (Array.from(name.trim())[0] ?? "?").toUpperCase();
}

function CharacterForm({
  draft,
  busy,
  error,
  onChange,
  onSave,
  onCancel,
  isNew,
}: {
  draft: Draft;
  busy: boolean;
  error: string | null;
  onChange: (next: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  isNew: boolean;
}) {
  const filled = Object.values(draft.development).filter((v) => v.trim() !== "").length;
  return (
    <form
      className="character-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
      data-testid={isNew ? "character-new-form" : "character-edit-form"}
    >
      <div className="form-grid">
        <label className="field">
          <span>Name</span>
          <input
            className="text-input"
            value={draft.name}
            maxLength={120}
            // biome-ignore lint/a11y/noAutofocus: the person just opened this form.
            autoFocus
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
            data-testid="character-name"
          />
        </label>
        <label className="field field-wide">
          <span>Look</span>
          <textarea
            className="text-input"
            rows={2}
            value={draft.lockstring}
            placeholder="Short black hair, round glasses, yellow raincoat"
            onChange={(event) => onChange({ ...draft, lockstring: event.target.value })}
            data-testid="character-look"
          />
          <small className="field-hint">The features that stay the same in every cut.</small>
        </label>
        <label className="field field-wide">
          <span>More about their look</span>
          <textarea
            className="text-input"
            rows={2}
            value={draft.visualIdentity}
            placeholder="Face, build, distinguishing marks"
            onChange={(event) => onChange({ ...draft, visualIdentity: event.target.value })}
          />
        </label>
      </div>
      <fieldset className="form-group">
        <legend>Personality</legend>
        <div className="form-grid">
          {DEVELOPMENT_FIELDS.map((field) => (
            <label className="field" key={field.key}>
              <span>{field.label}</span>
              <input
                className="text-input"
                value={draft.development[field.key]}
                placeholder={field.hint}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    development: { ...draft.development, [field.key]: event.target.value },
                  })
                }
              />
            </label>
          ))}
        </div>
        {filled > 0 && filled < 5 && (
          <p className="field-hint">Fill in all five, or leave them all empty.</p>
        )}
      </fieldset>
      <fieldset className="form-group">
        <legend>Outfits</legend>
        {draft.wardrobe.length === 0 && <p className="field-hint">No outfits yet.</p>}
        {draft.wardrobe.map((outfit, index) => (
          <div className="outfit-row" key={outfit.id}>
            <label className="sr-only" htmlFor={`${outfit.id}-text`}>
              Outfit {index + 1}
            </label>
            <input
              id={`${outfit.id}-text`}
              className="text-input"
              value={outfit.description}
              placeholder="School uniform with a red scarf"
              onChange={(event) =>
                onChange({
                  ...draft,
                  wardrobe: draft.wardrobe.map((o) =>
                    o.id === outfit.id ? { ...o, description: event.target.value } : o,
                  ),
                })
              }
            />
            <button
              type="button"
              className="btn btn-icon btn-quiet"
              aria-label={`Remove outfit ${index + 1}`}
              onClick={() =>
                onChange({ ...draft, wardrobe: draft.wardrobe.filter((o) => o.id !== outfit.id) })
              }
            >
              <StudioIcon name="close" />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() =>
            onChange({
              ...draft,
              wardrobe: [...draft.wardrobe, { id: outfitId(), description: "" }],
            })
          }
        >
          <StudioIcon name="plus" /> Add outfit
        </button>
      </fieldset>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy}
          data-testid="character-save"
        >
          {busy ? "Saving…" : isNew ? "Add character" : "Save"}
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function payloadOf(draft: Draft): { character?: Record<string, unknown>; error?: string } {
  const name = draft.name.trim();
  if (name === "") return { error: "Give the character a name." };
  const values = Object.values(draft.development).map((v) => v.trim());
  const filled = values.filter((v) => v !== "").length;
  if (filled > 0 && filled < 5) return { error: "Fill in all five personality fields, or none." };
  const wardrobe = draft.wardrobe
    .map((o) => ({ id: o.id, description: o.description.trim() }))
    .filter((o) => o.description !== "");
  return {
    character: {
      ...(draft.id ? { id: draft.id } : {}),
      name,
      lockstring: draft.lockstring.trim() || name,
      visualIdentity: draft.visualIdentity.trim() || null,
      development:
        filled === 5
          ? Object.fromEntries(Object.entries(draft.development).map(([k, v]) => [k, v.trim()]))
          : null,
      wardrobe: wardrobe.length > 0 ? wardrobe : null,
    },
  };
}

export function CharacterCards({ workId, cards }: { workId: string; cards: CastCard[] }) {
  const router = useRouter();
  const toast = useUndoToast(workId);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(draftOf());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Character | null>(null);

  const open = (character?: Character) => {
    setDraft(draftOf(character));
    setError(null);
    setEditing(character?.id ?? null);
    setAdding(character === undefined);
  };
  const close = () => {
    setEditing(null);
    setAdding(false);
    setError(null);
  };

  const save = async () => {
    const { character, error: problem } = payloadOf(draft);
    if (!character) {
      setError(problem ?? null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await studioFetch("/api/cast", {
        method: "POST",
        body: JSON.stringify({ action: "save", workId, character }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        changeId?: string | null;
      };
      if (!response.ok || !data.ok) {
        setError(data.error ?? "Toony could not save this character.");
        return;
      }
      toast.show({
        text: adding ? `Added ${character.name as string}.` : `Saved ${character.name as string}.`,
        changeId: data.changeId ?? null,
      });
      close();
      router.refresh();
    } catch {
      setError("Toony could not save this character.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      const response = await studioFetch("/api/cast", {
        method: "POST",
        body: JSON.stringify({ action: "remove", workId, characterId: removing.id }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        changeId?: string | null;
      };
      if (!response.ok || !data.ok) {
        toast.show({ text: data.error ?? "Toony could not remove this character.", tone: "error" });
      } else {
        toast.show({ text: `Removed ${removing.name}.`, changeId: data.changeId ?? null });
        router.refresh();
      }
      setRemoving(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="character-cards" data-testid="character-editor">
      <div className="section-head">
        <p className="page-meta">
          {cards.length === 0
            ? "No characters yet."
            : `${cards.length} ${cards.length === 1 ? "character" : "characters"}`}
        </p>
        {!adding && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => open()}
            data-testid="character-add"
          >
            <StudioIcon name="plus" /> Add character
          </button>
        )}
      </div>
      {adding && (
        <article className="character-card is-editing">
          <h2 className="card-title">New character</h2>
          <CharacterForm
            draft={draft}
            busy={busy}
            error={error}
            onChange={setDraft}
            onSave={() => void save()}
            onCancel={close}
            isNew
          />
        </article>
      )}
      {cards.length === 0 && !adding && (
        <p className="empty-note" data-testid="character-empty">
          Ask the agent to create the cast from your story, or add a character yourself.
        </p>
      )}
      <ul className="character-grid">
        {cards.map(({ character, sheets, appearances }) => (
          <li key={character.id}>
            <article
              id={character.id}
              className={`character-card${editing === character.id ? " is-editing" : ""}`}
              data-testid={`character-${character.id}`}
            >
              <header className="character-card-head">
                <span className="avatar avatar-large" aria-hidden="true">
                  {sheets[0] ? (
                    // biome-ignore lint/performance/noImgElement: local reference sheet thumbnail.
                    <img src={sheets[0]} alt="" />
                  ) : (
                    initial(character.name)
                  )}
                </span>
                <div className="character-card-title">
                  <h2>{character.name}</h2>
                  <p>{character.development?.role ?? "No role yet"}</p>
                </div>
                {editing !== character.id && (
                  <div className="character-card-actions">
                    <button type="button" className="btn btn-ghost" onClick={() => open(character)}>
                      <StudioIcon name="pencil" /> Edit
                    </button>
                    <ActionMenu
                      label={`More actions for ${character.name}`}
                      actions={[
                        {
                          label: "Remove from cast",
                          danger: true,
                          onSelect: () => setRemoving(character),
                          testId: `character-remove-${character.id}`,
                        },
                      ]}
                    />
                  </div>
                )}
              </header>
              {editing === character.id ? (
                <CharacterForm
                  draft={draft}
                  busy={busy}
                  error={error}
                  onChange={setDraft}
                  onSave={() => void save()}
                  onCancel={close}
                  isNew={false}
                />
              ) : (
                <>
                  <dl className="character-facts">
                    <div>
                      <dt>Look</dt>
                      <dd>
                        {character.lockstring}
                        {character.visualIdentity && (
                          <span className="block">{character.visualIdentity}</span>
                        )}
                      </dd>
                    </div>
                    {character.development && (
                      <div>
                        <dt>Personality</dt>
                        <dd>
                          <span className="block">Wants: {character.development.desire}</span>
                          <span className="block">Flaw: {character.development.flaw}</span>
                          <span className="block">Voice: {character.development.voice}</span>
                          <span className="block">Arc: {character.development.arc}</span>
                        </dd>
                      </div>
                    )}
                    {character.wardrobe && character.wardrobe.length > 0 && (
                      <div>
                        <dt>Outfits</dt>
                        <dd>
                          <ul>
                            {character.wardrobe.map((outfit) => (
                              <li key={outfit.id}>{outfit.description}</li>
                            ))}
                          </ul>
                        </dd>
                      </div>
                    )}
                  </dl>
                  {sheets.length > 0 && (
                    <div className="sheet-thumbs">
                      {sheets.map((src) => (
                        <a key={src} href={src} target="_blank" rel="noreferrer">
                          {/* biome-ignore lint/performance/noImgElement: local reference sheet thumbnail. */}
                          <img src={src} alt={`Reference sheet for ${character.name}`} />
                        </a>
                      ))}
                    </div>
                  )}
                  {appearances.length > 0 && (
                    <div className="appearances">
                      {appearances.map((appearance) => (
                        <p key={appearance.episode}>
                          <span>{appearance.episode}:</span>{" "}
                          {appearance.cuts.map((cut, index) => (
                            <span key={cut.href}>
                              {index > 0 && ", "}
                              <Link className="appearance-link" href={cut.href}>
                                Cut {cut.number}
                              </Link>
                            </span>
                          ))}
                        </p>
                      ))}
                    </div>
                  )}
                </>
              )}
            </article>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing?.name ?? ""} from the cast?`}
        confirmLabel={busy ? "Removing…" : "Remove"}
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      >
        <p>Cuts that name this character will no longer list them. You can undo right after.</p>
      </ConfirmDialog>
      {toast.element}
    </div>
  );
}
