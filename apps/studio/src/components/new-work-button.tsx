"use client";

// "New webtoon" action for the workspace library (issue #51).
//
// Prompts for a title, POSTs it to `/api/work`, which scaffolds a valid project
// folder inside the workspace (the same in-memory model `toony init` writes), and
// on success navigates straight into the new work's dashboard at `/w/<id>`. All
// path safety lives server-side: the route slugifies the title and refuses to
// write outside the workspace or over an existing folder.

import { useRouter } from "next/navigation";
import { useCallback, useId, useState } from "react";
import { StudioIcon } from "./studio-icon";

export function NewWorkButton({ genres }: { genres: readonly { id: string; title: string }[] }) {
  const router = useRouter();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [genre, setGenre] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError("Enter a title for the new webtoon.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/work", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed, ...(genre ? { genre } : {}) }),
      });
      const data = (await response.json()) as { ok: boolean; id?: string; error?: string };
      if (!response.ok || !data.ok || !data.id) {
        setError(data.error ?? "Could not create the work.");
        router.refresh();
        return;
      }
      router.push(`/w/${encodeURIComponent(data.id)}`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [name, genre, router]);

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => setOpen(true)}
        data-testid="new-work-open"
      >
        <StudioIcon name="plus" /> New webtoon
      </button>
    );
  }

  return (
    <form
      className="new-work-form"
      data-testid="new-work-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="field">
        <span>Webtoon title</span>
        <input
          type="text"
          className="new-work-input"
          placeholder="Webtoon title"
          aria-label="Webtoon title"
          aria-invalid={!!error}
          aria-describedby={error ? `${formId}-error` : undefined}
          value={name}
          disabled={busy}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) {
              if (e.key === "Enter") e.preventDefault();
              return;
            }
            if (e.key === "Escape") setOpen(false);
          }}
          data-testid="new-work-name"
        />
      </label>
      <label className="field">
        <span>
          Starter <small>(optional)</small>
        </span>
        <select
          className="new-work-input"
          aria-label="Starter (optional)"
          data-testid="new-work-genre"
          value={genre}
          disabled={busy}
          onChange={(event) => {
            setGenre(event.target.value);
            setError(null);
          }}
        >
          <option value="">Blank story</option>
          {genre && !genres.some((entry) => entry.id === genre) && (
            <option value={genre} disabled>
              {genre} (unavailable)
            </option>
          )}
          {genres.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.title}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        className="btn btn-primary"
        disabled={busy}
        data-testid="new-work-create"
      >
        {busy ? "Creating…" : "Create"}
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => {
          setOpen(false);
          setError(null);
        }}
        disabled={busy}
        data-testid="new-work-cancel"
      >
        Cancel
      </button>
      {error && (
        <span
          id={`${formId}-error`}
          className="new-work-error"
          role="alert"
          data-testid="new-work-error"
        >
          {error}
        </span>
      )}
    </form>
  );
}
