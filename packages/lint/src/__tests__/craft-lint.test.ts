// Tests for the craft lints (#94): trigger + clean cases, deterministic.

import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  BubbleGeometry,
  Character,
  Cut,
  EpisodeBundle,
  LetteringOverlay,
  SequenceItem,
  ShotType,
  Transition,
  TransitionType,
} from "@toony/schema";
import { lintCraft, RHYTHM_RUN_MAX, TRANSITION_MONOTONY_RUN_MAX } from "../craft-lint.js";
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

// --- Rhythm monotony (#100) -------------------------------------------------

function shotCut(id: string, shotType?: ShotType): Cut {
  return {
    id,
    image: null,
    imagePrompt: "",
    negativePrompt: "",
    ...(shotType ? { shotType } : {}),
  };
}

function transition(id: string, type: TransitionType): Transition {
  return {
    id,
    type,
    gutterHeight: 48,
    text: null,
    sfx: null,
    agentNote: null,
    humanNote: null,
    image: null,
    reviewStatus: "draft",
  };
}

/**
 * Build a bundle from an ordered list of shotTypes (null = unclassified cut).
 * `between[i]`, when set, inserts a transition of that type between cut i and i+1.
 */
function rhythmBundle(
  shots: Array<ShotType | null>,
  between: Array<TransitionType | null> = [],
): EpisodeBundle {
  const cuts: Cut[] = shots.map((s, i) => shotCut(`c${i}`, s ?? undefined));
  const transitions: Transition[] = [];
  const sequence: SequenceItem[] = [];
  shots.forEach((_, i) => {
    sequence.push({ type: "cut", id: `c${i}` });
    const t = between[i];
    if (t && i < shots.length - 1) {
      const id = `t${i}`;
      transitions.push(transition(id, t));
      sequence.push({ type: "transition", id });
    }
  });
  return {
    episode: { schemaVersion: 1, id: "ep", title: "Ep", sequence },
    cuts,
    transitions,
    lettering: [],
  };
}

function rhythmFindings(b: EpisodeBundle): Finding[] {
  return lintCraft(b, []).filter((f) => f.code === "craft/rhythm-monotony");
}

test("craft/rhythm-monotony warns on a run of >= RHYTHM_RUN_MAX same-shotType cuts", () => {
  const b = rhythmBundle(Array.from({ length: RHYTHM_RUN_MAX }, () => "medium" as ShotType));
  const found = rhythmFindings(b);
  assert.equal(found.length, 1);
  assert.equal(found[0]?.severity, "warning");
  // Payload: run length, the shotType, and the cut ids, targeted at the first cut.
  assert.equal(found[0]?.targetId, "c0");
  assert.match(found[0]?.message ?? "", new RegExp(`${RHYTHM_RUN_MAX} consecutive`));
  assert.match(found[0]?.message ?? "", /medium/);
  for (let i = 0; i < RHYTHM_RUN_MAX; i++) {
    assert.match(found[0]?.message ?? "", new RegExp(`c${i}`));
  }
});

test("craft/rhythm-monotony is clean just below the threshold", () => {
  const b = rhythmBundle(Array.from({ length: RHYTHM_RUN_MAX - 1 }, () => "close_up" as ShotType));
  assert.deepEqual(rhythmFindings(b), []);
});

test("craft/rhythm-monotony is clean on a varied episode", () => {
  const b = rhythmBundle([
    "establishing_wide",
    "close_up",
    "medium",
    "impact_splash",
    "small_centered",
  ]);
  assert.deepEqual(rhythmFindings(b), []);
});

test("a different shotType resets the run", () => {
  // 3 medium, one close_up, 3 medium → no run reaches 4.
  const b = rhythmBundle(["medium", "medium", "medium", "close_up", "medium", "medium", "medium"]);
  assert.deepEqual(rhythmFindings(b), []);
});

test("a non-gutter transition between same-shotType cuts resets the run", () => {
  // 4 medium cuts, but a scene-break after c1 splits the run into 2 + 2.
  const b = rhythmBundle(["medium", "medium", "medium", "medium"], [null, "scene-break", null]);
  assert.deepEqual(rhythmFindings(b), []);
});

test("a plain gutter transition does NOT reset the run", () => {
  // Same 4 medium cuts with gutters between them → still one run of 4.
  const b = rhythmBundle(["medium", "medium", "medium", "medium"], ["gutter", "gutter", "gutter"]);
  assert.equal(rhythmFindings(b).length, 1);
});

test("an unclassified cut (no shotType) breaks the run (graceful degrade)", () => {
  // Would be 4 medium, but the absent-shotType cut splits it into 2 + 2.
  const b = rhythmBundle(["medium", "medium", null, "medium", "medium"]);
  assert.deepEqual(rhythmFindings(b), []);
  // And a fully unclassified episode never crashes or fires.
  const none = rhythmBundle([null, null, null, null, null]);
  assert.deepEqual(rhythmFindings(none), []);
});

test("a run that resumes after a break still fires when long enough", () => {
  // null breaks, then a fresh run of RHYTHM_RUN_MAX impact_splash cuts triggers.
  const b = rhythmBundle([
    "medium",
    null,
    ...Array.from({ length: RHYTHM_RUN_MAX }, () => "impact_splash" as ShotType),
  ]);
  const found = rhythmFindings(b);
  assert.equal(found.length, 1);
  assert.equal(found[0]?.targetId, "c2");
});

test("craft/rhythm-monotony is deterministic", () => {
  const b = rhythmBundle(["medium", "medium", "medium", "medium"], ["gutter", "gutter", "gutter"]);
  assert.deepEqual(lintCraft(b, []), lintCraft(b, []));
});

