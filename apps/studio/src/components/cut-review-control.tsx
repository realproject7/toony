"use client";

import type { ReviewStatus } from "@toony/schema";
import { useState } from "react";

/** Artwork review saves independently of lettering, including unsaved lettering. */
export function CutReviewControl({
  workId,
  episodeId,
  cutId,
  initialReviewStatus,
}: {
  workId: string;
  episodeId: string;
  cutId: string;
  initialReviewStatus?: ReviewStatus;
}) {
  const [status, setStatus] = useState(initialReviewStatus ?? "draft");
  const [saved, setSaved] = useState(initialReviewStatus ?? "draft");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/cut-review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workId, episodeId, cutId, reviewStatus: status }),
      });
      const result = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) {
        setMessage(result.error ?? "Could not save the cut review.");
      } else {
        setSaved(status);
        setMessage("Cut review saved.");
      }
    } catch {
      setMessage("Could not save the cut review. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="editor-toolbar" data-testid="cut-review-control">
      <label className="field" htmlFor="cut-review-status">
        <span>Cut artwork review</span>
        <select
          id="cut-review-status"
          data-testid="cut-review-status"
          value={status}
          disabled={saving}
          onChange={(event) => {
            setStatus(event.target.value as ReviewStatus);
            setMessage(null);
          }}
        >
          <option value="draft">Draft (unreviewed)</option>
          <option value="human-edited">Human-edited</option>
          <option value="final">Final</option>
        </select>
      </label>
      <button
        type="button"
        className="btn"
        disabled={saving || status === saved}
        onClick={save}
        data-testid="cut-review-save"
      >
        {saving ? "Saving review…" : "Save cut review"}
      </button>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
