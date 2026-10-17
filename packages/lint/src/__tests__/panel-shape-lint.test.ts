// The declared-vs-rendered panel shape check (#260).

import assert from "node:assert/strict";
import { test } from "node:test";

import type { Cut, EpisodeBundle } from "@toony/schema";
import { encodePng, makeSolidRaster } from "../__fixtures__/images.js";
import { lintPanelShape, PANEL_ASPECT_TOLERANCE } from "../panel-shape-lint.js";

function bundle(cut: Cut): EpisodeBundle {
  return {
    episode: {
      schemaVersion: 1,
      id: "ep-001",
      title: "Ep",
      sequence: [{ type: "cut", id: cut.id }],
    },
    cuts: [cut],
    transitions: [],
    lettering: [],
  };
}

function cut(panelAspect?: number): Cut {
  return {
    id: "cut-001",
    image: null,
    imagePrompt: "",
    negativePrompt: "",
    ...(panelAspect === undefined ? {} : { panelAspect }),
  };
}

/** Art of a given pixel size. Only its header is ever read. */
function art(width: number, height: number): Uint8Array {
  return encodePng(makeSolidRaster(width, height, 3, 128));
}

function lint(c: Cut, image: Uint8Array | null) {
  return lintPanelShape(bundle(c), () => image);
}

test("art at the shape the cut declares is not reported", () => {
  assert.deepEqual(lint(cut(1.4), art(100, 140)), []);
  assert.deepEqual(lint(cut(0.3), art(200, 60)), []);
  assert.deepEqual(lint(cut(2.6), art(100, 260)), []);
});

test("art at a different shape is one warning against the cut", () => {
  // The case the ticket names: art made before the declaration, or a
  // declaration edited after the art. The page composes at 1.4 and the project
  // says 0.3, and nothing said so.
  const findings = lint(cut(0.3), art(100, 140));
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.code, "cut/panel-aspect-mismatch");
  assert.equal(findings[0]?.severity, "warning");
  assert.equal(findings[0]?.targetId, "cut-001");
  // Both numbers, so the finding is actionable without measuring anything.
  assert.match(findings[0]?.message ?? "", /0\.3/);
  assert.match(findings[0]?.message ?? "", /100x140/);
  assert.match(findings[0]?.message ?? "", /1\.400/);
});

test("a cut that declares nothing is never reported, whatever its art is", () => {
  // Absent means untouched everywhere, including here: a project written before
  // the field existed cannot acquire a finding from it.
  for (const [w, h] of [
    [100, 140],
    [100, 100],
    [200, 60],
    [100, 1000],
  ] as [number, number][]) {
    assert.deepEqual(lint(cut(), art(w, h)), [], `${w}x${h} was reported`);
  }
});

test("a declaration with no readable art is not a mismatch", () => {
  // There is no second number to disagree with, and the declaration binds the
  // next time the cut is generated.
  assert.deepEqual(lint(cut(0.3), null), []);
  assert.deepEqual(lint(cut(0.3), Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])), []);
});

test("a declaration outside the schema's range is the validator's finding, not this one", () => {
  // One defect, one message. `toony validate` already says `panelAspect must be
  // a number between …`; reporting a second, differently-worded complaint here
  // would send an author looking for two problems.
  for (const bad of [0, -1, Number.NaN]) {
    assert.deepEqual(lint(cut(bad), art(100, 140)), [], `${bad} produced a mismatch finding`);
  }
});

test("the tolerance brackets what is reported, and it is the declared number that moves", () => {
  // Brackets `PANEL_ASPECT_TOLERANCE`'s VALUE from both sides at a declared 1.0:
  // 0.015 of a width off is inside it, 0.025 is not. Shrinking the constant to
  // 0.01 or widening it to 0.05 breaks one of these.
  //
  // What it does NOT pin is whether the comparison is `<=` or `<`. No pair of
  // integer pixel dimensions puts a cut EXACTLY 0.02 of a width from a declared
  // shape — searched over declared 0.10..10.00 at two decimals and every width
  // to 4000, with no hit — so the boundary is measure-zero in doubles and
  // unreachable through any art fixture. Flipping the operator is a silent
  // no-op, and saying otherwise here would be the claim, not the test.
  assert.ok(PANEL_ASPECT_TOLERANCE > 0.015 && PANEL_ASPECT_TOLERANCE < 0.025);
  assert.deepEqual(lint(cut(1), art(200, 203)), []);
  assert.equal(lint(cut(1), art(200, 205)).length, 1);
});

test("the generator's own 8px snap sits inside the tolerance", () => {
  // A declared 0.62 at an 832px column generates at 832x512 — the snapped
  // height, not 515.84 — so art made UNDER the declaration is already a little
  // off it. That must never be a finding. (The CLI's `panel-shape.test.ts`
  // asserts this against the real conversion, over a sweep of columns.)
  assert.deepEqual(lint(cut(0.62), art(832, 512)), []);
});

test("every cut in the bundle is checked, and each reports once", () => {
  const b = bundle(cut(0.3));
  b.cuts.push({ ...cut(2.6), id: "cut-002" });
  b.episode.sequence.push({ type: "cut", id: "cut-002" });
  const findings = lintPanelShape(b, () => art(100, 140));
  assert.deepEqual(
    findings.map((f) => f.targetId),
    ["cut-001", "cut-002"],
  );
});

test("a header claiming a zero axis is not art either", () => {
  // A PNG whose IHDR reports 0x0 parses fine and is not a stage: dividing by it
  // would make every declared cut a mismatch against Infinity or NaN.
  const zero = encodePng(makeSolidRaster(0, 0, 3, 128));
  assert.deepEqual(lint(cut(0.3), zero), []);
});
