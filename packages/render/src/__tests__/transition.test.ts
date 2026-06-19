import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutCardText, layoutPanelText, layoutTransition } from "../transition.js";
import { transition } from "./fixtures.js";

test("layoutCardText resolves legacy card text geometry (shared by export + studio Read)", () => {
  const r = layoutTransition(
    transition({ id: "c1", type: "title_card", gutterHeight: 400, text: "One caller." }),
  );
  const card = layoutCardText(r, 800, 400);
  assert.ok(card);
  // Detail line: bold, 0.22h, at y = 0.42h, centered.
  assert.equal(card.lines.length, 2);
  assert.equal(card.lines[0]?.text, "One caller.");
  assert.equal(card.lines[0]?.fontSize, Math.max(10, Math.round(400 * 0.22)));
  assert.equal(card.lines[0]?.y, 400 * 0.42);
  assert.equal(card.lines[0]?.weight, 700);
  assert.equal(card.lines[0]?.x, 400); // width/2
  // Small type label under it at y = 0.68h.
  assert.equal(card.lines[1]?.y, 400 * 0.68);
  assert.equal(card.lines[1]?.weight, 400);
  assert.equal(card.color, "#f3ece0");
});

test("layoutCardText with no detail centers the type label; break uses dark ink", () => {
  const r = layoutTransition(transition({ id: "b1", type: "scene-break", gutterHeight: 200 }));
  const card = layoutCardText(r, 800, 200);
  assert.ok(card);
  assert.equal(card.lines.length, 1);
  assert.equal(card.lines[0]?.y, 100); // height/2
  assert.equal(card.color, "#2a2a2a"); // break ground is light → dark ink
});

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

// --- v3 craft transition kinds (#99) ---------------------------------------

test("black_band resolves to a solid black band by default", () => {
  const r = layoutTransition(transition({ id: "bb", type: "black_band" }));
  assert.equal(r.treatment, "band");
  assert.equal(r.bandFill, "#0d0d0d");
  assert.equal(r.label, "black band");
});

test("palette_shift and desaturate_repeat are solid bands with their defaults", () => {
  const ps = layoutTransition(transition({ id: "ps", type: "palette_shift" }));
  assert.equal(ps.treatment, "band");
  assert.equal(ps.bandFill, "#5a6b7a");
  const dr = layoutTransition(transition({ id: "dr", type: "desaturate_repeat" }));
  assert.equal(dr.treatment, "band");
  // desaturate_repeat is a neutral gray band (the true cross-cut version is deferred).
  assert.equal(dr.bandFill, "#9a958c");
});

test("title_card is a card treatment that centers the transition text", () => {
  const r = layoutTransition(
    transition({ id: "tc", type: "title_card", text: "Three days later" }),
  );
  assert.equal(r.treatment, "card");
  assert.equal(r.isCard, true);
  assert.equal(r.detail, "Three days later");
  assert.equal(r.bandFill, "#15110d");
  assert.equal(r.label, "title card");
});

test("Transition.color overrides the craft band default fill (#98 reuse)", () => {
  const r = layoutTransition(transition({ id: "ps2", type: "palette_shift", color: "#ff8800" }));
  assert.equal(r.bandFill, "#ff8800");
  // Blank color falls back to the per-kind default.
  const blank = layoutTransition(transition({ id: "ps3", type: "palette_shift", color: "  " }));
  assert.equal(blank.bandFill, "#5a6b7a");
});

test("legacy transition kinds have no solid bandFill (back-compat)", () => {
  for (const type of ["gutter", "fade", "beat", "scene-break", "time-skip", "hard-cut"] as const) {
    assert.equal(layoutTransition(transition({ id: type, type })).bandFill, null);
  }
});

// --- v4 interstitial kinds + verticalAlign + fade (#115) --------------------

test("v4 color_field and void resolve to solid bands with their defaults", () => {
  const cf = layoutTransition(transition({ id: "cf", type: "color_field" }));
  assert.equal(cf.treatment, "band");
  assert.equal(cf.bandFill, "#5a6b7a");
  const vd = layoutTransition(transition({ id: "vd", type: "void" }));
  assert.equal(vd.treatment, "band");
  assert.equal(vd.bandFill, "#0a0a0a"); // near-black dread
});

test("v4 narration/dialogue/time cards are card treatments with dark fills", () => {
  for (const type of ["narration_card", "dialogue_card", "time_card"] as const) {
    const r = layoutTransition(transition({ id: type, type }));
    assert.equal(r.treatment, "card", type);
    assert.equal(r.isCard, true, type);
    assert.equal(r.bandFill, "#15110d", type);
  }
});

