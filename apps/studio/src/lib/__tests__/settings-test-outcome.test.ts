import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type ComfyConfigValues,
  describeTestOutcome,
  isDirty,
  UNSAVED_EDITS_MESSAGE,
} from "../settings-test-outcome.js";

const EMPTY: ComfyConfigValues = { endpoint: null, checkpoint: null, workflow: null };
const SAVED: ComfyConfigValues = {
  endpoint: "http://127.0.0.1:8188",
  checkpoint: "model.safetensors",
  workflow: null,
};

// #223: the defect was a press that produced NOTHING. The probe resolves to the
// state already on the badge, so "the badge is right" was true the whole time
// and the screen still never changed. These pin the sentence, not the badge.

test("every outcome says something, including the one that used to say nothing (#223)", () => {
  // "unconfigured" is the exact case that reproduced the bug: a first-time user
  // types an endpoint, presses Test, and the probe returns the state already
  // displayed. Asserting non-empty here is asserting the defect is gone.
  for (const state of ["reachable", "unreachable", "unconfigured", "unknown", undefined] as const) {
    const message = describeTestOutcome(state);
    assert.ok(message.length > 0, `${state} must report something`);
    assert.ok(message.trim() === message, `${state} must not pad its message`);
  }
});

test("each outcome names a different next step", () => {
  // If two states produced the same sentence the user could not tell them
  // apart, which is the same failure in a quieter form.
  const messages = (["reachable", "unreachable", "unconfigured"] as const).map((s) =>
    describeTestOutcome(s),
  );
  assert.equal(new Set(messages).size, 3, "reachable, unreachable and unconfigured must differ");
});

test("an unreachable endpoint passes the server's reason through", () => {
  const withDetail = describeTestOutcome("unreachable", "ECONNREFUSED 127.0.0.1:8188");
  assert.match(withDetail, /ECONNREFUSED 127\.0\.0\.1:8188/);
  // Without a reason it still has to be actionable rather than bare.
  const without = describeTestOutcome("unreachable");
  assert.notEqual(without, describeTestOutcome("reachable"));
  assert.match(without, /ComfyUI/);
});

test("an unknown state falls back to the first-run instruction, not to silence", () => {
  assert.equal(describeTestOutcome("unknown"), describeTestOutcome("unconfigured"));
  assert.equal(describeTestOutcome(undefined), describeTestOutcome("unconfigured"));
});

test("a form matching disk is not dirty, in either direction of null and empty", () => {
  assert.equal(isDirty(SAVED, SAVED), false);
  assert.equal(isDirty(EMPTY, EMPTY), false);
  // The form holds "" where the file holds null. That is the initial state of
  // every fresh workspace and must not read as an unsaved edit.
  assert.equal(isDirty({ endpoint: "", checkpoint: "", workflow: "" }, EMPTY), false);
  // Whitespace is trimmed before saving, so it is not an edit either.
  assert.equal(isDirty({ ...SAVED, endpoint: "  http://127.0.0.1:8188  " }, SAVED), false);
});

test("a change to any one field is dirty", () => {
  const fields: (keyof ComfyConfigValues)[] = ["endpoint", "checkpoint", "workflow"];
  for (const field of fields) {
    const edited = { ...SAVED, [field]: "changed" };
    assert.equal(isDirty(edited, SAVED), true, `${field} must count as an edit`);
  }
  // The case that produced the ticket: typing an endpoint into a fresh install.
  assert.equal(isDirty({ ...EMPTY, endpoint: "http://127.0.0.1:8188" }, EMPTY), true);
});

test("the unsaved-edits message tells the user which button to press first", () => {
  assert.match(UNSAVED_EDITS_MESSAGE, /Save settings/);
  // It must not be mistakable for a probe result.
  assert.notEqual(UNSAVED_EDITS_MESSAGE, describeTestOutcome("unconfigured"));
});
