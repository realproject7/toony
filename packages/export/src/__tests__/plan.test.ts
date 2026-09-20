// The plan-level grade (#234).
//
// The load-bearing test here is AGREEMENT WITH A RENDER, on episodes whose art
// is actually composed and read back. A plan grade that cannot be trusted to say
// what `toony measure` will say is worse than no plan grade, because it is the
// cheap number and the cheap number is the one that gets believed.
//
// The two fixtures make the agreement falsifiable rather than tautological:
//
//   calm     — art that is striped edge to edge, so EVERY art row varies and
//              every gutter row is flat. The declared page and the composed page
//              classify identically, and all five metrics must match exactly.
//   restless — the same geometry with a flat empty band inside each cut's art.
//              Those rows are art the page reads as empty space, which is the one
//              thing a declaration cannot know, so the numbers must MOVE — and in
//              a stated direction, by an amount the flat art rows account for.
//
// If the plan side were computing the metrics from the rendered page, the second
// fixture would agree too. If it were computing them from a second height rule,
// the first would not.

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { buildInitialProject, encodeYaml, writeProject } from "@toony/project-io";
import type { Cut, SequenceItem, Transition } from "@toony/schema";
import { CALM, RESTLESS, writeRhythmProject } from "../__fixtures__/craft.js";
import {
  asCraftBand,
  CRAFT_METRIC_NAMES,
  type CraftBand,
  type CraftMeasurement,
  measureEpisodeCraft,
  PAGE_GEOMETRY_METRIC_NAMES,
  validateCraftBandValue,
} from "../craft.js";
import {
  asEpisodePlan,
  comparePlanToCraftBand,
  type EpisodePlan,
  measureEpisodePlan,
  measurePlan,
  PLAN_UNCHECKED_METRICS,
  type PlanMeasurement,
  validateEpisodePlanValue,
} from "../plan.js";

const WIDTH = 600;
/** The art both fixtures are drawn at, so a beat can declare their shape. */
const ART_WIDTH = 480;

let workdir: string;
let calmRoot: string;
let restlessRoot: string;
let calmRendered: CraftMeasurement;
let calmPlanned: PlanMeasurement;
let restlessRendered: CraftMeasurement;
let restlessPlanned: PlanMeasurement;

before(async () => {
  workdir = await mkdtemp(join(tmpdir(), "toony-plan-"));
  calmRoot = join(workdir, "calm");
  restlessRoot = join(workdir, "restless");
  await writeRhythmProject(calmRoot, CALM);
  await writeRhythmProject(restlessRoot, RESTLESS);
  calmRendered = await measureEpisodeCraft(calmRoot, "ep-001", { width: WIDTH });
  calmPlanned = await measureEpisodePlan(calmRoot, "ep-001", { width: WIDTH });
  restlessRendered = await measureEpisodeCraft(restlessRoot, "ep-001", { width: WIDTH });
  restlessPlanned = await measureEpisodePlan(restlessRoot, "ep-001", { width: WIDTH });
});

after(async () => {
  await rm(workdir, { recursive: true, force: true });
});

// --- Agreement with a render ------------------------------------------------

test("the planned page is the composed page, to the pixel", () => {
  // The whole plan-level grade rests on this: the heights it stacks are the
  // heights the canvas is created at. Asserted on both fixtures, whose art is
  // composed and measured in `before`, so a second height rule anywhere — a cut's
  // or a band's — fails here before any metric is compared.
  assert.equal(calmPlanned.height, calmRendered.height);
  assert.equal(restlessPlanned.height, restlessRendered.height);
  assert.equal(calmPlanned.cuts, calmRendered.cuts);
  assert.equal(restlessPlanned.cuts, restlessRendered.cuts);
});

test("art that is non-flat throughout plans EXACTLY as it renders", () => {
  for (const name of PAGE_GEOMETRY_METRIC_NAMES) {
    assert.equal(
      calmPlanned.metrics[name],
      calmRendered.metrics[name],
      `${name}: planned ${calmPlanned.metrics[name]} vs rendered ${calmRendered.metrics[name]}`,
    );
  }
});

