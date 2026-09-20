// A pack's transition vocabulary (#236): which kinds of gap a work puts between
// its cuts, in what proportion, at what heights.
//
// The load-bearing test here is the first one. This measurement reads the
// DECLARED transition type rather than re-deriving it from the composed page,
// and the only way to show that is a pair of episodes whose pages are
// byte-identical and whose vocabularies are not. A pixel classifier cannot tell
// those two apart at any threshold; the declaration can, exactly.
//
// Everything else pins one claim each: which transitions count as gaps, whose
// height is measured, how a multi-kind entry pools, and which way each way of
// writing a bad vocabulary is refused.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { buildInitialProject, writeProject } from "@toony/project-io";
import {
  type EpisodeBundle,
  type SequenceItem,
  STANDARD_CANVAS_WIDTH_PX,
  type Transition,
  type TransitionType,
} from "@toony/schema";
import {
  asCraftBand,
  type CraftBand,
  type CraftMeasurement,
  compareToCraftBand,
  compareToTransitionVocabulary,
  measureEpisodeCraft,
  measureTransitionMix,
  type TransitionVocabularyEntry,
  validateCraftBandValue,
} from "../craft.js";
import { encodeCanvas } from "../encode.js";
import { stitchEpisode } from "../targets.js";

const REFERENCE = STANDARD_CANVAS_WIDTH_PX;

let workdir: string;

before(async () => {
  workdir = await mkdtemp(join(tmpdir(), "toony-vocab-"));
});

after(async () => {
  await rm(workdir, { recursive: true, force: true });
});

/** One transition record. `extra` carries the fields a kind needs to render. */
function transition(
  id: string,
  type: TransitionType,
  gutterHeight: number,
  extra: Partial<Transition> = {},
): Transition {
  return {
    id,
    type,
    gutterHeight,
    text: null,
    sfx: null,
    agentNote: null,
    humanNote: null,
    image: null,
    reviewStatus: "draft",
    ...extra,
  };
}

/** An episode bundle whose cuts and transitions alternate, cut first. */
function bundleOf(transitions: Transition[]): EpisodeBundle {
  const sequence: SequenceItem[] = [];
  const cuts = [];
  for (let i = 0; i <= transitions.length; i++) {
    const id = `cut-${String(i + 1).padStart(3, "0")}`;
    cuts.push({ id, image: { clean: null, final: null }, imagePrompt: "", negativePrompt: "" });
    sequence.push({ type: "cut" as const, id });
    const next = transitions[i];
    if (next !== undefined) sequence.push({ type: "transition" as const, id: next.id });
  }
  return {
    episode: { schemaVersion: 1, id: "ep-001", title: "Vocabulary", sequence },
    cuts,
    transitions,
    lettering: [],
  };
}

/** Write a project whose one episode carries `transitions` and art-less cuts. */
async function writeEpisode(name: string, transitions: Transition[]): Promise<string> {
  const root = join(workdir, name);
  const project = buildInitialProject(name);
  const bundle = project.episodes[0];
  if (!bundle) throw new Error("no episode in the initial project");
  const built = bundleOf(transitions);
  bundle.episode.sequence = built.episode.sequence;
  bundle.cuts = built.cuts;
  bundle.transitions = built.transitions;
  bundle.lettering = [];
  await writeProject(root, project);
  return root;
}

// --- The declaration is what is read ----------------------------------------

/**
 * Two vocabularies that compose to the same pixels.
 *
 * `void` fills with `#0a0a0a` by default and a `color_field` authored at that
 * colour fills with the same; `narration_card` and `dialogue_card` are the same
 * dark panel with the same words anchored the same way. So these two episodes
 * differ in every declared kind and in nothing a row scanner can see.
 */
const CARD_TEXT = "the same words in both";
const VOID_FILL = "#0a0a0a";

const DECLARED_A: Transition[] = [
  transition("tr-001", "void", 300),
  transition("tr-002", "narration_card", 220, {
    text: CARD_TEXT,
    textAlign: "center",
    verticalAlign: "middle",
  }),
];

