// `panelInset` is a property of the page, not of which side the dialogue sits
// on (#255).
//
// The art here is SYNTHETIC: flat rectangles drawn in this file, no image
// provider and no generated art. These tests read geometry, and a drawn
// rectangle carries exactly as much geometry as a drawing does — what they need
// from the art is a reserved flat band on a known side, which is easier to
// state in rectangles than to ask a model for.
//
// Two rules the assertions below are built on, both learned the expensive way:
//
//   The instrument is checked before the conclusion. A mirror pair is asserted
//   to be an EXACT horizontal mirror, pixel for pixel, before any measurement of
//   it is compared — "both sides agree" on a pair that is not a mirror agrees
//   about nothing.
//
//   Equality is anchored to something outside itself. The mirrored pair is also
//   checked against the inset the fixture AUTHORED, so the two sides cannot pass
//   by both reading zero, which is precisely how the old rule failed.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import { buildInitialProject, writeProject } from "@toony/project-io";
import type { Cut, SequenceItem, Transition } from "@toony/schema";
import { type CraftMeasurement, type CraftMetricName, measureEpisodeCraft } from "../craft.js";
import { stitchEpisode } from "../targets.js";

/** Source width of one cut's art, in px, before it is scaled to the column. */
const ART_WIDTH = 480;

/** Render column. 600 / 480 is a whole 1.25, so an authored margin is exact. */
const WIDTH = 600;

const CUT_HEIGHTS = [150, 210, 130, 260, 170, 230];
const GUTTER_HEIGHT = 200;

/** The reserved band, in source px: 96 of 480 is a fifth of the column. */
const BAND = 96;

/** The same band as a share of the width — what `panelInset` should report. */
const AUTHORED_INSET = BAND / ART_WIDTH;

interface Layout {
  /** Flat page margin on the left of the art, in source px. */
  left: number;
  /** Flat page margin on its right, in source px. */
  right: number;
  /** Flip the finished art horizontally, so the page becomes its own mirror. */
  mirror: boolean;
  /** An opaque element drawn over `[from, to)` source px — a bubble in the band. */
  bubble?: { from: number; to: number };
}

/**
 * One cut's art: a white page, a striped body between the two margins.
 *
 * The stripes matter. A row has to VARY across the width or the row rule reads
 * it as inter-panel space and there is no panel to measure the margins of, so
 * the body alternates two colours that are neither white nor near-white.
 */
function drawArt(height: number, layout: Layout): Uint8Array {
  const canvas = createCanvas(ART_WIDTH, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, ART_WIDTH, height);
  const stripe = 6;
  const bodyEnd = ART_WIDTH - layout.right;
  for (let x = layout.left; x < bodyEnd; x += stripe) {
    ctx.fillStyle = Math.floor(x / stripe) % 2 === 0 ? "#04060f" : "#5f8fff";
    ctx.fillRect(x, 0, Math.min(stripe, bodyEnd - x), height);
  }
  if (layout.bubble) {
    ctx.fillStyle = "#101010";
    const { from, to } = layout.bubble;
    ctx.fillRect(from, height * 0.25, to - from, height * 0.5);
  }
  if (!layout.mirror) return new Uint8Array(canvas.toBuffer("image/png"));
  const flipped = createCanvas(ART_WIDTH, height);
  const flipCtx = flipped.getContext("2d");
  flipCtx.translate(ART_WIDTH, 0);
  flipCtx.scale(-1, 1);
  flipCtx.drawImage(canvas, 0, 0);
  return new Uint8Array(flipped.toBuffer("image/png"));
}

function gutter(id: string): Transition {
  return {
    id,
    type: "gutter",
    gutterHeight: GUTTER_HEIGHT,
    text: null,
    sfx: null,
    agentNote: null,
    humanNote: null,
    image: null,
    reviewStatus: "draft",
  };
}

/**
 * Write one episode whose every cut carries the same margin layout.
 *
 * No lettering: the page must be a horizontal mirror of its pair, and an
 * overlay placed by the composer would have to be mirrored too.
 */
