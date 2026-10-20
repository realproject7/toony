// Change scopes: stable keys, which changes overlap an editor's unsaved work,
// which changes a page shows, and the dirty editor registry.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChangeScope } from "../agent/protocol.js";
import { dirtyEditorScopes, hasDirtyOverlap, registerEditorScope } from "../live/editor-scopes.js";
import { changeTouchesView, parseScopeKey, scopeKey, scopesOverlap } from "../live/scope.js";

const lettering: ChangeScope = { kind: "lettering", episodeId: "ep-001", cutId: "cut-002" };
const episode: ChangeScope = { kind: "episode", episodeId: "ep-001" };
const otherEpisode: ChangeScope = { kind: "episode", episodeId: "ep-002" };
const sequence: ChangeScope = { kind: "sequence", episodeId: "ep-001" };

test("scope keys round-trip and refuse anything else", () => {
  for (const scope of [
    lettering,
    episode,
    sequence,
    { kind: "work" },
    { kind: "characters" },
    { kind: "artwork", episodeId: "ep-001", cutId: "cut-001" },
  ] as ChangeScope[]) {
    assert.deepEqual(parseScopeKey(scopeKey(scope)), scope);
  }
  assert.equal(scopeKey(lettering), "lettering:ep-001/cut-002");
  assert.equal(parseScopeKey("lettering:ep-001"), null);
  assert.equal(parseScopeKey("cut-002"), null);
  assert.equal(parseScopeKey("episode:ep-001/cut-002"), null);
});

test("overlap: equal scopes and anything inside a whole-episode change", () => {
  assert.equal(scopesOverlap(lettering, lettering), true);
  assert.equal(scopesOverlap(lettering, episode), true);
  assert.equal(scopesOverlap(episode, sequence), true);
  assert.equal(scopesOverlap(lettering, otherEpisode), false);
  assert.equal(scopesOverlap(lettering, sequence), false, "rhythm edits do not touch lettering");
  assert.equal(
    scopesOverlap(lettering, { kind: "cut", episodeId: "ep-001", cutId: "cut-002" }),
    false,
  );
  assert.equal(scopesOverlap({ kind: "export", episodeId: "ep-001" }, episode), false);
});

test("a page sees changes inside what it shows, every rename, and everything with all", () => {
  assert.equal(changeTouchesView([episode], [lettering]), true);
  assert.equal(changeTouchesView([otherEpisode], [lettering]), false);
  assert.equal(changeTouchesView([otherEpisode], [{ kind: "work" }]), true);
  assert.equal(changeTouchesView([{ kind: "episodes" }], [sequence]), true);
  assert.equal(changeTouchesView("all", [{ kind: "characters" }]), true);
  assert.equal(changeTouchesView([{ kind: "characters" }], [{ kind: "story" }]), false);
});

test("only a dirty editor whose scope overlaps holds back a refresh", () => {
  let dirty = false;
  const unregister = registerEditorScope(scopeKey(lettering), () => dirty);
  try {
    assert.equal(hasDirtyOverlap([lettering]), false, "a clean editor never blocks");
    dirty = true;
    assert.deepEqual(dirtyEditorScopes(), ["lettering:ep-001/cut-002"]);
    assert.equal(hasDirtyOverlap([lettering]), true);
    assert.equal(hasDirtyOverlap([episode]), true);
    assert.equal(hasDirtyOverlap([otherEpisode, sequence]), false);
  } finally {
    unregister();
  }
  assert.equal(hasDirtyOverlap([lettering]), false);
  assert.throws(() => registerEditorScope("cut-002", () => true), /Unknown editor scope/);
  const broken = registerEditorScope(scopeKey(sequence), () => {
    throw new Error("unmounted");
  });
  assert.equal(hasDirtyOverlap([sequence]), true, "an editor that cannot answer counts as dirty");
  broken();
});
