// The seed shape for a bubble added in the cut editor (#208).
//
// Until #208 the editor stamped `font: "Nanum Gothic"` onto every new bubble —
// a Korean face name the user never picked, written to disk and read by nothing.
// These pin the seed to the fields the schema actually needs.

import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultFontFamilyForKind } from "@toony/fonts";
import { bubbleKindStyle, layoutBubble } from "@toony/render";
import { IssueCollector, validateLetteringOverlayValue } from "@toony/schema";
import { newOverlay, presetOverlay } from "../new-overlay.js";

function issues(overlay: unknown): string[] {
  const collector = new IssueCollector();
  validateLetteringOverlayValue(overlay, "overlay", collector);
  return collector.result().issues.map((issue) => `${issue.path}: ${issue.code}`);
}

test("a new bubble seeds required data and explicit middle-aligned width-based text layout", () => {
  const created = newOverlay("cut-004", 2);
  assert.deepEqual(Object.keys(created).sort(), [
    "border",
    "cutId",
    "fill",
    "geometry",
    "id",
    "kind",
    "opacity",
    "overflow",
    "reviewStatus",
    "speaker",
    "tail",
    "text",
    "textLayout",
    "textRanges",
    "verticalAlign",
  ]);
  assert.equal(created.cutId, "cut-004");
  assert.equal(created.kind, "speech");
  assert.equal(created.fill, bubbleKindStyle("speech").fill);
  assert.match(created.id, /^ov-cut-004-[0-9a-z]+-2$/);
});

test("a new bubble validates and survives a JSON round trip unchanged", () => {
  // The reported flow: add a bubble, attribute it, save. A speech bubble needs a
  // speaker before it validates, which is the one thing the seed leaves to the
  // user; nothing else about the seed may block the save.
  const created = { ...newOverlay("cut-001", 0), speaker: "MIRA" };
  assert.deepEqual(issues(created), []);
  // What the editor POSTs is JSON, so this is the shape that reaches disk.
  const onDisk = JSON.parse(JSON.stringify(created));
  assert.deepEqual(onDisk, created);
  assert.deepEqual(issues(onDisk), []);
});

test("a new bubble renders in its kind's default face, not a stamped one", () => {
  const plan = layoutBubble(newOverlay("cut-001", 0), 800, 1200);
  assert.equal(plan.fontFamily, defaultFontFamilyForKind("speech"));
});

test("new bubbles use the project width and middle alignment without inheriting height-based fitting", () => {
  const created = newOverlay("cut-001", 0, undefined, 1080);
  assert.equal(created.verticalAlign, "middle");
  assert.equal(created.textLayout?.referenceWidth, 1080);
  const plan = layoutBubble(created, 1080, 2000);
  assert.equal(plan.text.fontSize, 30);
  assert.ok(plan.lines[0]?.baselineY !== undefined);
});

test("a project theme overrides appearance while keeping the new bubble layout defaults", () => {
  const bare = newOverlay("cut-001", 0);
  const themed = newOverlay("cut-001", 0, {
    themeFormat: 1,
    kinds: {
      speech: { fontFamily: "bangers", fill: "#fff7e6", border: { width: 3, color: "#2a1a05" } },
    },
  });
  assert.equal(themed.fontFamily, "bangers");
  assert.equal(themed.fill, "#fff7e6");
  assert.deepEqual(themed.border, { width: 3, color: "#2a1a05" });
  assert.equal(bare.fontFamily, undefined);
  assert.equal(themed.kind, bare.kind);
  assert.deepEqual(themed.geometry, bare.geometry);
});

test("presets preserve their own kind defaults and reference units on short and tall artwork", () => {
  for (const height of [248, 2000])
    for (const kind of ["speech", "thought", "shout", "whisper", "narration", "sfx"] as const) {
      const b = presetOverlay(
        "cut-001",
        0,
        kind,
        { x: 0.99, y: 0.99 },
        {
          width: 832,
          height,
          referenceWidth: 1080,
          theme: { themeFormat: 1, kinds: { speech: { fontFamily: "nunito" } } },
        },
      );
      assert.equal(b.kind, kind);
      assert.equal(b.textLayout?.referenceWidth, 1080);
      assert.ok(b.geometry.x + b.geometry.width <= 1 && b.geometry.y + b.geometry.height <= 1);
      assert.equal(b.fontFamily, kind === "speech" ? "nunito" : undefined);
      if (kind === "narration") {
        assert.equal(b.cornerRadius, 0);
        assert.equal(b.tail, null);
      }
      assert.deepEqual(issues({ ...b, speaker: "Speaker" }), []);
    }
});