async function writeInsetProject(root: string, layout: Layout): Promise<void> {
  const project = buildInitialProject("Inset");
  const bundle = project.episodes[0];
  if (!bundle) throw new Error("fixture missing episode");
  const cuts: Cut[] = [];
  const transitions: Transition[] = [];
  const sequence: SequenceItem[] = [];
  CUT_HEIGHTS.forEach((_, index) => {
    const id = `cut-${String(index + 1).padStart(3, "0")}`;
    cuts.push({
      id,
      image: { clean: `episodes/ep-001/assets/clean/${id}.png`, final: null },
      imagePrompt: "",
      negativePrompt: "",
    });
    if (index > 0) {
      const transitionId = `tr-${String(index).padStart(3, "0")}`;
      transitions.push(gutter(transitionId));
      sequence.push({ type: "transition", id: transitionId });
    }
    sequence.push({ type: "cut", id });
  });
  bundle.episode.sequence = sequence;
  bundle.cuts = cuts;
  bundle.transitions = transitions;
  bundle.lettering = [];
  await writeProject(root, project);

  const dir = join(root, "episodes/ep-001/assets/clean");
  await mkdir(dir, { recursive: true });
  for (let i = 0; i < CUT_HEIGHTS.length; i++) {
    const id = `cut-${String(i + 1).padStart(3, "0")}`;
    await writeFile(join(dir, `${id}.png`), drawArt(CUT_HEIGHTS[i] as number, layout));
  }
}

/** Every margin layout these tests measure, each one authored on purpose. */
const LAYOUTS = {
  /** A reserved band down the left of every cut, art against the page on the right. */
  bandLeft: { left: BAND, right: 0, mirror: false },
  /** The same page, flipped: the identical band, now on the right. */
  bandRight: { left: BAND, right: 0, mirror: true },
  /** Art inset in one page colour on both sides — the shape a reference page has. */
  insetBoth: { left: BAND / 2, right: BAND / 2, mirror: false },
  /** Art edge to edge: no margin at either side. */
  fullBleed: { left: 0, right: 0, mirror: false },
  /** Unequal margins in the SAME colour, and its mirror. */
  uneven: { left: BAND, right: BAND / 4, mirror: false },
  unevenMirror: { left: BAND, right: BAND / 4, mirror: true },
  /** Full-bleed art mirrored, to check the noise floor mirrors too. */
  fullBleedMirror: { left: 0, right: 0, mirror: true },
  /** The same band with a bubble floating in it, clear of the edge. */
  bubbleInBand: { left: BAND, right: 0, mirror: false, bubble: { from: 30, to: 70 } },
  /** The same bubble pushed flush against the edge. */
  bubbleAtEdge: { left: BAND, right: 0, mirror: false, bubble: { from: 0, to: 70 } },
} satisfies Record<string, Layout>;

type LayoutName = keyof typeof LAYOUTS;

let workdir: string;
const measured = new Map<LayoutName, CraftMeasurement>();

function metricsOf(name: LayoutName): CraftMeasurement["metrics"] {
  const found = measured.get(name);
  if (!found) throw new Error(`fixture ${name} was not measured`);
  return found.metrics;
}

function rootOf(name: LayoutName): string {
  return join(workdir, name);
}

before(async () => {
  workdir = await mkdtemp(join(tmpdir(), "toony-inset-"));
  for (const [name, layout] of Object.entries(LAYOUTS) as [LayoutName, Layout][]) {
    await writeInsetProject(rootOf(name), layout);
    measured.set(name, await measureEpisodeCraft(rootOf(name), "ep-001", { width: WIDTH }));
  }
});

after(async () => {
  await rm(workdir, { recursive: true, force: true });
});

/** Pixels of the composed page that are NOT the horizontal mirror of the other. */
async function mirrorMismatch(a: LayoutName, b: LayoutName): Promise<number> {
  const left = await stitchEpisode(rootOf(a), "ep-001", WIDTH);
  const right = await stitchEpisode(rootOf(b), "ep-001", WIDTH);
  assert.equal(left.width, right.width, `${a} and ${b} differ in width`);
  assert.equal(left.height, right.height, `${a} and ${b} differ in height`);
  const { width, height } = left;
  const one = left.canvas.getContext("2d").getImageData(0, 0, width, height).data;
  const other = right.canvas.getContext("2d").getImageData(0, 0, width, height).data;
  let mismatched = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const here = (y * width + x) * 4;
      const there = (y * width + (width - 1 - x)) * 4;
      for (let channel = 0; channel < 4; channel++) {
        if (one[here + channel] !== other[there + channel]) {
          mismatched++;
          break;
        }
      }
    }
  }
  return mismatched;
}