// --- v4 transition lints (#116) ---------------------------------------------

interface TrSpec {
  type: TransitionType;
  gutterHeight: number;
  color?: string;
}

/** Build a bundle whose transitions have the given type/height, interleaved with cuts. */
function panelBundle(specs: TrSpec[]): EpisodeBundle {
  const cuts: Cut[] = Array.from({ length: specs.length + 1 }, (_, i) => shotCut(`c${i}`));
  const transitions: Transition[] = specs.map((s, i) => ({
    ...transition(`t${i}`, s.type),
    gutterHeight: s.gutterHeight,
    ...(s.color ? { color: s.color } : {}),
  }));
  const sequence: SequenceItem[] = [];
  cuts.forEach((c, i) => {
    sequence.push({ type: "cut", id: c.id });
    if (i < transitions.length) sequence.push({ type: "transition", id: `t${i}` });
  });
  return {
    episode: { schemaVersion: 1, id: "ep", title: "Ep", sequence },
    cuts,
    transitions,
    lettering: [],
  };
}

const monotony = (b: EpisodeBundle) =>
  lintCraft(b, []).filter((f) => f.code === "craft/transition-monotony");
const panelSlice = (b: EpisodeBundle) =>
  lintCraft(b, []).filter((f) => f.code === "craft/panel-slice");

test("craft/transition-monotony warns on >= RUN_MAX near-identical transition heights", () => {
  const b = panelBundle(
    Array.from({ length: TRANSITION_MONOTONY_RUN_MAX }, () => ({
      type: "gutter" as const,
      gutterHeight: 100,
    })),
  );
  const found = monotony(b);
  assert.equal(found.length, 1);
  assert.equal(found[0]?.severity, "warning");
  assert.equal(found[0]?.targetId, "t0");
  assert.match(found[0]?.message ?? "", new RegExp(`${TRANSITION_MONOTONY_RUN_MAX} consecutive`));
});

test("craft/transition-monotony groups heights within the tolerance band", () => {
  // 100, 108, 95, 104 are all within ±12 of the run's first (100) → run of 4.
  const within = panelBundle([
    { type: "gutter", gutterHeight: 100 },
    { type: "gutter", gutterHeight: 108 },
    { type: "gutter", gutterHeight: 95 },
    { type: "gutter", gutterHeight: 104 },
  ]);
  assert.equal(monotony(within).length, 1);
  // Exactly at tolerance (±12) still groups; one past it resets.
  const edge = panelBundle([
    { type: "gutter", gutterHeight: 100 },
    { type: "gutter", gutterHeight: 112 }, // diff 12 → grouped
    { type: "gutter", gutterHeight: 100 },
    { type: "gutter", gutterHeight: 113 }, // diff 13 from 100 → breaks
  ]);
  assert.equal(monotony(edge).length, 0, "13px from ref breaks the run");
});

test("craft/transition-monotony is clean below threshold and on varied heights", () => {
  assert.deepEqual(
    monotony(
      panelBundle([
        { type: "gutter", gutterHeight: 100 },
        { type: "gutter", gutterHeight: 100 },
        { type: "gutter", gutterHeight: 100 },
      ]),
    ),
    [],
  );
  // Clock-ladder variation resets every step.
  assert.deepEqual(
    monotony(
      panelBundle([
        { type: "gutter", gutterHeight: 120 },
        { type: "gutter", gutterHeight: 250 },
        { type: "gutter", gutterHeight: 500 },
        { type: "gutter", gutterHeight: 120 },
        { type: "gutter", gutterHeight: 700 },
      ]),
    ),
    [],
  );
});

test("craft/panel-slice flags a no-art panel taller than the fold (info)", () => {
  const tall = panelBundle([{ type: "void", gutterHeight: 1400 }]);
  const found = panelSlice(tall);
  assert.equal(found.length, 1);
  assert.equal(found[0]?.severity, "info");
  assert.equal(found[0]?.targetId, "t0");
  // A short panel and a tall PLAIN gutter (not a no-art panel) are clean.
  assert.deepEqual(panelSlice(panelBundle([{ type: "void", gutterHeight: 1000 }])), []);
  assert.deepEqual(panelSlice(panelBundle([{ type: "gutter", gutterHeight: 1400 }])), []);
});

test("craft/transition-monotony is deterministic", () => {
  const b = panelBundle(
    Array.from({ length: 4 }, () => ({ type: "gutter" as const, gutterHeight: 100 })),
  );
  assert.deepEqual(lintCraft(b, []), lintCraft(b, []));
});

test("no false positives on the existing example episodes (#116 AC)", () => {
  // Reconstructed transition sequences from examples/last-train + examples/dead-air.
  const lastTrain = panelBundle([
    { type: "gutter", gutterHeight: 64 },
    { type: "scene-break", gutterHeight: 140 },
    { type: "fade", gutterHeight: 120 },
    { type: "gutter", gutterHeight: 88 },
    { type: "scene-break", gutterHeight: 140 },
  ]);
  const deadAir = panelBundle([
    { type: "title_card", gutterHeight: 160 },
    { type: "gutter", gutterHeight: 72 },
    { type: "scene-break", gutterHeight: 140 },
    { type: "palette_shift", gutterHeight: 120 },
    { type: "black_band", gutterHeight: 150 },
    { type: "fade", gutterHeight: 120 },
  ]);
  for (const b of [lastTrain, deadAir]) {
    assert.deepEqual(monotony(b), [], "no transition-monotony false positive");
    assert.deepEqual(panelSlice(b), [], "no panel-slice false positive");
  }
});
