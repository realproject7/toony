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
import { newOverlay } from "../new-overlay.js";

function issues(overlay: unknown): string[] {
  const collector = new IssueCollector();
  validateLetteringOverlayValue(overlay, "overlay", collector);
  return collector.result().issues.map((issue) => `${issue.path}: ${issue.code}`);
}

test("a new bubble seeds exactly the fields the schema requires", () => {
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