/** The three pairs every mirror claim below is made about. */
const MIRROR_PAIRS: [LayoutName, LayoutName][] = [
  ["bandLeft", "bandRight"],
  ["uneven", "unevenMirror"],
  ["fullBleed", "fullBleedMirror"],
];

test("each fixture pair composes to an exact horizontal mirror of the other", async () => {
  // Checked FIRST and on the composed page, because every mirror claim after
  // this one is worthless if the two pages are not actually mirrors. One pixel
  // of drift here and "they measure the same" would be a statement about a
  // tolerance rather than about the definition.
  for (const [a, b] of MIRROR_PAIRS) {
    assert.equal(await mirrorMismatch(a, b), 0, `${a} vs ${b}`);
  }

  // And the pages are not trivially symmetric in themselves, which would make
  // the mirror check pass without mirroring anything: the banded page is NOT
  // its own mirror, so the band really is on one side only.
  assert.notEqual(await mirrorMismatch("bandLeft", "bandLeft"), 0);
});

test("a page and its mirror image measure the same panelInset", () => {
  for (const [a, b] of MIRROR_PAIRS) {
    assert.equal(
      metricsOf(a).panelInset,
      metricsOf(b).panelInset,
      `${a} ${metricsOf(a).panelInset} vs ${b} ${metricsOf(b).panelInset}`,
    );
  }

  // Equal is not enough on its own: two zeros are equal. The banded pair has to
  // report the band it was AUTHORED with, from either side. The fixture reserves
  // a fifth of the column and the number lands within a stripe of it — the page
  // also carries the art's own flat run at the opposite edge, which is a
  // property of the art and not of the layout.
  const stripeShare = 8 / WIDTH;
  for (const name of ["bandLeft", "bandRight"] as LayoutName[]) {
    const inset = metricsOf(name).panelInset;
    assert.ok(
      Math.abs(inset - AUTHORED_INSET) <= stripeShare,
      `${name} measured ${inset}, authored ${AUTHORED_INSET}`,
    );
  }

  // The defect this replaces, stated as the number it would still produce: the
  // band on the RIGHT read 0.0117 where the same band on the left read 0.1983,
  // so a fixture that could not tell those apart would pass the equality above
  // and prove nothing. Both sides now clear the old wrong answer by 10x.
  assert.ok(
    metricsOf("bandRight").panelInset > 0.15,
    `bandRight ${metricsOf("bandRight").panelInset}`,
  );

  // A margin is per edge, never a demand that the two edges match: unequal
  // margins in one page colour report their SUM, not either one of them.
  const uneven = metricsOf("uneven").panelInset;
  assert.ok(Math.abs(uneven - (BAND + BAND / 4) / ART_WIDTH) <= stripeShare, `uneven ${uneven}`);
});

/**
 * Everything the run rule produces. None of it reads a row's margins, so all of
 * it must be identical across four pages that differ ONLY in their margins.
 */
const RUN_METRICS: readonly CraftMetricName[] = [
  "gutterRatio",
  "gutterMedian",
  "panelHeightMedian",
  "panelHeightSpread",
  "panelsPerScreen",
  "gutterIntrusionsPerScreen",
];

test("what counts as a flat run and as a panel does not read the margins", () => {
  // The margin rule decides one metric. The flat-run floors and the panel floor
  // decide which runs exist, and every other metric is read off that run set —
  // the failure mode #205 and #214 each hit once. Four pages with the same cuts
  // and the same gutters, margined three different ways plus one mirror, must
  // agree on all six.
  const layouts: LayoutName[] = ["bandLeft", "bandRight", "insetBoth", "fullBleed"];
  const reference = metricsOf("bandLeft");
  for (const name of layouts) {
    for (const metric of RUN_METRICS) {
      assert.equal(
        metricsOf(name)[metric],
        reference[metric],
        `${metric} on ${name}: ${metricsOf(name)[metric]} vs ${reference[metric]}`,
      );
    }
  }

  // The run set is worth holding fixed: these pages really do have gutters and
  // more than one panel, so the equalities above are not six zeros agreeing.
  assert.ok(reference.gutterRatio > 0.2, `gutterRatio ${reference.gutterRatio}`);
  assert.ok(reference.panelsPerScreen > 2, `panelsPerScreen ${reference.panelsPerScreen}`);

  // And the margins really do differ across those four pages — by most of the
  // reserved band — or the six equalities would be comparing a page with itself.
  const insets = layouts.map((name) => metricsOf(name).panelInset);
  assert.ok(
    Math.max(...insets) - Math.min(...insets) > AUTHORED_INSET * 0.75,
    `insets ${insets.join(", ")}`,
  );
});

