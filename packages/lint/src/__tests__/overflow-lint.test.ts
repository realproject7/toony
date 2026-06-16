import assert from "node:assert/strict";
import { test } from "node:test";

import type { BubbleGeometry, EpisodeBundle, LetteringOverlay } from "@toony/schema";
import { encodePng, makeSolidRaster } from "../__fixtures__/images.js";
import { lintBubbleOverflow } from "../overflow-lint.js";

function overlay(
  id: string,
  cutId: string,
  text: string,
  geometry: BubbleGeometry,
): LetteringOverlay {
  return {
    id,
    cutId,
    speaker: "",
    kind: "speech",
    text,
    font: "sans",
    fill: "",
    opacity: 1,
    border: null,
    tail: null,
    geometry,
    overflow: false,
    reviewStatus: "draft",
  };
}

function bundle(cutId: string, overlays: LetteringOverlay[]): EpisodeBundle {
  return {
    episode: {
      schemaVersion: 1,
      id: "ep-001",
      title: "Ep",
      sequence: [{ type: "cut", id: cutId }],
    },
    cuts: [{ id: cutId, image: null }],
    transitions: [],
    lettering: overlays,
  };
}

const TINY_BOX: BubbleGeometry = { x: 0.1, y: 0.1, width: 0.05, height: 0.03 };
const BIG_BOX: BubbleGeometry = { x: 0.05, y: 0.05, width: 0.8, height: 0.7 };

test("long text in a tiny box overflows and is reported as a warning", () => {
  const o = overlay(
    "ov-1",
    "cut-001",
    "This is a very long line that cannot fit a tiny box.",
    TINY_BOX,
  );
  const findings = lintBubbleOverflow(bundle("cut-001", [o]), () => null);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.code, "lettering/overflow");
  assert.equal(findings[0]?.severity, "warning");
  assert.equal(findings[0]?.targetId, "ov-1");
});

test("short text in a big box does not overflow", () => {
  const o = overlay("ov-1", "cut-001", "Hi", BIG_BOX);
  assert.deepEqual(
    lintBubbleOverflow(bundle("cut-001", [o]), () => null),
    [],
  );
});

test("a cut with no overlays produces no findings", () => {
  assert.deepEqual(
    lintBubbleOverflow(bundle("cut-001", []), () => null),
    [],
  );
});

test("a readable image's header dimensions drive the layout", () => {
  // Short text in a big box fits under the portrait fallback, but the same
  // overlay overflows when the cut's real image is 2x2 px (the box collapses to
  // ~1px). The flip proves the resolver's bytes — not the fallback — set the size.
  const o = overlay("ov-1", "cut-001", "Hi", BIG_BOX);
  assert.deepEqual(lintBubbleOverflow(bundle("cut-001", [o]), () => null), []);

  const tiny = encodePng(makeSolidRaster(2, 2, 3, 128));
  const findings = lintBubbleOverflow(bundle("cut-001", [o]), () => tiny);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.code, "lettering/overflow");
});
