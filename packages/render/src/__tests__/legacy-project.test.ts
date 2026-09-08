// Back-compat for projects written before #208 retired `LetteringOverlay.font`.
//
// The two shipped example projects are real pre-#208 files: every overlay in
// them carries a `font` name and none carries a `fontFamily`. Reading their
// actual bytes is the only way to prove the retirement did not change what they
// render, so this reads them from the repository rather than a hand-built copy.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { defaultFontFamilyForKind, getFontFamily } from "@toony/fonts";
import type { LetteringOverlay } from "@toony/schema";
import { layoutCut } from "../layout.js";

const EXAMPLES = ["dead-air", "last-train"];
const W = 800;
const H = 1200;

interface Shipped {
  raw: string;
  overlays: LetteringOverlay[];
}

// This file compiles to dist/__tests__/, so the repository root is four up.
async function shippedLettering(name: string): Promise<Shipped> {
  const file = fileURLToPath(
    new URL(`../../../../examples/${name}/episodes/ep-001/lettering.json`, import.meta.url),
  );
  const raw = await readFile(file, "utf8");
  return { raw, overlays: JSON.parse(raw) as LetteringOverlay[] };
}

test("the shipped example projects are genuinely pre-#208 files", async () => {
  for (const name of EXAMPLES) {
    const { raw, overlays } = await shippedLettering(name);
    assert.ok(overlays.length > 0, `${name} has no overlays`);
    assert.ok(raw.includes('"font"'), `${name} no longer carries the retired field`);
    for (const overlay of overlays) {
      assert.equal(typeof overlay.font, "string", `${name} ${overlay.id} lost its font name`);
      assert.equal(overlay.fontFamily, undefined, `${name} ${overlay.id} has a fontFamily`);
    }
  }
});

test("a pre-#208 project renders identically whatever its stored font says", async () => {
  for (const name of EXAMPLES) {
    const { overlays } = await shippedLettering(name);
    const asShipped = layoutCut(overlays, W, H);
    assert.equal(asShipped.length, overlays.length);

    // Removing the retired field, and replacing it with a curated family id that
    // would be a visible change if anything read it, both leave every plan equal.
    const dropped = overlays.map((overlay) => {
      const copy = { ...overlay };
      delete copy.font;
      return copy;
    });
    assert.deepEqual(layoutCut(dropped, W, H), asShipped, `${name} with the field dropped`);
    const rewritten = overlays.map((overlay) => ({ ...overlay, font: "bangers" }));
    assert.deepEqual(layoutCut(rewritten, W, H), asShipped, `${name} with the field rewritten`);
  }
});

test("a pre-#208 overlay resolves to its kind's default face", async () => {
  let checked = 0;
  for (const name of EXAMPLES) {
    const { overlays } = await shippedLettering(name);
    for (const plan of layoutCut(overlays, W, H)) {
      const overlay = overlays.find((o) => o.id === plan.id);
      assert.ok(overlay, `${name} plan ${plan.id} has no source overlay`);
      // An SFX mode swaps the face on its own (#99); that rule is pinned in
      // layout.test.ts and is not what this file is about.
      if (overlay.sfxMode !== undefined) continue;
      const expected = defaultFontFamilyForKind(overlay.kind);
      assert.equal(plan.fontFamily, expected, `${name} ${plan.id} resolved face`);
      assert.equal(plan.fontStack, getFontFamily(expected)?.stack, `${name} ${plan.id} stack`);
      checked++;
    }
  }
  assert.ok(checked >= 15, `expected the shipped examples to cover more overlays, saw ${checked}`);
});