test("a margin ends where the page stops being one colour, not where the art starts", () => {
  // The two cases a band author has to be able to tell apart, and the two
  // numbers docs/CRAFT_MEASURE.md quotes for them. Same reserved band in all
  // three; what differs is what is drawn in it.
  const empty = metricsOf("bandLeft").panelInset;
  const interrupted = metricsOf("bubbleInBand").panelInset;
  const anchored = metricsOf("bubbleAtEdge").panelInset;

  // A bubble clear of the edge ends the run AT the bubble, so most of the band
  // stops counting — the band is a fifth of the column and the bubble sits a
  // sixteenth of the way into it.
  assert.ok(interrupted < empty / 2, `${interrupted} vs ${empty}`);
  assert.ok(interrupted > 0, `${interrupted}`);

  // A bubble touching the edge is not an interruption: it becomes the colour
  // the run follows, and the empty band BEHIND it is what ends the run. So this
  // reads more than the interrupted case and less than the clear one, which no
  // rule that simply skipped drawn elements could produce.
  assert.ok(
    anchored > interrupted && anchored < empty,
    `edge-anchored ${anchored}, interrupted ${interrupted}, empty ${empty}`,
  );
});

test("the colour trim is still anchored on the left-hand pixel, and it shows", () => {
  // NOT fixed here, and pinned so it cannot drift unnoticed. `sampleColor`
  // keeps the left-anchored pair `rowMargins` carried before #255, because
  // every colour range in every shipped band was measured through it. The cost
  // is visible on this exact pair: identical art, mirrored, and the page whose
  // reserved band sits on the RIGHT averages that band into its palette.
  const left = metricsOf("bandLeft");
  const right = metricsOf("bandRight");
  assert.ok(
    (right.valueMean as number) > (left.valueMean as number) * 1.3,
    `valueMean ${left.valueMean} with the band left vs ${right.valueMean} with it right`,
  );
  // Changing this is a colour re-basing with its own evidence to gather. When
  // that happens, this test is the one that has to be rewritten on purpose.
});

/** The repository root, found from this compiled test file. */
function repositoryRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("repository root not found from the test file");
}

/**
 * Every metric of `examples/dead-air`, measured on adaf021 — the commit before
 * this change — at a 600px column and the default aspect.
 *
 * Read off the shipped code, not off the new code, so this is a claim about
 * what the change did rather than a snapshot of what it does. `panelInset` is
 * deliberately absent: it is the one number that was allowed to move.
 */
const DEAD_AIR_BEFORE: Partial<Record<CraftMetricName, number>> = {
  gutterRatio: 0.1968,
  gutterMedian: 0.305,
  panelHeightMedian: 1.3533,
  panelHeightSpread: 0.3981,
  panelsPerScreen: 1.36,
  gutterIntrusionsPerScreen: 0.85,
  valueMean: 85.2,
  valueSpread: 73.2,
  saturationMean: 0.263,
  hueBias: 159.2,
};

/** What `panelInset` read on the same page and the same commit. */
const DEAD_AIR_INSET_BEFORE = 0.055;

test("a real page measures as it did before #255 on every metric but panelInset", async () => {
  // The fixtures above are rectangles; this one is the repository's own example
  // episode, seven cuts of real art with real lettering. Ten numbers taken from
  // the previous commit, asserted here against the current code.
  const page = await measureEpisodeCraft(join(repositoryRoot(), "examples/dead-air"), "ep-001", {
    width: WIDTH,
  });
  for (const [metric, before] of Object.entries(DEAD_AIR_BEFORE)) {
    assert.equal(
      page.metrics[metric as CraftMetricName],
      before,
      `${metric} moved: ${page.metrics[metric as CraftMetricName]} vs ${before}`,
    );
  }

  // The one that moved, and by how much: the page gains the run its RIGHT edge
  // always had and the old rule could not see. It is small — far smaller than
  // the gap the defect opened — and it is stated in docs/CRAFT_MEASURE.md with
  // this number.
  const moved = page.metrics.panelInset - DEAD_AIR_INSET_BEFORE;
  assert.ok(moved > 0, `panelInset ${page.metrics.panelInset} vs ${DEAD_AIR_INSET_BEFORE}`);
  assert.ok(moved < 0.02, `panelInset moved by ${moved}`);
});