const DECLARED_B: Transition[] = [
  transition("tr-001", "color_field", 300, { color: VOID_FILL }),
  transition("tr-002", "dialogue_card", 220, {
    text: CARD_TEXT,
    textAlign: "center",
    verticalAlign: "middle",
  }),
];

test("the vocabulary is read from the declaration, on a page pixels cannot tell apart", async () => {
  const a = await writeEpisode("declared-a", DECLARED_A);
  const b = await writeEpisode("declared-b", DECLARED_B);

  // First the control: the two composed pages are the same bytes. Without this
  // the test would only show that two different pages measure differently,
  // which is the claim a page-derived classifier also makes.
  const digest = async (root: string): Promise<string> => {
    const { canvas } = await stitchEpisode(root, "ep-001", 600);
    return createHash("sha256").update(encodeCanvas(canvas, "png")).digest("hex");
  };
  assert.equal(await digest(a), await digest(b), "the two pages must be byte-identical");

  const measuredA = await measureEpisodeCraft(a, "ep-001", { width: 600 });
  const measuredB = await measureEpisodeCraft(b, "ep-001", { width: 600 });

  // Same page, so every metric read off pixels agrees.
  assert.deepEqual(measuredA.metrics, measuredB.metrics);
  // And the vocabularies are completely disjoint.
  assert.deepEqual(
    measuredA.transitions.kinds.map((kind) => kind.kind),
    ["void", "narration_card"],
  );
  assert.deepEqual(
    measuredB.transitions.kinds.map((kind) => kind.kind),
    ["color_field", "dialogue_card"],
  );
  // The heights agree, because the heights ARE a property of the page; only
  // the names differ.
  assert.deepEqual(
    measuredA.transitions.kinds.map((kind) => kind.heightMedian),
    measuredB.transitions.kinds.map((kind) => kind.heightMedian),
  );
});

test("a vocabulary separates the two pages a band's own metrics cannot", async () => {
  const band: CraftBand = {
    bandFormat: 1,
    metrics: { gutterRatio: { min: 0, max: 1 } },
    transitionVocabulary: [{ kinds: ["void"], share: { min: 0.5, max: 0.5 } }],
  };
  const a = await measureEpisodeCraft(join(workdir, "declared-a"), "ep-001", { width: 600 });
  const b = await measureEpisodeCraft(join(workdir, "declared-b"), "ep-001", { width: 600 });
  assert.equal(compareToCraftBand(a, band).inBand, true);
  assert.equal(compareToCraftBand(b, band).inBand, false);
  // The metric the band also grades is identical on both, so the vocabulary is
  // the only thing that moved the verdict.
  assert.deepEqual(compareToCraftBand(a, band).metrics, compareToCraftBand(b, band).metrics);
});

// --- What counts, and what is measured --------------------------------------

test("the measured height is the height the band OCCUPIES, not the number authored", () => {
  // A card is floored at a tenth of the column so its text stays legible, so
  // this one draws at 0.1 though it was authored at 0.01.
  const floored = Math.round(REFERENCE * 0.01);
  const mix = measureTransitionMix(
    bundleOf([
      transition("tr-001", "narration_card", floored, { text: "tiny" }),
      transition("tr-002", "gutter", Math.round(REFERENCE * 0.3)),
    ]),
    REFERENCE,
  );
  assert.deepEqual(
    mix.kinds.map((kind) => [kind.kind, kind.heightMedian]),
    [
      ["gutter", 0.3],
      ["narration_card", 0.1],
    ],
  );
});

test("a transition that draws no band at all is reported, and is not a gap", () => {
  const mix = measureTransitionMix(
    bundleOf([
      transition("tr-001", "gutter", 0),
      transition("tr-002", "gutter", 200),
      transition("tr-003", "void", 200),
    ]),
    REFERENCE,
  );
  assert.equal(mix.gaps, 2);
  assert.equal(mix.undrawn, 1);
  // The zero-height gutter is not in the denominator: the two drawn gaps split
  // the episode evenly rather than taking a third each.
  assert.deepEqual(
    mix.kinds.map((kind) => [kind.kind, kind.count, kind.share]),
    [
      ["gutter", 1, 0.5],
      ["void", 1, 0.5],
    ],
  );
});

