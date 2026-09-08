// The default dialogue face follows the language the project declares (#213).
//
// These assert through `layoutCut`, the one path the studio preview, the focused
// editor, and the export raster all go through, rather than reading the default
// map back out, so they pin what a reader actually sees. The overlays are the
// bytes of the two shipped example projects: neither sets a `fontFamily`, so
// every bubble in them resolves through the default.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { getFontFamily } from "@toony/fonts";
import type { BubbleKind, LetteringOverlay } from "@toony/schema";
import { layoutCut } from "../layout.js";

const EXAMPLES = ["dead-air", "last-train"];
const W = 800;
const H = 1200;

/** The kinds whose default is the clean dialogue sans; the rest are display faces. */
const DIALOGUE_KINDS: ReadonlySet<BubbleKind> = new Set(["speech", "whisper", "ambient"]);

// This file compiles to dist/__tests__/, so the repository root is four up.
async function shippedLettering(name: string): Promise<LetteringOverlay[]> {
  const file = fileURLToPath(
    new URL(`../../../../examples/${name}/episodes/ep-001/lettering.json`, import.meta.url),
  );
  return JSON.parse(await readFile(file, "utf8")) as LetteringOverlay[];
}

test("the shipped examples set no fontFamily, so every bubble resolves through the default", async () => {
  for (const name of EXAMPLES) {
    const overlays = await shippedLettering(name);
    assert.ok(overlays.length > 0, `${name} has no overlays`);
    for (const overlay of overlays) {
      assert.equal(overlay.fontFamily, undefined, `${name} ${overlay.id} pins a family`);
    }
    assert.ok(
      overlays.some((o) => DIALOGUE_KINDS.has(o.kind)),
      `${name} has no dialogue-kind bubble to cover`,
    );
  }
});

test("declaring English lays dialogue in a Latin face; declaring Korean lays it in a Korean face", async () => {
  let checked = 0;
  for (const name of EXAMPLES) {
    const overlays = await shippedLettering(name);
    const en = layoutCut(overlays, W, H, { dialogueLanguage: "en" });
    const ko = layoutCut(overlays, W, H, { dialogueLanguage: "ko" });
    assert.equal(en.length, overlays.length);

    for (let i = 0; i < en.length; i++) {
      const enPlan = en[i];
      const koPlan = ko[i];
      assert.ok(enPlan && koPlan);
      const overlay = overlays.find((o) => o.id === enPlan.id);
      assert.ok(overlay, `${name} plan ${enPlan.id} has no source overlay`);
      // An SFX mode swaps the face on its own (#99) and is not a default.
      if (overlay.sfxMode !== undefined) continue;

      const enFamily = getFontFamily(enPlan.fontFamily);
      const koFamily = getFontFamily(koPlan.fontFamily);
      assert.ok(enFamily && koFamily, `${name} ${enPlan.id} resolved an unregistered family`);

      if (DIALOGUE_KINDS.has(overlay.kind)) {
        assert.ok(
          enFamily.scripts.includes("latin") && !enFamily.scripts.includes("korean"),
          `${name} ${enPlan.id} (${overlay.kind}) set English in ${enFamily.id}`,
        );
        assert.ok(
          koFamily.scripts.includes("korean"),
          `${name} ${koPlan.id} (${overlay.kind}) set Korean in ${koFamily.id}`,
        );
        checked++;
      } else {
        // Loud and hand-lettered kinds are chosen for intent, not for a script.
        assert.equal(
          enPlan.fontFamily,
          koPlan.fontFamily,
          `${name} ${enPlan.id} (${overlay.kind}) moved with the language`,
        );
      }
    }
  }
  assert.ok(checked >= 4, `expected the examples to cover dialogue bubbles, saw ${checked}`);
});

test("the plan's font stack is the resolved family's, so the SVG sets the same face", async () => {
  for (const name of EXAMPLES) {
    const overlays = await shippedLettering(name);
    for (const language of ["en", "ko"]) {
      for (const plan of layoutCut(overlays, W, H, { dialogueLanguage: language })) {
        assert.equal(
          plan.fontStack,
          getFontFamily(plan.fontFamily)?.stack,
          `${name} ${plan.id} stack disagrees with its family under ${language}`,
        );
      }
    }
  }
});

test("declaring no language lays the shipped examples out exactly as before #213", async () => {
  // The per-kind baseline is written out here rather than read back from the
  // registry, so a changed default face fails this instead of redefining it.
  const baseline: Record<BubbleKind, string> = {
    speech: "noto-sans-kr",
    whisper: "noto-sans-kr",
    thought: "patrick-hand",
    narration: "patrick-hand",
    shout: "bangers",
    sfx: "anton",
    beat: "patrick-hand",
    ambient: "noto-sans-kr",
  };
  for (const name of EXAMPLES) {
    const overlays = await shippedLettering(name);
    const plans = layoutCut(overlays, W, H);
    for (const plan of plans) {
      const overlay = overlays.find((o) => o.id === plan.id);
      assert.ok(overlay);
      if (overlay.sfxMode !== undefined) continue;
      assert.equal(plan.fontFamily, baseline[overlay.kind], `${name} ${plan.id} default face`);
    }
    // A blank declaration is no declaration: same plans, field for field.
    assert.deepEqual(layoutCut(overlays, W, H, { dialogueLanguage: "" }), plans, `${name} blank`);
  }
});

test("the language moves the default face and nothing else about the layout", async () => {
  for (const name of EXAMPLES) {
    const overlays = await shippedLettering(name);
    const en = layoutCut(overlays, W, H, { dialogueLanguage: "en" });
    const ko = layoutCut(overlays, W, H, { dialogueLanguage: "ko" });
    for (let i = 0; i < en.length; i++) {
      const a = { ...(en[i] as object) } as Record<string, unknown>;
      const b = { ...(ko[i] as object) } as Record<string, unknown>;
      // Text metrics legitimately follow the face (the injected measurer keys on
      // it), so drop the face-derived fields and require everything else equal.
      for (const key of ["fontFamily", "fontStack", "text", "lines", "textOrigin", "overflow"]) {
        delete a[key];
        delete b[key];
      }
      assert.deepEqual(a, b, `${name} plan ${i} changed beyond its face`);
    }
  }
});

test("an explicit fontFamily ignores the declared language, in every kind", async () => {
  for (const name of EXAMPLES) {
    const overlays = (await shippedLettering(name)).map((overlay) => ({
      ...overlay,
      fontFamily: "gaegu" as const,
    }));
    const en = layoutCut(overlays, W, H, { dialogueLanguage: "en" });
    const ko = layoutCut(overlays, W, H, { dialogueLanguage: "ko" });
    const none = layoutCut(overlays, W, H);
    assert.deepEqual(en, none, `${name} en drifted from the pinned face`);
    assert.deepEqual(ko, none, `${name} ko drifted from the pinned face`);
    for (const plan of none) {
      // sfxMode=hand_lettered only swaps the face when none is pinned (#99).
      assert.equal(plan.fontFamily, "gaegu", `${name} ${plan.id} lost its pinned face`);
    }
  }
});
