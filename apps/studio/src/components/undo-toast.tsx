"use client";

// A short status line after a change, with Undo when the change can be undone.
// Undo goes through the undo route, which refuses when newer edits depend on
// the change and says so.

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { studioFetch } from "@/lib/studio-fetch";

interface Toast {
  text: string;
  changeId?: string | null;
  tone?: "ok" | "error";
}

export function useUndoToast(workId: string) {
  const router = useRouter();
  const [toast, setToast] = useState<Toast | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback((next: Toast | null) => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    setToast(next);
    if (next && next.tone !== "error") {
      timer.current = setTimeout(() => setToast(null), next.changeId ? 12000 : 5000);
    }
  }, []);
  useEffect(
    () => () => {
      if (timer.current !== undefined) clearTimeout(timer.current);
    },
    [],
  );

  const undo = useCallback(async () => {
    if (!toast?.changeId) return;
    setBusy(true);
    try {
      const response = await studioFetch("/api/undo", {
        method: "POST",
        body: JSON.stringify({ workId, changeId: toast.changeId }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        show({ text: data.error ?? "Toony could not undo this change.", tone: "error" });
        return;
      }
      show({ text: "Undone." });
      router.refresh();
    } catch {
      show({ text: "Toony could not undo this change.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }, [toast, workId, router, show]);

  const element = toast ? (
    <div
      className={`toast${toast.tone === "error" ? " is-error" : ""}`}
      role={toast.tone === "error" ? "alert" : "status"}
      data-testid="undo-toast"
    >
      <span>{toast.text}</span>
      {toast.changeId && (
        <button type="button" className="btn btn-chip" disabled={busy} onClick={() => void undo()}>
          Undo
        </button>
      )}
      <button
        type="button"
        className="btn btn-chip btn-icon-only"
        aria-label="Dismiss"
        onClick={() => show(null)}
      >
        ×
      </button>
    </div>
  ) : null;

  return { show, element };
}