test("v4 panels resolve text anchoring with center/middle defaults; explicit wins", () => {
  const def = layoutTransition(transition({ id: "d", type: "narration_card" }));
  assert.equal(def.textAlign, "center");
  assert.equal(def.verticalAlign, "middle");
  const set = layoutTransition(
    transition({ id: "s", type: "narration_card", textAlign: "left", verticalAlign: "bottom" }),
  );
  assert.equal(set.textAlign, "left");
  assert.equal(set.verticalAlign, "bottom");
});

test("Transition.color overrides a v4 panel's default fill", () => {
  const r = layoutTransition(transition({ id: "c", type: "color_field", color: "#112233" }));
  assert.equal(r.bandFill, "#112233");
});

test("fade resolves the end color per type and clamps length to the panel height", () => {
  const black = layoutTransition(
    transition({
      id: "fb",
      type: "void",
      gutterHeight: 800,
      fade: { type: "to_black", direction: "top_bottom", length: 300 },
    }),
  );
  assert.deepEqual(black.fade, {
    type: "to_black",
    direction: "top_bottom",
    length: 300,
    color: "#000000",
  });
  const white = layoutTransition(
    transition({
      id: "fw",
      type: "color_field",
      fade: { type: "to_white", direction: "bottom_up", length: 50 },
    }),
  );
  assert.equal(white.fade?.color, "#ffffff");
  // to_color uses Transition.color (falls back to black when absent).
  const col = layoutTransition(
    transition({
      id: "fc",
      type: "color_field",
      color: "#abcdef",
      fade: { type: "to_color", direction: "top_bottom", length: 40 },
    }),
  );
  assert.equal(col.fade?.color, "#abcdef");
  // length is clamped to the resolved gutterHeight.
  const clamped = layoutTransition(
    transition({
      id: "cl",
      type: "void",
      gutterHeight: 100,
      fade: { type: "to_black", direction: "top_bottom", length: 9999 },
    }),
  );
  assert.equal(clamped.fade?.length, 100);
});

test("legacy transition kinds keep null bandFill and no fade (back-compat, #115)", () => {
  for (const type of ["gutter", "fade", "beat", "scene-break", "time-skip", "hard-cut"] as const) {
    const r = layoutTransition(transition({ id: type, type }));
    assert.equal(r.bandFill, null, `${type} bandFill`);
    assert.equal(r.fade, null, `${type} fade`);
    // existing treatments unchanged.
  }
  assert.equal(layoutTransition(transition({ id: "b", type: "beat" })).treatment, "card");
  assert.equal(layoutTransition(transition({ id: "g", type: "gutter" })).treatment, "gutter");
});

test("gradient resolves on the plan; absent → null (#115)", () => {
  const none = layoutTransition(transition({ id: "g0", type: "color_field" }));
  assert.equal(none.gradient, null);
  const g = layoutTransition(
    transition({
      id: "g1",
      type: "color_field",
      gradient: { from: "#102030", to: "#a0b0c0", direction: "bottom_up" },
    }),
  );
  assert.deepEqual(g.gradient, { from: "#102030", to: "#a0b0c0", direction: "bottom_up" });
});

test("layoutPanelText resolves a single-source text block for the v4 cards (#115)", () => {
  const plan = (over: Parameters<typeof transition>[0]) => layoutTransition(transition(over));
  // No text → null.
  assert.equal(layoutPanelText(plan({ id: "n", type: "color_field" }), 800, 400), null);
  // center/middle defaults: x = width/2, y = height/2, baseline middle.
  const mid = layoutPanelText(plan({ id: "m", type: "narration_card", text: "Hello" }), 800, 400);
  assert.ok(mid);
  assert.equal(mid.text, "Hello");
  assert.equal(mid.x, 400);
  assert.equal(mid.y, 200);
  assert.equal(mid.align, "center");
  assert.equal(mid.baseline, "middle");
  assert.equal(mid.fontSize, Math.max(12, Math.round(400 * 0.14)));
  // left + top: x at left pad, y at top pad, baseline top.
  const tl = layoutPanelText(
    plan({ id: "tl", type: "narration_card", text: "x", textAlign: "left", verticalAlign: "top" }),
    800,
    400,
  );
  assert.ok(tl);
  assert.equal(tl.x, 800 * 0.08);
  assert.equal(tl.y, 400 * 0.1);
  assert.equal(tl.align, "left");
  assert.equal(tl.baseline, "top");
  // right + bottom.
  const rb = layoutPanelText(
    plan({
      id: "rb",
      type: "dialogue_card",
      text: "y",
      textAlign: "right",
      verticalAlign: "bottom",
    }),
    800,
    400,
  );
  assert.ok(rb);
  assert.equal(rb.x, 800 - 800 * 0.08);
  assert.equal(rb.y, 400 - 400 * 0.1);
  assert.equal(rb.baseline, "bottom");
});
