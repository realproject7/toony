"use client";

// "New webtoon" action for the workspace library (issue #51).
//
// Prompts for a title, POSTs it to `/api/work`, which scaffolds a valid project
// folder inside the workspace (the same in-memory model `toony init` writes), and
// on success navigates straight into the new work's dashboard at `/w/<id>`. All
// path safety lives server-side: the route slugifies the title and refuses to
// write outside the workspace or over an existing folder.

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

export function NewWorkButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
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
        body: JSON.stringify({ name: trimmed }),
      });
      const data = (await response.json()) as { ok: boolean; id?: string; error?: string };
      if (!response.ok || !data.ok || !data.id) {
        setError(data.error ?? "Could not create the work.");
        return;
      }
      router.push(`/w/${encodeURIComponent(data.id)}`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [name, router]);

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => setOpen(true)}
        data-testid="new-work-open"
      >
        + New webtoon
      </button>
    );
  }

  return (
    <div className="new-work-form" data-testid="new-work-form">
      <input
        type="text"
        className="new-work-input"
        placeholder="Webtoon title"
        value={name}
        disabled={busy}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") setOpen(false);
        }}
        data-testid="new-work-name"
      />
      <button
        type="button"
        className="btn btn-primary"
        onClick={submit}
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
        <span className="new-work-error" role="alert" data-testid="new-work-error">
          {error}
        </span>
      )}
    </div>
  );
}