test("flat rows inside the art move the numbers, and only in that direction", () => {
  // The restless fixture's art carries a flat empty band at the bottom of every
  // cut. The page reads those rows as inter-panel space; a declaration cannot.
  // So the render finds MORE gutter and SHORTER panels than the plan does, never
  // less — art can add empty space to a page and cannot take any away.
  const planned = restlessPlanned.metrics;
  const rendered = restlessRendered.metrics;
  assert.ok(
    rendered.gutterRatio > planned.gutterRatio,
    `gutterRatio: rendered ${rendered.gutterRatio} should exceed planned ${planned.gutterRatio}`,
  );
  assert.ok(
    rendered.panelHeightMedian < planned.panelHeightMedian,
    `panelHeightMedian: rendered ${rendered.panelHeightMedian} should be under planned ${planned.panelHeightMedian}`,
  );
  // And the difference is the flat art, not a mis-stacked page: the extra gutter
  // is entirely rows the plan placed inside a cut.
  const plannedGutterRows = Math.round(planned.gutterRatio * restlessPlanned.height);
  const renderedGutterRows = Math.round(rendered.gutterRatio * restlessRendered.height);
  assert.ok(renderedGutterRows - plannedGutterRows > 0);
  assert.ok(renderedGutterRows - plannedGutterRows < restlessRendered.height - plannedGutterRows);
});

test("the transition mix is the SAME answer before and after the art exists", () => {
  // The one half of a band that needs no pixels. Both sides call the same
  // function on the same declared records, and this asserts they reach it with
  // the same list — a plan that walked the record list instead of the reading
  // sequence would differ here.
  assert.deepEqual(calmPlanned.transitions, calmRendered.transitions);
  assert.deepEqual(restlessPlanned.transitions, restlessRendered.transitions);
});

test("the five metrics are shares of the width, so the column does not move them", async () => {
  // The same invariance the rendered measurement has (#214). A plan that divided
  // a run by the page height or the screen would fail here.
  const wide = await measureEpisodePlan(calmRoot, "ep-001", { width: 1200 });
  for (const name of PAGE_GEOMETRY_METRIC_NAMES) {
    assert.equal(wide.metrics[name], calmPlanned.metrics[name], name);
  }
  assert.notEqual(wide.height, calmPlanned.height);
});

// --- Beats ------------------------------------------------------------------

/** The calm fixture as BEATS: one beat, three cuts, one gap between them. */
const CALM_PLAN: EpisodePlan = {
  planFormat: 1,
  name: "Calm",
  referenceWidth: 800,
  beats: [
    {
      label: "one long held beat",
      cuts: CALM.cutHeights.length,
      panelAspect: (CALM.cutHeights[0] as number) / ART_WIDTH,
      gap: { type: "gutter", gutterHeight: CALM.gutterHeight },
    },
  ],
};

test("a structure stated as beats with lengths grades as the cut list it stands for", () => {
  // Three cuts written as ONE beat of length three. This is the claim the beat
  // format makes — that an episode's structure is a handful of beats rather than
  // a flat list — and it is worth nothing unless the beats resolve to the same
  // page. On the calm fixture that page is also the rendered one, so this ties
  // the beat format to a measured render through two steps that were each
  // asserted above.
  const planned = measurePlan(CALM_PLAN, { width: WIDTH });
  assert.equal(planned.height, calmRendered.height);
  assert.equal(planned.cuts, calmRendered.cuts);
  for (const name of PAGE_GEOMETRY_METRIC_NAMES) {
    assert.equal(planned.metrics[name], calmRendered.metrics[name], name);
  }
  assert.deepEqual(planned.transitions, calmRendered.transitions);
});

