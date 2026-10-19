import assert from "node:assert/strict";
import { test } from "node:test";
import { buildInitialProject } from "@toony/project-io";
import { episodeSelection, readRhythmDraft, removeEpisodeTransition } from "../episode-editing.js";

const bundle = buildInitialProject("Episode editing fixture").episodes[0];
assert.ok(bundle);

test("selection resolves typed deep links and falls back for deleted items", () => {
  const sequence = [
    { type: "cut" as const, id: "shared" },
    { type: "transition" as const, id: "shared" },
  ];
  assert.equal(episodeSelection(sequence, "transition:shared"), sequence[1]);
  assert.equal(episodeSelection(sequence, "cut:shared"), sequence[0]);
  assert.equal(episodeSelection(sequence, "transition:deleted"), sequence[0]);
  assert.equal(episodeSelection([], "cut:shared"), null);
});

test("deleting a transition preserves a cut with the same id and the source state", () => {
  const state = {
    sequence: [{ type: "cut" as const, id: "tr-001" }, ...bundle.episode.sequence],
    transitions: bundle.transitions,
  };
  const next = removeEpisodeTransition(state, "tr-001");
  assert.equal(next.transitions.length, 0);
  assert.ok(next.sequence.some((i) => i.type === "cut" && i.id === "tr-001"));
  assert.equal(state.transitions.length, 1);
});

test("recovery preserves the original revision and rejects malformed nested draft fields", () => {
  const draft = {
    sequence: bundle.episode.sequence,
    transitions: bundle.transitions,
    revision: "a".repeat(64),
  };
  assert.deepEqual(readRhythmDraft(JSON.stringify(draft)), draft);
  for (const bad of [
    null,
    { ...draft, revision: "stale" },
    { ...draft, sequence: [{ type: "unknown", id: "x" }] },
    { ...draft, transitions: [{ ...bundle.transitions[0], gutterHeight: -1 }] },
    { ...draft, transitions: [null] },
  ]) {
    assert.equal(readRhythmDraft(JSON.stringify(bad)), null);
  }
  assert.equal(readRhythmDraft("{"), null);
  assert.equal(readRhythmDraft(" ".repeat(2_100_001)), null);
});
