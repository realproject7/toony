import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BAND_FONT_ID,
  BAND_FONT_STACK,
  BAND_TEXT_MAX_WIDTH_FRAC,
  GUTTER_MARGIN_FILL,
  layoutCardText,
  layoutPanelText,
  layoutTransition,
  resolveBandBackground,
  resolveBandDivider,
  resolveBandHeight,
} from "../transition.js";
import { transition } from "./fixtures.js";

/** A sentence long enough to wrap at any sensible panel width/font. */
const LONG_PANEL_TEXT =
  "The tide remembers every name the harbor has ever whispered into the waiting dark of the long night.";

test("layoutCardText resolves legacy card text geometry (shared by export + studio Read)", () => {
  const r = layoutTransition(
    transition({ id: "c1", type: "title_card", gutterHeight: 400, text: "One caller." }),
  );
  const card = layoutCardText(r, 800, 400);
  assert.ok(card);
  // A short detail is one bold line + the small type label, both centered on x,
  // both inside the panel, with the label BELOW the detail (no overlap).
  assert.equal(card.lines.length, 2);
  assert.equal(card.lines[0]?.text, "One caller.");
  assert.equal(card.lines[0]?.fontSize, Math.max(10, Math.round(400 * 0.22))); // fits at max font
  assert.equal(card.lines[0]?.weight, 700);
  assert.equal(card.lines[0]?.x, 400); // width/2
  assert.equal(card.lines[1]?.weight, 400);
  assert.equal(card.lines[1]?.x, 400);
  assert.ok((card.lines[0]?.y ?? 0) > 0 && (card.lines[1]?.y ?? 0) < 400);
  assert.ok((card.lines[1]?.y ?? 0) > (card.lines[0]?.y ?? 0)); // label under detail
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

test("layoutPanelText resolves a single-source wrapped text block for the v4 cards (#115/#148)", () => {
  const plan = (over: Parameters<typeof transition>[0]) => layoutTransition(transition(over));
  // No text → null.
  assert.equal(layoutPanelText(plan({ id: "n", type: "color_field" }), 800, 400), null);
  // center/middle defaults: a single short line centered at width/2, height/2.
  const mid = layoutPanelText(plan({ id: "m", type: "narration_card", text: "Hello" }), 800, 400);
  assert.ok(mid);
  assert.equal(mid.lines.length, 1);
  assert.equal(mid.lines[0]?.text, "Hello");
  assert.equal(mid.lines[0]?.x, 400);
  assert.equal(mid.lines[0]?.y, 200); // single line, middle
  assert.equal(mid.align, "center");
  assert.equal(mid.fontSize, Math.max(12, Math.round(400 * 0.14)));
  // left + top: x at left pad; a single line's center sits padY + lineHeight/2.
  const fontSize = Math.max(12, Math.round(400 * 0.14));
  const lineHeight = fontSize * 1.25;
  const padX = (800 * (1 - BAND_TEXT_MAX_WIDTH_FRAC)) / 2;
  const tl = layoutPanelText(
    plan({ id: "tl", type: "narration_card", text: "x", textAlign: "left", verticalAlign: "top" }),
    800,
    400,
  );
  assert.ok(tl);
  assert.equal(tl.lines[0]?.x, padX);
  assert.equal(tl.lines[0]?.y, 400 * 0.1 + lineHeight / 2);
  assert.equal(tl.align, "left");
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
  assert.equal(rb.lines[0]?.x, 800 - padX);
  assert.equal(rb.lines[0]?.y, 400 - 400 * 0.1 - lineHeight / 2);
  assert.equal(rb.align, "right");
});

// --- Band background + geometry single source (#147) ------------------------

test("resolveBandHeight applies the width-derived floor to cards/breaks/bands only", () => {
  // Plain gutter honors its exact height (no floor), at any width.
  const gutter = layoutTransition(transition({ id: "g", type: "gutter", gutterHeight: 64 }));
  assert.equal(resolveBandHeight(gutter, 800), 64);
  assert.equal(resolveBandHeight(gutter, 1200), 64);

  // Scene-break floors to round(width*0.1) when the authored gutter is smaller.
  const brk = layoutTransition(transition({ id: "b", type: "scene-break", gutterHeight: 10 }));
  assert.equal(resolveBandHeight(brk, 800), 80); // round(800*0.1)
  assert.equal(resolveBandHeight(brk, 1200), 120);
  // A tall authored break keeps its height (above the floor).
  const tallBrk = layoutTransition(
    transition({ id: "b2", type: "scene-break", gutterHeight: 300 }),
  );
  assert.equal(resolveBandHeight(tallBrk, 800), 300);

  // v3 solid band floors the same way.
  const band = layoutTransition(transition({ id: "z", type: "black_band", gutterHeight: 5 }));
  assert.equal(resolveBandHeight(band, 500), 50);
});

test("resolveBandDivider scales thickness with height (the drifted value, #147)", () => {
  // The ticket's drift example: width 800 → break floors to height 80 → 3px rule
  // (studio used to draw a fixed 2px border here).
  const brk = layoutTransition(transition({ id: "b", type: "scene-break", gutterHeight: 10 }));
  const height = resolveBandHeight(brk, 800);
  assert.equal(height, 80);
  const d = resolveBandDivider(height);
  assert.equal(d.thickness, 3); // max(1, round(80 * 0.04))
  assert.equal(d.spanStart, 0.2);
  assert.equal(d.spanEnd, 0.8);
  assert.equal(d.color, "#2a2a2a");

  // Thickness tracks height across the range, with a 1px floor.
  assert.equal(resolveBandDivider(200).thickness, 8); // round(8)
  assert.equal(resolveBandDivider(50).thickness, 2); // round(2)
  assert.equal(resolveBandDivider(10).thickness, 1); // max(1, round(0.4))
});

test("resolveBandBackground resolves the full precedence chain (#147)", () => {
  // 1) full-panel gradient wins.
  const grad = layoutTransition(
    transition({
      id: "g",
      type: "color_field",
      gradient: { from: "#111111", to: "#222222", direction: "top_bottom" },
    }),
  );
  assert.deepEqual(resolveBandBackground(grad), {
    kind: "gradient",
    gradient: { from: "#111111", to: "#222222", direction: "top_bottom" },
  });

  // 2) resolved craft/interstitial solid band fill.
  const band = layoutTransition(transition({ id: "bl", type: "black_band" }));
  assert.deepEqual(resolveBandBackground(band), { kind: "solid", color: "#0d0d0d" });

  // 3) explicit #98 color on a legacy kind.
  const colored = layoutTransition(transition({ id: "c", type: "gutter", color: "#abcdef" }));
  assert.deepEqual(resolveBandBackground(colored), { kind: "solid", color: "#abcdef" });

  // 4) legacy card dark default (beat has no craft default, no color).
  const card = layoutTransition(transition({ id: "bt", type: "beat" }));
  assert.deepEqual(resolveBandBackground(card), { kind: "solid", color: "#15110d" });

  // 5) fade-treatment default gradient.
  const fade = layoutTransition(transition({ id: "f", type: "fade" }));
  assert.deepEqual(resolveBandBackground(fade), {
    kind: "gradient",
    gradient: { from: "#ffffff", to: "#d9d4cc", direction: "top_bottom" },
  });

  // 6) plain gutter → the shared reading-margin white.
  const plain = layoutTransition(transition({ id: "p", type: "gutter" }));
  assert.deepEqual(resolveBandBackground(plain), { kind: "solid", color: GUTTER_MARGIN_FILL });
  assert.equal(GUTTER_MARGIN_FILL, "#ffffff");
});

// --- Panel/card text wrapping + shared typeface (#148) ----------------------

test("layoutPanelText wraps long v4 text deterministically (export/studio parity, #148)", () => {
  const r = layoutTransition(
    transition({ id: "lp", type: "narration_card", text: LONG_PANEL_TEXT }),
  );
  const a = layoutPanelText(r, 800, 300);
  assert.ok(a);
  assert.ok(a.lines.length > 1, "long panel text must wrap to multiple lines");
  // No word is lost or reordered by the wrap.
  assert.equal(a.lines.map((l) => l.text).join(" "), LONG_PANEL_TEXT);
  // Both consumers call the same pure layout with the same default measurer, so
  // the export raster and the studio Read view break the lines identically.
  const b = layoutPanelText(r, 800, 300);
  assert.ok(b);
  assert.deepEqual(
    a.lines.map((l) => l.text),
    b.lines.map((l) => l.text),
  );
  // Lines stack downward by a constant advance.
  if (a.lines.length >= 2) {
    const step = (a.lines[1]?.y ?? 0) - (a.lines[0]?.y ?? 0);
    assert.ok(step > 0);
  }
});

test("layoutCardText wraps a long legacy-card detail; a short detail stays one line (#148)", () => {
  const long = layoutTransition(
    transition({ id: "lc", type: "title_card", text: LONG_PANEL_TEXT }),
  );
  const cl = layoutCardText(long, 800, 300);
  assert.ok(cl);
  const detail = cl.lines.filter((l) => l.weight === 700);
  assert.ok(detail.length > 1, "long card detail must wrap to multiple bold lines");
  assert.equal(detail.map((l) => l.text).join(" "), LONG_PANEL_TEXT);
  // The small type label (weight 400) still follows the wrapped detail.
  assert.equal(cl.lines.filter((l) => l.weight === 400).length, 1);

  // A short detail stays a single bold line.
  const short = layoutCardText(
    layoutTransition(transition({ id: "sc", type: "title_card", text: "Later." })),
    800,
    400,
  );
  assert.ok(short);
  assert.equal(short.lines.filter((l) => l.weight === 700).length, 1);
});

test("layoutCardText keeps the wrapped detail+label a bounded, non-overlapping stack (#148)", () => {
  // A long detail at a short panel: every line must stay inside the panel and
  // the label must sit strictly BELOW the wrapped detail (no clip, no overlap).
  const r = layoutTransition(transition({ id: "bnd", type: "title_card", text: LONG_PANEL_TEXT }));
  const height = 300;
  const card = layoutCardText(r, 800, height);
  assert.ok(card);
  const detail = card.lines.filter((l) => l.weight === 700);
  const label = card.lines.find((l) => l.weight === 400);
  assert.ok(detail.length > 1, "the long detail wraps");
  assert.ok(label);
  // Auto-fit may shrink the detail below the nominal 0.22h so it fits.
  assert.ok((detail[0]?.fontSize ?? 0) <= Math.max(10, Math.round(height * 0.22)));
  // Bounds: every line's box stays within [0, height].
  for (const line of card.lines) {
    const half = (line.fontSize * 1.25) / 2;
    assert.ok((line.y ?? 0) - half >= -0.5, `line top within panel (y=${line.y})`);
    assert.ok((line.y ?? 0) + half <= height + 0.5, `line bottom within panel (y=${line.y})`);
  }
  // Non-overlap: the label sits below the lowest detail line.
  const lowestDetail = Math.max(...detail.map((l) => l.y));
  assert.ok(label.y > lowestDetail, "label is below the wrapped detail");
});

test("layoutPanelText keeps a long wrapped block inside the panel (#148 bounds)", () => {
  const r = layoutTransition(
    transition({ id: "pb", type: "narration_card", text: LONG_PANEL_TEXT }),
  );
  const height = 300;
  const p = layoutPanelText(r, 800, height);
  assert.ok(p);
  for (const line of p.lines) {
    const half = (p.fontSize * 1.25) / 2;
    assert.ok((line.y ?? 0) - half >= -0.5, `line top within panel (y=${line.y})`);
    assert.ok((line.y ?? 0) + half <= height + 0.5, `line bottom within panel (y=${line.y})`);
  }
});

test("BAND_FONT is the one shared curated typeface (Nunito) for both consumers (#148)", () => {
  assert.equal(BAND_FONT_ID, "nunito");
  assert.ok(BAND_FONT_STACK.includes("Nunito"));
  assert.equal(BAND_TEXT_MAX_WIDTH_FRAC, 0.84);
});

// --- Overflow policy for unbounded text (#148) ------------------------------

/** Long enough to overflow even at the auto-fit minimum font on a small panel. */
const OVERSIZED_TEXT = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");

test("layoutPanelText caps an oversized caption to the panel with an ellipsis (#148)", () => {
  const r = layoutTransition(
    transition({ id: "ovp", type: "narration_card", text: OVERSIZED_TEXT }),
  );
  const height = 160;
  const p = layoutPanelText(r, 500, height);
  assert.ok(p);
  const half = (p.fontSize * 1.25) / 2;
  for (const line of p.lines) {
    assert.ok((line.y ?? 0) - half >= -0.5, `line top within panel (y=${line.y})`);
    assert.ok((line.y ?? 0) + half <= height + 0.5, `line bottom within panel (y=${line.y})`);
  }
  // Truncated: the last shown line is ellipsized (not all text fits).
  assert.ok(p.lines.at(-1)?.text.endsWith("…"), "truncation is marked with an ellipsis");
});

test("layoutCardText caps an oversized detail; stack stays bounded + non-overlapping (#148)", () => {
  const r = layoutTransition(transition({ id: "ovc", type: "title_card", text: OVERSIZED_TEXT }));
  const height = 180;
  const card = layoutCardText(r, 600, height);
  assert.ok(card);
  const detail = card.lines.filter((l) => l.weight === 700);
  const label = card.lines.find((l) => l.weight === 400);
  assert.ok(label);
  for (const line of card.lines) {
    const half = (line.fontSize * 1.25) / 2;
    assert.ok((line.y ?? 0) - half >= -0.5, `line top within panel (y=${line.y})`);
    assert.ok((line.y ?? 0) + half <= height + 0.5, `line bottom within panel (y=${line.y})`);
  }
  assert.ok(label.y > Math.max(...detail.map((l) => l.y)), "label sits below the capped detail");
  assert.ok(detail.at(-1)?.text.endsWith("…"), "detail truncation is ellipsized");
});