test("a real episode's shape fits: ~19 beats, ~100 panels, lengths 30x apart", () => {
  // The shape a contiguous capture of one measured episode actually has — around
  // a hundred panels in nineteen beats, whose lengths run from half a column
  // width to seventeen. A format sized for three acts, or one that assumed beats
  // are roughly the same size, would not carry this. Nothing here is a limit the
  // format imposes: each beat states its own length, its own shape and its own
  // spacing, and the report gives every length back rather than a median.
  const TYPICAL_GUTTER = 157; // ~0.196 column widths on an 800px reference
  const shape: [cuts: number, aspect: number][] = [
    [11, 1.4],
    [9, 1.6],
    [8, 1.2],
    [8, 0.9],
    [7, 1.5],
    [7, 1.1],
    [6, 2.2],
    [6, 0.8],
    [6, 1.3],
    [5, 1.7],
    [5, 0.7],
    [4, 2.4],
    [4, 1.0],
    [4, 0.6],
    [3, 1.9],
    [3, 1.2],
    [3, 0.5],
    [3, 2.6],
    [1, 0.5],
  ];
  const plan: EpisodePlan = {
    planFormat: 1,
    name: "an episode-sized structure",
    referenceWidth: 800,
    beats: shape.map(([cuts, panelAspect], index) => ({
      label: `beat ${index + 1}`,
      cuts,
      panelAspect,
      gap: { type: "gutter" as const, gutterHeight: TYPICAL_GUTTER },
      // A scene break between beats is an ordinary gutter at about twice the
      // episode's own median — a taller number in the SAME field, not a kind of
      // its own and not a field of its own.
      ...(index === 0 ? {} : { openWith: { type: "gutter" as const, gutterHeight: 314 } }),
    })),
  };
  assert.deepEqual(validateEpisodePlanValue(plan).issues, []);

  const measured = measurePlan(plan, { width: 800 });
  assert.equal(measured.beats?.length, 19);
  assert.equal(
    measured.cuts,
    shape.reduce((sum, [cuts]) => sum + cuts, 0),
  );
  assert.equal(measured.cuts, 103);

  const lengths = (measured.beats ?? []).map((beat) => beat.lengthInWidths);
  const shortest = Math.min(...lengths);
  const longest = Math.max(...lengths);
  assert.ok(shortest <= 0.6, `shortest beat ${shortest} should reach down to half a column width`);
  assert.ok(longest >= 17, `longest beat ${longest} should reach seventeen column widths`);
  assert.ok(
    longest / shortest >= 30,
    `beat lengths should span thirty fold, got ${longest / shortest}`,
  );
  // Every beat's own length is reported, not a summary of them.
  assert.equal(lengths.length, measured.beats?.length);

  // A break is found by HEIGHT, with no new schema: it is a `gutter` in the mix
  // like every other gutter, and it draws at twice the typical one.
  assert.deepEqual(
    measured.transitions.kinds.map((kind) => kind.kind),
    ["gutter"],
  );
  assert.equal(measured.transitions.gaps, 103 - 19 + 18);
});

test("a beat that opens on a gap puts that gap before its first cut", () => {
  const twoBeats = measurePlan(
    {
      planFormat: 1,
      referenceWidth: 800,
      beats: [
        { label: "open", cuts: 1, panelAspect: 1 },
        { label: "turn", cuts: 1, panelAspect: 1, openWith: { type: "void", gutterHeight: 200 } },
      ],
    },
    { width: 800 },
  );
  // Two 800px cuts and one 200px void between them.
  assert.equal(twoBeats.height, 800 + 200 + 800);
  assert.equal(twoBeats.cuts, 2);
  assert.equal(twoBeats.transitions.gaps, 1);
  assert.deepEqual(
    twoBeats.transitions.kinds.map((kind) => kind.kind),
    ["void"],
  );
});

test("a beat with no gap runs its cuts together, exactly as the page stacks them", () => {
  // Two cuts with nothing between them are ONE run on the composed page, because
  // nothing separates them. A plan that counted declarations instead of runs
  // would report two panels here and a panelsPerScreen twice the truth.
  const joined = measurePlan(
    {
      planFormat: 1,
      referenceWidth: 800,
      beats: [{ label: "unbroken", cuts: 2, panelAspect: 1 }],
    },
    { width: 800 },
  );
  assert.equal(joined.height, 1600);
  assert.equal(joined.metrics.panelHeightMedian, 2);
  assert.equal(joined.metrics.gutterRatio, 0);
});

test("a gap too short to be a reading pause merges its neighbours, as it does on the page", () => {
  // The run floor is 1.6% of the width — 12px at 800. A 6px gutter is a seam,
  // not a pause, and the composed page reads straight through it.
  const hairline = measurePlan(
    {
      planFormat: 1,
      referenceWidth: 800,
      beats: [
        { label: "seamed", cuts: 2, panelAspect: 1, gap: { type: "gutter", gutterHeight: 6 } },
      ],
    },
    { width: 800 },
  );
  assert.equal(hairline.height, 1606);
  assert.equal(hairline.metrics.gutterRatio, 0);
  assert.equal(hairline.metrics.panelHeightMedian, 2.0075);
  // It is still a DRAWN gap: the mix counts what the page draws, and 6px is drawn.
  assert.equal(hairline.transitions.gaps, 1);
});

