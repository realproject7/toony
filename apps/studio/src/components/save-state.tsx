"use client";

// The editor's save state as a quiet label ("Saved", "Unsaved changes",
// "Saving…"), with a primary Save button only while there is something to
// save. A disabled primary button used to stand in for the label, and its
// faded text was hard to read.

import { StudioIcon } from "./studio-icon";

export function SaveState({
  dirty,
  saving,
  onSave,
  testId,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  testId: string;
}) {
  const state = saving ? "saving" : dirty ? "unsaved" : "saved";
  return (
    <span className="save-state-group">
      <span className="save-state" role="status" data-state={state} data-testid={`${testId}-state`}>
        {state === "saved" && <StudioIcon name="check" />}
        {state === "saving" ? "Saving…" : state === "unsaved" ? "Unsaved changes" : "Saved"}
      </span>
      {state === "unsaved" && (
        <button type="button" className="btn btn-primary" onClick={onSave} data-testid={testId}>
          Save
        </button>
      )}
    </span>
  );
}
