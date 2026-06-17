// Tests for the character-ref referential lint (#92).

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Character, Cut, EpisodeBundle } from "@toony/schema";
import { lintCharacterRefs } from "../character-lint.js";

function cut(id: string, characters?: string[]): Cut {
  return {
    id,
    image: null,
    imagePrompt: "",
    negativePrompt: "",
    ...(characters ? { characters } : {}),
  };
}

function bundle(cuts: Cut[]): EpisodeBundle {
  return {
    episode: {
      schemaVersion: 1,
      id: "ep-001",
      title: "Ep",
      sequence: cuts.map((c) => ({ type: "cut", id: c.id })),
    },
    cuts,
    transitions: [],
    lettering: [],
  };
}

const REGISTRY: Character[] = [{ id: "mina", name: "Mina", lockstring: "..." }];

test("a known character ref produces no finding", () => {
  assert.deepEqual(lintCharacterRefs(bundle([cut("c1", ["mina"])]), REGISTRY), []);
});

test("an unknown character ref warns with the cut id and code", () => {
  const findings = lintCharacterRefs(bundle([cut("c1", ["ghost"])]), REGISTRY);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "warning");
  assert.equal(findings[0]?.code, "character/unknown-ref");
  assert.equal(findings[0]?.targetId, "c1");
  assert.match(findings[0]?.message ?? "", /ghost/);
});

test("an empty registry makes every ref unknown", () => {
  const findings = lintCharacterRefs(bundle([cut("c1", ["mina"])]), []);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.code, "character/unknown-ref");
});

test("a duplicate unknown ref in one cut warns once", () => {
  const findings = lintCharacterRefs(bundle([cut("c1", ["ghost", "ghost"])]), REGISTRY);
  assert.equal(findings.length, 1);
});

test("cuts without character refs produce no findings", () => {
  assert.deepEqual(lintCharacterRefs(bundle([cut("c1"), cut("c2")]), REGISTRY), []);
});