test("a transition that draws no band contributes no region and is not a gap", () => {
  const zero = measurePlan(
    {
      planFormat: 1,
      referenceWidth: 800,
      beats: [{ label: "none", cuts: 2, panelAspect: 1, gap: { type: "gutter", gutterHeight: 0 } }],
    },
    { width: 800 },
  );
  assert.equal(zero.height, 1600);
  assert.equal(zero.transitions.gaps, 0);
  assert.equal(zero.transitions.undrawn, 1);
});

test("a card's legibility floor is the height a plan grades, not the number authored", () => {
  // A card draws no shorter than a tenth of the column whatever it was authored
  // at, and the plan stacks the drawn height, through the same resolver.
  const floored = measurePlan(
    {
      planFormat: 1,
      referenceWidth: 800,
      beats: [
        {
          label: "tiny card",
          cuts: 2,
          panelAspect: 1,
          gap: { type: "narration_card", gutterHeight: 8 },
        },
      ],
    },
    { width: 800 },
  );
  assert.equal(floored.height, 800 + 80 + 800);
});

// --- The shape a cut never declared -----------------------------------------

test("a cut with no declared shape is counted, not silently graded", async () => {
  const root = join(workdir, "undeclared");
  const project = buildInitialProject("Undeclared");
  const bundle = project.episodes[0];
  assert.ok(bundle);
  const cuts: Cut[] = [];
  const sequence: SequenceItem[] = [];
  for (let index = 0; index < 3; index++) {
    const id = `cut-${String(index + 1).padStart(3, "0")}`;
    // No `panelAspect`, and no art either: nothing on disk says what shape this
    // cut is, so the resolver falls back and the report has to say so.
    cuts.push({ id, image: null, imagePrompt: "", negativePrompt: "" });
    sequence.push({ type: "cut", id });
  }
  bundle.cuts = cuts;
  bundle.transitions = [];
  bundle.lettering = [];
  bundle.episode.sequence = sequence;
  await writeProject(root, project);

  const planned = await measureEpisodePlan(root, "ep-001", { width: 800 });
  assert.equal(planned.cuts, 3);
  assert.equal(planned.cutsWithoutDeclaredShape, 3);
  assert.equal(planned.fallbackAspect, 1.4);
  // Graded at the fallback, and the figure says so: 1.4 is the constant, not a
  // measurement of this pack.
  assert.equal(planned.metrics.panelHeightMedian, 4.2);
});

test("a declared shape is what is graded, even when the cut already has art", async () => {
  // The resolver is asked with NO image on purpose. The same episode therefore
  // plans identically before and after generation, which is the only way the
  // plan figure can be compared with the rendered one at all.
  const declared = await measureEpisodePlan(calmRoot, "ep-001", { width: WIDTH });
  assert.equal(declared.cutsWithoutDeclaredShape, 0);
  assert.equal(declared.metrics.panelHeightMedian, (CALM.cutHeights[0] as number) / ART_WIDTH);
});

// --- What a plan does not check ---------------------------------------------

test("checked and unchecked together are exactly the eleven metrics, with no overlap", () => {
  const checked = [...PAGE_GEOMETRY_METRIC_NAMES];
  const unchecked = PLAN_UNCHECKED_METRICS.map((entry) => entry.metric);
  assert.deepEqual([...checked, ...unchecked].sort(), [...CRAFT_METRIC_NAMES].sort());
  assert.equal(new Set([...checked, ...unchecked]).size, CRAFT_METRIC_NAMES.length);
  for (const entry of PLAN_UNCHECKED_METRICS) {
    assert.ok(entry.reason.length > 0, `${entry.metric} must say why`);
  }
});

test("every measurement carries the unchecked list, band or no band", () => {
  assert.equal(calmPlanned.unchecked.length, 6);
  assert.deepEqual(restlessPlanned.unchecked, calmPlanned.unchecked);
});

function bandOf(value: Record<string, unknown>): CraftBand {
  const result = validateCraftBandValue(value);
  assert.ok(result.valid, JSON.stringify(result.issues));
  return asCraftBand(value);
}

