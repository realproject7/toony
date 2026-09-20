// The declared-shape → latent conversion (#237), asserted without a provider.

import assert from "node:assert/strict";
import { test } from "node:test";

import { PANEL_ASPECT_TOLERANCE } from "@toony/lint";
import { LATENT_BLOCK_PX, latentHeightFor } from "../panel-shape.js";

test("a shape resolves against the column it is given", () => {
  assert.equal(latentHeightFor(800, 1.5), 1200);
  assert.equal(latentHeightFor(832, 0.5), 416);
  // The same shape at two columns is two heights; that is the point of a ratio.
  assert.equal(latentHeightFor(600, 2), 1200);
  assert.equal(latentHeightFor(1200, 1), 1200);
});

test("a resolved height always lands on the 8px latent grid", () => {
  // 832 * 0.62 = 515.84 — a size ComfyUI's sampler cannot run, so it snaps.
  assert.equal(latentHeightFor(832, 0.62), 512);
  for (const aspect of [0.1, 0.37, 0.999, 1.4327, 2.73, 10]) {
    const height = latentHeightFor(832, aspect);
    assert.equal(height % LATENT_BLOCK_PX, 0, `aspect ${aspect} gave ${height}`);
    assert.ok(height > 0);
  }
});

test("the snapped height is within half a block of the shape asked for", () => {
  for (const aspect of [0.1, 0.5, 0.9, 1.4327, 3.3, 9.9]) {
    const height = latentHeightFor(1000, aspect);
    assert.ok(
      Math.abs(height - 1000 * aspect) <= LATENT_BLOCK_PX / 2,
      `aspect ${aspect} gave ${height}`,
    );
  }
});

test("a shape that rounds below one block still yields a runnable latent", () => {
  // Not reachable through the schema's own bounds, but the conversion is a
  // function and a zero-height latent is not a size — it is a crash later on.
  assert.equal(latentHeightFor(8, 0.1), LATENT_BLOCK_PX);
});

// --- The read-back's tolerance, against this conversion (#260) --------------

test("the lint's mismatch tolerance covers this conversion's own snap", () => {
  // `PANEL_ASPECT_TOLERANCE` is justified BY the snap above: art made under a
  // declaration is already up to half a block off it, and reporting that as a
  // mismatch would flag every correctly generated cut. The two live in different
  // packages, so the claim is asserted here, where both are in scope — if either
  // number moves, this fails instead of `toony lint` starting to warn about art
  // that is exactly what was asked for.
  //
  // The columns are the ones a page is actually generated at, down to the 256px
  // the tolerance is documented to cover; the aspects sweep the schema's range.
  const COLUMNS = [256, 320, 512, 640, 768, 832, 896, 1024, 1200, 1536];
  const ASPECTS = [0.1, 0.3, 0.44, 0.62, 0.74, 1, 1.4327, 2.1, 2.6, 3.45, 7.3, 10];
  for (const column of COLUMNS) {
    for (const aspect of ASPECTS) {
      const rendered = latentHeightFor(column, aspect) / column;
      assert.ok(
        Math.abs(rendered - aspect) <= PANEL_ASPECT_TOLERANCE,
        `${column}px column, declared ${aspect}: generated ${rendered}, outside the lint's ${PANEL_ASPECT_TOLERANCE}`,
      );
    }
  }
});

test("the tolerance is not so wide it stops seeing a re-cut panel", () => {
  // The other bound. A pack paces by declaring DIFFERENT shapes per cut, so the
  // tolerance has to be well under the gap between two of them or a cut carrying
  // its neighbour's art reads as a match. These are the nine the recorded render
  // pass declared; the closest pair is 0.30 and 0.44.
  const DECLARED = [0.3, 0.44, 0.58, 0.74, 1.43, 2.1, 2.6, 3.15, 3.45];
  const gaps = DECLARED.slice(1).map((a, i) => a - (DECLARED[i] as number));
  assert.ok(Math.min(...gaps) > PANEL_ASPECT_TOLERANCE * 4, `closest pair: ${Math.min(...gaps)}`);
});
