import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutTransition } from "../transition.js";
import { transition } from "./fixtures.js";

test("gutter transition resolves to a gutter treatment with its height", () => {
  const r = layoutTransition(transition({ id: "tr-1", type: "gutter", gutterHeight: 64 }));
  assert.equal(r.treatment, "gutter");
  assert.equal(r.gutterHeight, 64);
  assert.equal(r.isCard, false);
  assert.equal(r.detail, null);
});

test("gutter height is clamped to the schema range and rounded", () => {
  assert.equal(layoutTransition(transition({ id: "a", gutterHeight: -10 })).gutterHeight, 0);
  assert.equal(layoutTransition(transition({ id: "b", gutterHeight: 99999 })).gutterHeight, 4096);
  assert.equal(layoutTransition(transition({ id: "c", gutterHeight: 47.6 })).gutterHeight, 48);
});

test("scene-break is a break treatment and reads as a card", () => {
  const r = layoutTransition(transition({ id: "tr-2", type: "scene-break" }));
  assert.equal(r.treatment, "break");
  assert.equal(r.isCard, true);
  assert.equal(r.label, "scene break");
});

test("beat and time-skip render as cards", () => {
  assert.equal(layoutTransition(transition({ id: "x", type: "beat" })).treatment, "card");
  assert.equal(layoutTransition(transition({ id: "y", type: "time-skip" })).treatment, "card");
});

test("fade resolves to a fade treatment", () => {
  assert.equal(layoutTransition(transition({ id: "f", type: "fade" })).treatment, "fade");
});

test("detail prefers text, then sfx, then notes", () => {
  assert.equal(
    layoutTransition(transition({ id: "t", text: "Later that night", sfx: "WHOOSH" })).detail,
    "Later that night",
  );
  const sfx = layoutTransition(transition({ id: "s", text: null, sfx: "WHOOSH" }));
  assert.equal(sfx.detail, "WHOOSH");
  assert.equal(sfx.isSfx, true);
  assert.equal(
    layoutTransition(transition({ id: "n", text: null, sfx: null, humanNote: "pacing beat" }))
      .detail,
    "pacing beat",
  );
});

test("blank/whitespace detail collapses to null", () => {
  assert.equal(layoutTransition(transition({ id: "w", text: "   " })).detail, null);
});

test("layoutTransition is deterministic", () => {
  const t = transition({ id: "d", type: "beat", text: "A pause." });
  assert.deepEqual(layoutTransition(t), layoutTransition(t));
});

test("transition color override is exposed on the plan; absent → null (#98)", () => {
  assert.equal(layoutTransition(transition({ id: "c1", type: "gutter" })).color, null);
  assert.equal(
    layoutTransition(transition({ id: "c2", type: "gutter", color: "#102030" })).color,
    "#102030",
  );
  // A blank color resolves to null (use the treatment default).
  assert.equal(layoutTransition(transition({ id: "c3", type: "gutter", color: "  " })).color, null);
});