test("a band metric a plan cannot check is neither graded nor quietly dropped", () => {
  const band = bandOf({
    bandFormat: 1,
    name: "Mixed",
    metrics: {
      gutterRatio: { min: 0, max: 1 },
      valueMean: { max: 140 },
      panelInset: { min: 0.1, max: 0.2 },
    },
  });
  const report = comparePlanToCraftBand(calmPlanned, band);
  assert.deepEqual(
    report.metrics.map((verdict) => verdict.metric),
    ["gutterRatio"],
  );
  assert.deepEqual(
    report.unchecked.map((entry) => entry.metric),
    ["panelInset", "valueMean"],
  );
  // Every band metric is accounted for by one of the two lists.
  assert.equal(report.metrics.length + report.unchecked.length, 3);
});

test("a plan report carries no whole verdict to mistake for one", () => {
  const band = bandOf({
    bandFormat: 1,
    metrics: { gutterRatio: { min: 0, max: 1 }, valueMean: { max: 10 } },
  });
  const report = comparePlanToCraftBand(calmPlanned, band);
  // `valueMean` would fail on this page and the plan does not check it, so a
  // report with an `inBand` would be asserting something it never measured.
  assert.equal("inBand" in report, false);
  assert.equal(report.checkedInBand, true);
  assert.equal(report.unchecked.length, 1);
});

test("a metric a plan CAN check still fails its range", () => {
  const band = bandOf({ bandFormat: 1, metrics: { gutterRatio: { min: 0.9 } } });
  const report = comparePlanToCraftBand(calmPlanned, band);
  assert.equal(report.checkedInBand, false);
  assert.equal(report.metrics[0]?.inBand, false);
});

test("a transition vocabulary is graded in full, because a mix needs no pixels", () => {
  const band = bandOf({
    bandFormat: 1,
    metrics: { gutterRatio: { min: 0, max: 1 } },
    transitionVocabulary: [{ kinds: ["gutter"], share: { min: 0.9, max: 1 } }],
  });
  const planReport = comparePlanToCraftBand(calmPlanned, band);
  const renderedReport = comparePlanToCraftBand(
    { metrics: calmPlanned.metrics, transitions: calmRendered.transitions },
    band,
  );
  assert.deepEqual(planReport.transitions, renderedReport.transitions);
  assert.equal(planReport.transitions[0]?.inBand, true);
});

// --- Plan files -------------------------------------------------------------

function issues(value: unknown): string[] {
  const result = validateEpisodePlanValue(value);
  return result.issues.map((issue) => issue.code);
}

test("a valid plan validates, and YAML round-trips through the same shape", () => {
  assert.deepEqual(issues(CALM_PLAN), []);
  const parsed = JSON.parse(JSON.stringify(CALM_PLAN));
  assert.deepEqual(issues(parsed), []);
  assert.ok(encodeYaml(CALM_PLAN).includes("beats:"));
  assert.deepEqual(
    measurePlan(asEpisodePlan(parsed), { width: WIDTH }).metrics,
    measurePlan(CALM_PLAN, { width: WIDTH }).metrics,
  );
});

test("an unknown key is a rejection, so a typo cannot grade a beat on the fallback", () => {
  assert.deepEqual(issues({ ...CALM_PLAN, panelAspect: 1.4 }), ["plan.unknown-key"]);
  assert.deepEqual(issues({ ...CALM_PLAN, beats: [{ label: "x", cuts: 1, panelAspct: 1.4 }] }), [
    "plan.unknown-key",
  ]);
  assert.deepEqual(
    issues({
      ...CALM_PLAN,
      beats: [{ label: "x", cuts: 1, gap: { type: "gutter", gutterHeight: 10, color: "#000" } }],
    }),
    ["plan.unknown-key"],
  );
});

test("a plan states its format, its column, and at least one beat", () => {
  assert.deepEqual(issues({ ...CALM_PLAN, planFormat: 2 }), ["plan.format"]);
  assert.deepEqual(issues({ ...CALM_PLAN, referenceWidth: 0 }), ["plan.reference-width"]);
  assert.deepEqual(issues({ ...CALM_PLAN, beats: [] }), ["plan.beats"]);
  assert.deepEqual(issues("a plan"), ["plan.root"]);
});

