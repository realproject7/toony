"use client";

// The webtoon title on the story page, renamed in place. Enter saves, Escape
// cancels; IME composition never submits.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { studioFetch } from "@/lib/studio-fetch";
import { StudioIcon } from "./studio-icon";

export function WorkTitle({ workId, title }: { workId: string; title: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setValue(title);
  }, [title, editing]);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const save = async () => {
    const next = value.trim();
    if (next === "" || next === title) {
      setEditing(false);
      setValue(title);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await studioFetch("/api/work", {
        method: "POST",
        body: JSON.stringify({ action: "rename", workId, title: next }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        setError(data.error ?? "Toony could not rename the webtoon.");
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setError("Toony could not rename the webtoon.");
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <div className="title-row">
        <h1 className="page-title" data-testid="project-title">
          {title}
        </h1>
        <button
          type="button"
          className="btn btn-icon btn-quiet"
          aria-label="Rename webtoon"
          title="Rename"
          onClick={() => setEditing(true)}
          data-testid="rename-work"
        >
          <StudioIcon name="pencil" />
        </button>
      </div>
    );
  }
  return (
    <form
      className="title-edit"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label className="sr-only" htmlFor="work-title-input">
        Webtoon title
      </label>
      <input
        id="work-title-input"
        ref={input}
        className="text-input title-input"
        value={value}
        maxLength={200}
        disabled={busy}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
            if (event.key === "Enter") event.preventDefault();
            return;
          }
          if (event.key === "Escape") {
            setEditing(false);
            setValue(title);
            setError(null);
          }
        }}
        data-testid="work-title-input"
      />
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        disabled={busy}
        onClick={() => {
          setEditing(false);
          setValue(title);
          setError(null);
        }}
      >
        Cancel
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
