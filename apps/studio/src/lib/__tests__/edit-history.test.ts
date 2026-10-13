// Undo and redo semantics the editors rely on (#333): a recorded snapshot comes
// back exactly, redo returns to what was undone, a new record clears redo, and
// the stack is bounded.

import assert from "node:assert/strict";
import { test } from "node:test";
import { EDIT_HISTORY_LIMIT, emptyHistory, record, redo, undo } from "../edit-history.js";

type Box = { x: number; y: number };

test("undo returns the recorded snapshot and redo returns to the undone state", () => {
  const start: Box = { x: 0.1, y: 0.1 };
  const moved: Box = { x: 0.4, y: 0.1 };
  let history = record(emptyHistory<Box>(), start);
  const back = undo(history, moved);
  assert.ok(back);
  assert.deepEqual(back.state, start);
  history = back.history;
  assert.equal(history.past.length, 0);
  assert.deepEqual(history.future, [moved]);
  const forward = redo(history, back.state);
  assert.ok(forward);
  assert.deepEqual(forward.state, moved);
  assert.deepEqual(forward.history.past, [start]);
  assert.equal(forward.history.future.length, 0);
});

test("undo and redo on an empty stack are null, and do not throw", () => {
  const empty = emptyHistory<Box>();
  assert.equal(undo(empty, { x: 0, y: 0 }), null);
  assert.equal(redo(empty, { x: 0, y: 0 }), null);
});

test("a new record after an undo clears the redo stack", () => {
  const a: Box = { x: 0, y: 0 };
  const b: Box = { x: 1, y: 0 };
  const c: Box = { x: 2, y: 0 };
  let history = record(emptyHistory<Box>(), a);
  const back = undo(history, b);
  assert.ok(back);
  history = record(back.history, back.state);
  assert.equal(history.future.length, 0, "the undone state is no longer reachable");
  const again = undo(history, c);
  assert.ok(again);
  assert.deepEqual(again.state, a);
});

test("a sequence of edits undoes in reverse order and redoes in forward order", () => {
  const states: Box[] = [0, 1, 2, 3].map((x) => ({ x, y: 0 }));
  let history = emptyHistory<Box>();
  for (let i = 0; i < 3; i++) history = record(history, states[i] as Box);
  let current = states[3] as Box;
  const seen: number[] = [];
  for (;;) {
    const step = undo(history, current);
    if (!step) break;
    history = step.history;
    current = step.state;
    seen.push(current.x);
  }
  assert.deepEqual(seen, [2, 1, 0]);
  const forward: number[] = [];
  for (;;) {
    const step = redo(history, current);
    if (!step) break;
    history = step.history;
    current = step.state;
    forward.push(current.x);
  }
  assert.deepEqual(forward, [1, 2, 3]);
});

test("the stack keeps at most the limit, dropping the oldest", () => {
  let history = emptyHistory<Box>();
  for (let i = 0; i < EDIT_HISTORY_LIMIT + 5; i++) history = record(history, { x: i, y: 0 });
  assert.equal(history.past.length, EDIT_HISTORY_LIMIT);
  assert.equal(history.past[0]?.x, 5);
  const small = record(record(emptyHistory<Box>(), { x: 1, y: 0 }), { x: 2, y: 0 }, 1);
  assert.deepEqual(small.past, [{ x: 2, y: 0 }]);
});
