"use client";

// "New webtoon": asks only for a title, creates a blank webtoon through the
// work route (the title is kept exactly as typed), and opens its story page.

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { studioFetch } from "@/lib/studio-fetch";
import { StudioIcon } from "./studio-icon";

export function NewWorkButton({
  label = "New webtoon",
  variant = "primary",
}: {
  label?: string;
  variant?: "primary" | "quiet";
}) {
  const router = useRouter();
  const formId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const submit = useCallback(async () => {
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      setError("Enter a title for the new webtoon.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await studioFetch("/api/work", {
        method: "POST",
        body: JSON.stringify({ action: "create", title: trimmed }),
      });
      const data = (await response.json()) as { ok: boolean; id?: string; error?: string };
      if (!response.ok || !data.ok || !data.id) {
        setError(data.error ?? "Toony could not create the webtoon. Try again.");
        return;
      }
      router.push(`/w/${encodeURIComponent(data.id)}`);
    } catch {
      setError("Toony could not reach the workspace. Check that Studio is still running.");
    } finally {
      setBusy(false);
    }
  }, [title, router]);

  if (!open) {
    return (
      <button
        type="button"
        className={variant === "primary" ? "btn btn-primary" : "btn btn-ghost"}
        onClick={() => setOpen(true)}
        data-testid="new-work-open"
      >
        {variant === "primary" && <StudioIcon name="plus" />} {label}
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
        <span>Title</span>
        <input
          ref={input}
          type="text"
          className="text-input"
          placeholder="My webtoon"
          aria-invalid={!!error}
          aria-describedby={error ? `${formId}-error` : undefined}
          value={title}
          maxLength={200}
          disabled={busy}
          onChange={(event) => {
            setTitle(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
              if (event.key === "Enter") event.preventDefault();
              return;
            }
            if (event.key === "Escape") setOpen(false);
          }}
          data-testid="new-work-name"
        />
      </label>
      <div className="form-actions">
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
      </div>
      {error && (
        <p id={`${formId}-error`} className="form-error" role="alert" data-testid="new-work-error">
          {error}
        </p>
      )}
    </form>
  );
}