test("a transition the reading sequence never reaches is not on the page", () => {
  const bundle = bundleOf([transition("tr-001", "gutter", 200)]);
  bundle.transitions.push(transition("tr-002", "void", 400));
  const mix = measureTransitionMix(bundle, REFERENCE);
  assert.equal(mix.gaps, 1);
  assert.deepEqual(
    mix.kinds.map((kind) => kind.kind),
    ["gutter"],
  );
});

test("the mix does not move with the export width", async () => {
  const root = await writeEpisode("width-sweep", [
    transition("tr-001", "gutter", 240),
    transition("tr-002", "void", 360),
    transition("tr-003", "gutter", 300),
  ]);
  const sweep: CraftMeasurement["transitions"][] = [];
  for (const width of [400, 600, 900, 1600]) {
    sweep.push((await measureEpisodeCraft(root, "ep-001", { width })).transitions);
  }
  for (const measured of sweep) assert.deepEqual(measured, sweep[0]);
  assert.deepEqual(
    sweep[0]?.kinds.map((kind) => kind.heightMedian),
    [0.375, 0.45],
  );
});

// --- Grading ----------------------------------------------------------------

/** A mix built from declared records, for the comparison tests. */
function mixOf(...kinds: [TransitionType, number][]) {
  return measureTransitionMix(
    bundleOf(
      kinds.map(([type, height], index) =>
        transition(`tr-${String(index + 1).padStart(3, "0")}`, type, height, {
          text: type.endsWith("_card") ? "line" : null,
        }),
      ),
    ),
    REFERENCE,
  );
}

test("an entry's share is a share of ALL the episode's gaps, named or not", () => {
  // Four gaps; the entry claims one kind, which takes one of them. A share over
  // only the kinds the band happened to name would read 1.0 here.
  const mix = mixOf(["gutter", 200], ["gutter", 200], ["gutter", 200], ["void", 200]);
  const [verdict] = compareToTransitionVocabulary(mix, [
    { kinds: ["void"], share: { min: 0, max: 1 } },
  ]);
  assert.equal(verdict?.count, 1);
  assert.equal(verdict?.share.value, 0.25);
});

test("a multi-kind entry pools its gaps rather than averaging its kinds", () => {
  // `gutter` runs short three times, `void` runs long once. Pooled, the median
  // is the short height; taken over the two per-kind medians it is the long one.
  const mix = mixOf(["gutter", 160], ["gutter", 160], ["gutter", 160], ["void", 720]);
  const [verdict] = compareToTransitionVocabulary(mix, [
    { kinds: ["gutter", "void"], share: { min: 0, max: 1 }, height: { min: 0, max: 10 } },
  ]);
  assert.equal(verdict?.count, 4);
  assert.equal(verdict?.height?.value, 0.2);
});

test("a height range with no gap of its kinds grades nothing, and says so", () => {
  const mix = mixOf(["gutter", 200], ["gutter", 200]);
  // Zero of this kind is allowed by the share range, so the entry passes and
  // the height reports no value rather than a verdict it has no basis for.
  const [allowed] = compareToTransitionVocabulary(mix, [
    { kinds: ["void"], share: { min: 0, max: 0.4 }, height: { min: 0.1, max: 0.2 } },
  ]);
  assert.equal(allowed?.height?.value, null);
  assert.equal(allowed?.inBand, true);

  // And when zero is NOT allowed, the share fails — the absent height never
  // rescues it, and never stands in for it either.
  const [required] = compareToTransitionVocabulary(mix, [
    { kinds: ["void"], share: { min: 0.1, max: 0.4 }, height: { min: 0.1, max: 0.2 } },
  ]);
  assert.equal(required?.share.inBand, false);
  assert.equal(required?.inBand, false);
});

