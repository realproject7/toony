// Tests for the craft lints (#94): trigger + clean cases, deterministic.

import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  BubbleGeometry,
  Character,
  Cut,
  EpisodeBundle,
  LetteringOverlay,
} from "@toony/schema";
import { lintCraft } from "../craft-lint.js";
import { type Finding, sortFindings } from "../findings.js";

const WIDE: BubbleGeometry = { x: 0.05, y: 0.05, width: 0.9, height: 0.18 };
const NARROW: BubbleGeometry = { x: 0.05, y: 0.05, width: 0.16, height: 0.7 };

function overlay(over: Partial<LetteringOverlay> & Pick<LetteringOverlay, "id">): LetteringOverlay {
  return {
    cutId: "c1",
    speaker: "Mina",
    kind: "speech",
    text: "Hi there.",
    font: "sans-serif",
    fill: "",
    opacity: 1,
    border: null,
    tail: null,
    geometry: WIDE,
    overflow: false,
    reviewStatus: "draft",
    ...over,
  };
}

function cut(id: string, characters?: string[]): Cut {
  return {
    id,
    image: null,
    imagePrompt: "",
    negativePrompt: "",
    ...(characters ? { characters } : {}),
  };
}

function bundle(cuts: Cut[], lettering: LetteringOverlay[]): EpisodeBundle {
  return {
    episode: {
      schemaVersion: 1,
      id: "ep-001",
      title: "Ep",
      sequence: cuts.map((c) => ({ type: "cut" as const, id: c.id })),
    },
    cuts,
    transitions: [],
    lettering,
  };
}

function codes(findings: Finding[]): string[] {
  return sortFindings(findings).map((f) => f.code);
}

test("a clean reasonable episode produces no craft findings", () => {
  const b = bundle(
    [cut("c1"), cut("c2")],
    [
      overlay({ id: "o1", cutId: "c1", text: "We should go." }),
      overlay({ id: "o2", cutId: "c2", text: "Right behind you." }),
    ],
  );
  assert.deepEqual(lintCraft(b, []), []);
});

test("craft/bubble-density warns on > 2 speech/thought bubbles in a cut", () => {
  const b = bundle(
    [cut("c1")],
    [
      overlay({ id: "a", text: "One." }),
      overlay({ id: "b", text: "Two." }),
      overlay({ id: "c", kind: "thought", text: "Three." }),
    ],
  );
  assert.ok(codes(lintCraft(b, [])).includes("craft/bubble-density"));
  // Two bubbles is fine.
  const ok = bundle(
    [cut("c1")],
    [overlay({ id: "a", text: "One." }), overlay({ id: "b", text: "Two." })],
  );
  assert.ok(!codes(lintCraft(ok, [])).includes("craft/bubble-density"));
});

test("craft/bubble-density warns when total cut text exceeds the char budget", () => {
  const long = "x".repeat(260);
  const b = bundle([cut("c1")], [overlay({ id: "a", text: long, geometry: WIDE })]);
  assert.ok(codes(lintCraft(b, [])).includes("craft/bubble-density"));
});

test("craft/tail-attribution warns on an attributed bubble with no speaker (no registry)", () => {
  const b = bundle([cut("c1")], [overlay({ id: "a", speaker: "" })]);
  assert.ok(codes(lintCraft(b, [])).includes("craft/tail-attribution"));
  // A non-empty speaker resolves it.
  const ok = bundle([cut("c1")], [overlay({ id: "a", speaker: "Rex" })]);
  assert.ok(!codes(lintCraft(ok, [])).includes("craft/tail-attribution"));
});

test("craft/tail-attribution resolves via a referenced character when the registry is present", () => {
  const registry: Character[] = [{ id: "mina", name: "Mina", lockstring: "..." }];
  const b = bundle([cut("c1", ["mina"])], [overlay({ id: "a", speaker: "" })]);
  assert.ok(!codes(lintCraft(b, registry)).includes("craft/tail-attribution"));
  // An empty speaker with no resolvable character still warns.
  const b2 = bundle([cut("c1", ["ghost"])], [overlay({ id: "a", speaker: "" })]);
  assert.ok(codes(lintCraft(b2, registry)).includes("craft/tail-attribution"));
});

test("craft/line-wrap warns on an over-long single line", () => {
  const b = bundle(
    [cut("c1")],
    [overlay({ id: "a", text: "antidisestablishmentarianism", geometry: WIDE })],
  );
  assert.ok(codes(lintCraft(b, [])).includes("craft/line-wrap"));
});

test("craft/line-wrap warns when text wraps to more than four lines", () => {
  const b = bundle(
    [cut("c1")],
    [overlay({ id: "a", text: "one two three four five six seven eight", geometry: NARROW })],
  );
  assert.ok(codes(lintCraft(b, [])).includes("craft/line-wrap"));
});

test("craft/all-caps-runon flags a long all-caps line (info)", () => {
  const b = bundle([cut("c1")], [overlay({ id: "a", text: "STOPRIGHTTHEREYOU", geometry: WIDE })]);
  const found = lintCraft(b, []).find((f) => f.code === "craft/all-caps-runon");
  assert.ok(found);
  assert.equal(found.severity, "info");
});

test("craft/narration-fragment suggests splitting a long narration (info)", () => {
  const words = Array.from({ length: 35 }, (_, i) => `w${i}`).join(" ");
  const b = bundle(
    [cut("c1")],
    [overlay({ id: "n", kind: "narration", speaker: "", text: words, geometry: WIDE })],
  );
  const found = lintCraft(b, []).find((f) => f.code === "craft/narration-fragment");
  assert.ok(found);
  assert.equal(found.severity, "info");
});

test("lintCraft is deterministic for the same inputs", () => {
  const b = bundle(
    [cut("c1")],
    [overlay({ id: "a", speaker: "" }), overlay({ id: "b", text: "ok" })],
  );
  assert.deepEqual(lintCraft(b, []), lintCraft(b, []));
});
