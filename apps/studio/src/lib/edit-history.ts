// Undo and redo over editor snapshots (#333). Pure and React-free, so it runs
// under the repo's node:test harness; the editors wrap it in a hook.
//
// A snapshot is the editor's whole editable state before a change. `record`
// pushes one and clears the redo stack, `undo` hands back the last recorded
// state and keeps the current one for `redo`. The caller decides what counts as
// one step: a drag records once at its start, a keystroke in a text field is
// coalesced by the hook, add, duplicate and delete record once each.

export interface EditHistory<T> {
  past: T[];
  future: T[];
}

/** The most snapshots kept. Older ones fall off the start of the stack. */
export const EDIT_HISTORY_LIMIT = 100;

export function emptyHistory<T>(): EditHistory<T> {
  return { past: [], future: [] };
}

/** Record `snapshot` as the state to return to on the next undo. Clears redo. */
export function record<T>(
  history: EditHistory<T>,
  snapshot: T,
  limit = EDIT_HISTORY_LIMIT,
): EditHistory<T> {
  const past = [...history.past, snapshot];
  return { past: past.length > limit ? past.slice(past.length - limit) : past, future: [] };
}

/** Step back. `current` is kept so redo can return to it. Null when nothing to undo. */
export function undo<T>(
  history: EditHistory<T>,
  current: T,
): { history: EditHistory<T>; state: T } | null {
  const state = history.past.at(-1);
  if (state === undefined) return null;
  return {
    history: { past: history.past.slice(0, -1), future: [...history.future, current] },
    state,
  };
}

/** Step forward after an undo. Null when nothing to redo. */
export function redo<T>(
  history: EditHistory<T>,
  current: T,
): { history: EditHistory<T>; state: T } | null {
  const state = history.future.at(-1);
  if (state === undefined) return null;
  return {
    history: { past: [...history.past, current], future: history.future.slice(0, -1) },
    state,
  };
}
