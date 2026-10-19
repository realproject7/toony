import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeEditorDraft, encodeEditorDraft } from "../editor-draft.js";
import { newOverlay } from "../new-overlay.js";

test("recovered editor drafts preserve the original save revision and literal text", () => {
  const bubbles = [{ ...newOverlay("cut-1", 0), text: "안녕 <b>hello</b>" }];
  const revision = "a".repeat(64);
  assert.deepEqual(decodeEditorDraft(encodeEditorDraft(revision, bubbles), "cut-1"), {
    revision,
    bubbles,
  });
  assert.deepEqual(decodeEditorDraft(encodeEditorDraft(revision, []), "cut-1"), {
    revision,
    bubbles: [],
  });
});
test("recovery rejects foreign cuts, corrupted data and missing revision identity", () => {
  const raw = encodeEditorDraft("a".repeat(64), [newOverlay("cut-1", 0)]);
  assert.equal(decodeEditorDraft(raw, "cut-2"), null);
  assert.equal(decodeEditorDraft("{}", "cut-1"), null);
  assert.equal(decodeEditorDraft(raw.replace("a".repeat(64), "unknown"), "cut-1"), null);
});