test("an entry fails on either half, and the report says which", () => {
  const mix = mixOf(["gutter", 400], ["void", 400]);
  const entries: TransitionVocabularyEntry[] = [
    // Share in, height out.
    { kinds: ["gutter"], share: { min: 0.4, max: 0.6 }, height: { min: 0.9, max: 1 } },
    // Height in, share out.
    { kinds: ["void"], share: { min: 0.9, max: 1 }, height: { min: 0.4, max: 0.6 } },
  ];
  const verdicts = compareToTransitionVocabulary(mix, entries);
  assert.deepEqual(
    verdicts.map((verdict) => [verdict.share.inBand, verdict.height?.inBand, verdict.inBand]),
    [
      [true, false, false],
      [false, true, false],
    ],
  );
});

test("an out-of-band vocabulary fails a band whose every metric passes", () => {
  const mix = mixOf(["void", 400], ["void", 400]);
  const measured = { metrics: PASSING_METRICS, transitions: mix };
  const metricsOnly: CraftBand = { bandFormat: 1, metrics: { gutterRatio: { min: 0, max: 1 } } };
  assert.equal(compareToCraftBand(measured, metricsOnly).inBand, true);

  const withVocabulary: CraftBand = {
    ...metricsOnly,
    transitionVocabulary: [{ kinds: ["gutter"], share: { min: 0.4, max: 0.6 } }],
  };
  const report = compareToCraftBand(measured, withVocabulary);
  assert.equal(report.inBand, false);
  // Every graded metric still passed: only the vocabulary moved the verdict.
  assert.ok(report.metrics.every((verdict) => verdict.inBand));
  assert.deepEqual(report.transitions[0]?.kinds, ["gutter"]);
});

/** Metrics that sit inside the permissive bands used by the grading tests. */
const PASSING_METRICS = {
  gutterRatio: 0.4,
  gutterMedian: 0.3,
  panelHeightMedian: 1,
  panelHeightSpread: 0.1,
  panelsPerScreen: 2,
  gutterIntrusionsPerScreen: 0,
  panelInset: 0.2,
  valueMean: 120,
  valueSpread: 40,
  saturationMean: 0.2,
  hueBias: 200,
};

test("a band that declares no vocabulary grades exactly as it did before", () => {
  const band = asCraftBand({
    bandFormat: 1,
    name: "no vocabulary",
    metrics: { gutterRatio: { min: 0, max: 1 } },
  });
  // Narrowing must not invent the field, or a band read and written back would
  // gain a key it never declared.
  assert.ok(!Object.hasOwn(band, "transitionVocabulary"));
  const report = compareToCraftBand(
    { metrics: PASSING_METRICS, transitions: mixOf(["void", 400]) },
    band,
  );
  assert.equal(report.inBand, true);
  assert.deepEqual(report.transitions, []);
});

test("a declared vocabulary survives validation and narrowing intact", () => {
  const value = {
    bandFormat: 1,
    metrics: { gutterRatio: { min: 0, max: 1 } },
    transitionVocabulary: [
      { kinds: ["gutter"], share: { min: 0.4, max: 0.86 }, height: { min: 0.3, max: 0.53 } },
      { kinds: ["narration_card", "dialogue_card"], share: { min: 0.14, max: 0.25 } },
    ],
  };
  assert.deepEqual(validateCraftBandValue(value).issues, []);
  const band = asCraftBand(value);
  assert.deepEqual(band.transitionVocabulary, value.transitionVocabulary);
  // And it grades: the round-tripped band decides something.
  const report = compareToCraftBand(
    {
      metrics: PASSING_METRICS,
      transitions: mixOf(
        ["gutter", 400],
        ["gutter", 400],
        ["gutter", 400],
        ["narration_card", 500],
      ),
    },
    band,
  );
  assert.deepEqual(
    report.transitions.map((verdict) => [verdict.count, verdict.share.value, verdict.inBand]),
    [
      [3, 0.75, true],
      [1, 0.25, true],
    ],
  );
  // The gutter entry grades its height too, and the card entry declares none.
  assert.equal(report.transitions[0]?.height?.value, 0.5);
  assert.equal(report.transitions[1]?.height, null);
});

