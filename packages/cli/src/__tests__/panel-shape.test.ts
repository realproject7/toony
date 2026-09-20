// The declared-shape → latent conversion (#237), asserted without a provider.

import assert from "node:assert/strict";
import { test } from "node:test";

import { PANEL_ASPECT_TOLERANCE } from "@toony/lint";
import { PANEL_ASPECT_MAX, PANEL_ASPECT_MIN } from "@toony/schema";
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

/**
 * The aspects that make this conversion round the HARDEST at `column`: those
 * whose unsnapped height lands exactly half a block off the grid, `(8k+4)/column`.
 * A grid of round-looking aspects does not find them — it gets within about 80%
 * of the real worst case and lets a tolerance through that no longer covers it.
 */
function worstCaseAspects(column: number): number[] {
  const aspects: number[] = [];
  for (let k = 0; ; k++) {
    const aspect = (LATENT_BLOCK_PX * k + LATENT_BLOCK_PX / 2) / column;
    if (aspect > PANEL_ASPECT_MAX) break;
    if (aspect >= PANEL_ASPECT_MIN) aspects.push(aspect);
  }
  return aspects;
}

test("the lint's mismatch tolerance covers this conversion's own snap", () => {
  // `PANEL_ASPECT_TOLERANCE` is justified BY the snap above: art made under a
  // declaration is already up to half a block off it, and reporting that as a
  // mismatch would flag every correctly generated cut. The two live in different
  // packages, so the claim is asserted here, where both are in scope — if either
  // number moves, this fails instead of `toony lint` starting to warn about art
  // that is exactly what was asked for.
  //
  // 201 is the narrowest column the tolerance covers and therefore the whole
  // claim: the error is 4px of height however wide the column is, so in
  // width-multiples it is 4/column, and 4/201 is 0.019900 while 4/200 is 0.02 to
  // the last bit of a double. Every column above 201 has more room, so if the
  // bottom of this list holds, the list is not what is carrying the test.
  const COLUMNS = [201, 256, 320, 512, 640, 768, 832, 896, 1024, 1200, 1536, 2048];
  let checked = 0;
  for (const column of COLUMNS) {
    const aspects = worstCaseAspects(column);
    assert.ok(aspects.length > 0, `no worst-case aspect in range at ${column}`);
    for (const aspect of aspects) {
      const rendered = latentHeightFor(column, aspect) / column;
      assert.ok(
        Math.abs(rendered - aspect) <= PANEL_ASPECT_TOLERANCE,
        `${column}px column, declared ${aspect}: generated ${rendered}, outside the lint's ${PANEL_ASPECT_TOLERANCE}`,
      );
      checked++;
    }
  }
  assert.ok(checked > 1000, `only ${checked} worst cases checked`);

  // And the worst case really is the worst: a wide sweep of ordinary aspects at
  // the narrowest column stays inside what the line above already allowed.
  const worst = Math.max(
    ...worstCaseAspects(201).map((a) => Math.abs(latentHeightFor(201, a) / 201 - a)),
  );
  for (let i = 0; i <= 5000; i++) {
    const aspect = PANEL_ASPECT_MIN + (i * (PANEL_ASPECT_MAX - PANEL_ASPECT_MIN)) / 5000;
    assert.ok(Math.abs(latentHeightFor(201, aspect) / 201 - aspect) <= worst, `${aspect} beat it`);
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
