// The declared-shape → latent conversion (#237), asserted without a provider.

import assert from "node:assert/strict";
import { test } from "node:test";

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
