"use client";

// Lines the agent suggested for this cut (TXT-01), beside the art. Nothing
// here letters the cut by itself: the person edits a line if they like, then
// copies it, adds it as a new bubble or puts it in the selected bubble. Both
// inserts go through the editor's undo history.

import { useCallback, useEffect, useState } from "react";
import { useLiveEvent } from "@/lib/live/provider";
import { studioFetch } from "@/lib/studio-fetch";
import {
  type CutSuggestionsView,
  type DialogueSuggestion,
  type SuggestionKind,
  suggestionFlagLabel,
} from "@/lib/suggestions/types";

const KIND_LABELS: Record<SuggestionKind, string> = {
  speech: "Speech",
  thought: "Thought",
  narration: "Narration",
  silent: "No line",
};

export function DialogueSuggestions({
  workId,
  episodeId,
  cutId,
  canReplace,
  onInsert,
  onReplace,
}: {
  workId: string;
  episodeId: string;
  cutId: string;
  /** A bubble that can take new text is selected. */
  canReplace: boolean;
  onInsert: (option: DialogueSuggestion, text: string, speakerName?: string) => void;
  onReplace: (option: DialogueSuggestion, text: string, speakerName?: string) => void;
}) {
  const [view, setView] = useState<CutSuggestionsView | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams({ workId, episodeId, cutId });
      const response = await studioFetch(`/api/suggestions?${query}`);
      const body = (await response.json()) as { ok: boolean; suggestions?: CutSuggestionsView };
      setView(body.ok ? (body.suggestions ?? null) : null);
      setDrafts({});
      setEditing(null);
    } catch {
      setView(null);
    }
  }, [workId, episodeId, cutId]);

  useEffect(() => {
    void load();
  }, [load]);
  useLiveEvent("suggestions", (event) => {
    if (
      event.type === "suggestions" &&
      event.workId === workId &&
      event.episodeId === episodeId &&
      event.cutId === cutId
    ) {
      void load();
    }
  });

  if (!view || view.options.length === 0) return null;

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
    } catch {
      setCopied(null);
    }
  };

  return (
    <details className="dialogue-suggestions" open data-testid="dialogue-suggestions">
      <summary>Suggested lines ({view.options.length})</summary>
      <p className="empty-note">
        From your agent. Edit a line, then add it as a bubble or put it in the selected one.
      </p>
      {view.stale && (
        <p className="suggestions-stale" data-testid="suggestions-stale">
          Written before this cut's scene or cast changed.
        </p>
      )}
      <ul className="suggestion-list">
        {view.options.map((option) => {
          const text = drafts[option.id] ?? option.text ?? "";
          const silent = option.kind === "silent";
          return (
            <li key={option.id} className="suggestion" data-testid="suggestion">
              <div className="chip-row">
                <span className="chip">{KIND_LABELS[option.kind]}</span>
                {option.speakerName || option.speaker ? (
                  <span className="suggestion-speaker">{option.speakerName ?? option.speaker}</span>
                ) : null}
                {option.flags.map((flag) => (
                  <span key={flag} className="chip chip-warn">
                    {suggestionFlagLabel(flag)}
                  </span>
                ))}
              </div>
              {silent ? (
                <p className="suggestion-text">No line. The art carries this beat.</p>
              ) : editing === option.id ? (
                <textarea
                  className="suggestion-edit"
                  aria-label="Edit suggested line"
                  value={text}
                  rows={3}
                  onChange={(event) =>
                    setDrafts((prev) => ({ ...prev, [option.id]: event.target.value }))
                  }
                />
              ) : (
                <p className="suggestion-text">{text}</p>
              )}
              {option.note && <p className="suggestion-note">{option.note}</p>}
              {!silent && (
                <div className="suggestion-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setEditing(editing === option.id ? null : option.id)}
                  >
                    {editing === option.id ? "Done" : "Edit"}
                  </button>
                  <button type="button" className="btn" onClick={() => void copy(option.id, text)}>
                    {copied === option.id ? "Copied" : "Copy"}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={text.trim() === ""}
                    onClick={() => onInsert(option, text.trim(), option.speakerName)}
                    data-testid="suggestion-add"
                  >
                    Add as bubble
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={!canReplace || text.trim() === ""}
                    title={canReplace ? undefined : "Select a bubble first"}
                    onClick={() => onReplace(option, text.trim(), option.speakerName)}
                    data-testid="suggestion-replace"
                  >
                    Use in selected
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