// --- Refusals ---------------------------------------------------------------

/** The codes a band value is rejected with. */
function bandCodes(vocabulary: unknown): string[] {
  const result = validateCraftBandValue({
    bandFormat: 1,
    metrics: { gutterRatio: { min: 0, max: 1 } },
    transitionVocabulary: vocabulary,
  });
  return result.issues.map((issue) => issue.code);
}

test("every way a vocabulary can be wrong is refused, not ignored", () => {
  assert.ok(bandCodes("gutter").includes("band.transitions.type"));
  assert.ok(bandCodes([]).includes("band.transitions.empty"));
  assert.ok(bandCodes(["gutter"]).includes("band.transitions.entry.type"));

  // A kind a pack invented. A pack selects from the core's vocabulary; this is
  // the rule that keeps a transition kind from becoming a pack's to define.
  assert.ok(
    bandCodes([{ kinds: ["slow_wipe"], share: { min: 0, max: 1 } }]).includes(
      "band.transitions.kind.unknown",
    ),
  );
  assert.ok(
    bandCodes([{ kinds: [], share: { min: 0, max: 1 } }]).includes("band.transitions.kinds"),
  );

  // One kind, one entry — twice over would count the same gaps twice.
  assert.ok(
    bandCodes([
      { kinds: ["void"], share: { min: 0, max: 1 } },
      { kinds: ["gutter", "void"], share: { min: 0, max: 1 } },
    ]).includes("band.transitions.kind.duplicate"),
  );
  assert.ok(
    bandCodes([{ kinds: ["void", "void"], share: { min: 0, max: 1 } }]).includes(
      "band.transitions.kind.duplicate",
    ),
  );

  // A height range with no share could be met by using none of its kinds.
  assert.ok(
    bandCodes([{ kinds: ["void"], height: { min: 0.1, max: 0.2 } }]).includes(
      "band.transitions.share.required",
    ),
  );
  assert.ok(bandCodes([{ kinds: ["void"], share: {} }]).includes("band.range.empty"));
  assert.ok(
    bandCodes([{ kinds: ["void"], share: { min: 0.4, max: 0.2 } }]).includes("band.range.order"),
  );
  // A share is a proportion and a height is a length: neither can be negative,
  // and a share above 1 is a target no episode can reach.
  assert.ok(
    bandCodes([{ kinds: ["void"], share: { min: 0, max: 1.5 } }]).includes(
      "band.transitions.share",
    ),
  );
  assert.ok(
    bandCodes([{ kinds: ["void"], share: { min: 0, max: 1 }, height: { min: -1 } }]).includes(
      "band.transitions.height",
    ),
  );

  // An unknown key inside an entry, like everywhere else in a band.
  assert.ok(
    bandCodes([{ kinds: ["void"], share: { min: 0, max: 1 }, weight: 2 }]).includes(
      "band.unexpected-field",
    ),
  );

  // Minimums that add past a whole episode: satisfiable entry by entry, and
  // impossible together.
  assert.ok(
    bandCodes([
      { kinds: ["gutter"], share: { min: 0.7, max: 1 } },
      { kinds: ["void"], share: { min: 0.4, max: 1 } },
    ]).includes("band.transitions.unsatisfiable"),
  );
  // The same two, tightened to fit, pass.
  assert.deepEqual(
    bandCodes([
      { kinds: ["gutter"], share: { min: 0.6, max: 1 } },
      { kinds: ["void"], share: { min: 0.4, max: 1 } },
    ]),
    [],
  );
});

test("a vocabulary carries no field that could name a source", () => {
  // The same boundary every other band field is held to: an entry is a list of
  // core kind names and two ranges, with nowhere for a title or a link.
  assert.ok(
    bandCodes([{ kinds: ["void"], share: { min: 0, max: 1 }, name: "the work" }]).includes(
      "band.unexpected-field",
    ),
  );
  assert.ok(
    bandCodes([{ kinds: ["void"], share: { min: 0, max: 1 }, source: "x.example" }]).includes(
      "band.unexpected-field",
    ),
  );
});
