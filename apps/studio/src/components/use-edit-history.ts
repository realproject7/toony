"use client";

// The editors' undo and redo (#333), over the pure history in `@/lib/edit-history`.
//
// `record()` snapshots the CURRENT state before a change; call it first, then
// apply the change. `record({ coalesce: true })` folds rapid successive calls
// (keystrokes in a text field, repeated arrow nudges) into one step. `undo()`
// and `redo()` return the state to set, or null.

import { useCallback, useRef, useState } from "react";
import {
  type EditHistory,
  emptyHistory,
  record as pushRecord,
  redo as stepRedo,
  undo as stepUndo,
} from "@/lib/edit-history";

/** Successive coalesced records closer than this are one undo step. */
const COALESCE_MS = 400;

export interface EditHistoryControls<T> {
  record: (options?: { coalesce?: boolean }) => void;
  undo: () => T | null;
  redo: () => T | null;
  canUndo: boolean;
  canRedo: boolean;
}

export function useEditHistory<T>(current: T): EditHistoryControls<T> {
  const currentRef = useRef(current);
  currentRef.current = current;
  const [history, setHistory] = useState<EditHistory<T>>(() => emptyHistory<T>());
  const historyRef = useRef(history);
  historyRef.current = history;
  const lastRecordRef = useRef(0);

  const record = useCallback((options?: { coalesce?: boolean }) => {
    const now = Date.now();
    if (options?.coalesce && now - lastRecordRef.current < COALESCE_MS) {
      lastRecordRef.current = now;
      return;
    }
    lastRecordRef.current = now;
    const next = pushRecord(historyRef.current, currentRef.current);
    historyRef.current = next;
    setHistory(next);
  }, []);

  const undo = useCallback((): T | null => {
    const step = stepUndo(historyRef.current, currentRef.current);
    if (!step) return null;
    historyRef.current = step.history;
    setHistory(step.history);
    lastRecordRef.current = 0;
    return step.state;
  }, []);

  const redo = useCallback((): T | null => {
    const step = stepRedo(historyRef.current, currentRef.current);
    if (!step) return null;
    historyRef.current = step.history;
    setHistory(step.history);
    lastRecordRef.current = 0;
    return step.state;
  }, []);

  return {
    record,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}

/** True when a keyboard event started in a field that owns its own keys. */
export function keyboardOwnedByField(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}
