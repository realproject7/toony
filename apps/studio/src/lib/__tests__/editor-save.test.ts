// Save-flow reconciliation tests for the studio editors (#150).
//
// Covers the AC: editing during an in-flight save must neither revert the edit
// nor mark the editor clean. `persistWithGuard` owns the dirty reconciliation;
// these run under the repo-standard node:test harness (#157).

import assert from "node:assert/strict";
import { test } from "node:test";
import { persistWithGuard, type SaveResponse } from "../editor-save.js";

/** A resolved response with the given ok/body, mimicking `fetch`. */
function response(ok: boolean, body: unknown): SaveResponse {
  return { ok, json: async () => body };
}

test("a clean save (no edits during the await) marks the editor clean", async () => {
  const outcome = await persistWithGuard({
    request: async () => response(true, { ok: true }),
    generationAtStart: 3,
    readGeneration: () => 3,
  });
  assert.deepEqual(outcome, { ok: true, clean: true });
});

test("an edit during the in-flight save keeps the editor dirty (no false-clean)", async () => {
  // The generation advances between snapshot and resolution: an edit landed.
  let generation = 7;
  const outcome = await persistWithGuard({
    request: async () => {
      generation += 1; // an edit lands while the request is in flight
      return response(true, { ok: true });
    },
    generationAtStart: 7,
    readGeneration: () => generation,
  });
  assert.deepEqual(outcome, { ok: true, clean: false });
});

test("a DELAYED save that is edited mid-flight stays dirty (delayed-fetch AC)", async () => {
  let generation = 0;
  const request = () =>
    new Promise<SaveResponse>((resolve) => {
      setTimeout(() => resolve(response(true, { ok: true })), 10);
    });

  const pending = persistWithGuard({
    request,
    generationAtStart: generation,
    readGeneration: () => generation,
  });
  // Simulate the user editing a bubble while the save is still in flight.
  generation += 1;
  const outcome = await pending;
  assert.deepEqual(outcome, { ok: true, clean: false });
});

test("an HTTP error surfaces the route's error message and does not clean", async () => {
  const outcome = await persistWithGuard({
    request: async () => response(false, { ok: false, error: "boom on disk" }),
    generationAtStart: 1,
    readGeneration: () => 1,
  });
  assert.deepEqual(outcome, { ok: false, error: "boom on disk" });
});

test("a body with ok:false is an error even on HTTP 200", async () => {
  const outcome = await persistWithGuard({
    request: async () => response(true, { ok: false }),
    generationAtStart: 1,
    readGeneration: () => 1,
  });
  assert.deepEqual(outcome, { ok: false, error: "Save failed." });
});

test("a rejected request is reported as an error, never a clean save", async () => {
  const outcome = await persistWithGuard({
    request: async () => {
      throw new Error("network down");
    },
    generationAtStart: 1,
    readGeneration: () => 1,
  });
  assert.deepEqual(outcome, { ok: false, error: "network down" });
});

test("a response whose json() throws is reported as an error", async () => {
  const outcome = await persistWithGuard({
    request: async () => ({
      ok: true,
      json: async () => {
        throw new Error("bad json");
      },
    }),
    generationAtStart: 1,
    readGeneration: () => 1,
  });
  assert.deepEqual(outcome, { ok: false, error: "bad json" });
});

test("a null JSON body is a failed save, not a crash", async () => {
  // Valid JSON `null` must not throw on a `.ok` access — the save handlers have
  // no catch around the helper, so this has to fail closed to a message.
  const outcome = await persistWithGuard({
    request: async () => response(true, null),
    generationAtStart: 1,
    readGeneration: () => 1,
  });
  assert.deepEqual(outcome, { ok: false, error: "Save failed." });
});

test("a non-object JSON body (string/number) is a failed save, not a crash", async () => {
  for (const body of ["oops", 42, true, []]) {
    const outcome = await persistWithGuard({
      request: async () => response(true, body),
      generationAtStart: 1,
      readGeneration: () => 1,
    });
    assert.deepEqual(outcome, { ok: false, error: "Save failed." }, `body=${JSON.stringify(body)}`);
  }
});