test("a beat states a label and a length; a shape outside the schema's bounds is rejected", () => {
  assert.deepEqual(issues({ ...CALM_PLAN, beats: [{ cuts: 1 }] }), ["plan.beat-label"]);
  assert.deepEqual(issues({ ...CALM_PLAN, beats: [{ label: "x", cuts: 0 }] }), ["plan.beat-cuts"]);
  assert.deepEqual(issues({ ...CALM_PLAN, beats: [{ label: "x", cuts: 1.5 }] }), [
    "plan.beat-cuts",
  ]);
  assert.deepEqual(issues({ ...CALM_PLAN, beats: [{ label: "x", cuts: 1, panelAspect: 50 }] }), [
    "plan.beat-aspect",
  ]);
  assert.deepEqual(issues({ ...CALM_PLAN, beats: [{ label: "x", cuts: 1, panelAspect: "1.4" }] }), [
    "plan.beat-aspect",
  ]);
});

test("a gap states a kind from the vocabulary and a height in range", () => {
  const beat = (gap: unknown) => ({ ...CALM_PLAN, beats: [{ label: "x", cuts: 2, gap }] });
  assert.deepEqual(issues(beat({ type: "not-a-kind", gutterHeight: 10 })), ["plan.gap-type"]);
  assert.deepEqual(issues(beat({ type: "gutter", gutterHeight: -1 })), ["plan.gap-height"]);
  assert.deepEqual(issues(beat({ type: "gutter", gutterHeight: 10.5 })), ["plan.gap-height"]);
  assert.deepEqual(issues(beat("gutter")), ["plan.gap"]);
  assert.deepEqual(issues(beat({ type: "gutter", gutterHeight: 10 })), []);
});

test("a beat's opening gap is validated on the same terms as its internal one", () => {
  assert.deepEqual(
    issues({ ...CALM_PLAN, beats: [{ label: "x", cuts: 1, openWith: { type: "nope" } }] }),
    ["plan.gap-type", "plan.gap-height"],
  );
});

// --- The reading sequence, not the record list -------------------------------

test("cuts the sequence stacks with nothing between them are one run, as on the page", async () => {
  // Three cuts, one gap, and the gap is not in the middle. The composed page
  // reads the first two as a single uninterrupted run because nothing separates
  // them, so the plan must too — a plan that counted cut RECORDS would report
  // three panels where the page has two, and a panelsPerScreen half again too
  // high on every episode that stacks cuts.
  const root = join(workdir, "stacked");
  const project = buildInitialProject("Stacked");
  const bundle = project.episodes[0];
  assert.ok(bundle);
  const cut = (id: string): Cut => ({
    id,
    image: null,
    imagePrompt: "",
    negativePrompt: "",
    panelAspect: 1,
  });
  const gap: Transition = {
    id: "tr-001",
    type: "gutter",
    gutterHeight: 200,
    text: null,
    sfx: null,
    agentNote: null,
    humanNote: null,
    image: null,
    reviewStatus: "draft",
  };
  bundle.cuts = [cut("cut-001"), cut("cut-002"), cut("cut-003")];
  bundle.transitions = [gap];
  bundle.lettering = [];
  bundle.episode.sequence = [
    { type: "cut", id: "cut-001" },
    { type: "cut", id: "cut-002" },
    { type: "transition", id: "tr-001" },
    { type: "cut", id: "cut-003" },
  ];
  await writeProject(root, project);

  const planned = await measureEpisodePlan(root, "ep-001", { width: 800 });
  assert.equal(planned.cuts, 3);
  assert.equal(planned.height, 800 * 3 + 200);
  // Two runs: a 1600px one and an 800px one. The median is the upper of the two.
  assert.equal(planned.metrics.panelHeightMedian, 2);
  assert.equal(planned.metrics.panelsPerScreen, 1.23);

  // And the page agrees: an art-less cut composes a flat neutral stage, so this
  // one renders as all gutter — which is exactly why the note about cuts with no
  // art exists. The heights are what is compared here.
  const rendered = await measureEpisodeCraft(root, "ep-001", { width: 800 });
  assert.equal(rendered.height, planned.height);
});

test("planning an episode that does not exist fails with the export error code", async () => {
  await assert.rejects(
    () => measureEpisodePlan(calmRoot, "ep-999", { width: WIDTH }),
    (error: unknown) => (error as { code?: string }).code === "episode-not-found",
  );
});
