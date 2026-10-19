// Pure layout planning: the geometry every output renders from and the Studio
// previews. No canvas here; each case states the rows it expects.

import assert from "node:assert/strict";
import { test } from "node:test";
import { SOCIAL_FRAMES } from "../defaults.js";
import {
  evenParts,
  type LayoutBand,
  type LayoutPlan,
  packSlices,
  planCuts,
  planSocial,
  planStrip,
  resolveOutputOptions,
  splitTallBands,
} from "../layout.js";

/** A band whose height scales with width like an art-less cut of `aspect`. */
function cut(index: number, aspect: number, hasArt = true): LayoutBand {
  return {
    index,
    type: "cut",
    id: `cut-${index}`,
    role: "cut",
    cutNumber: index + 1,
    hasArt,
    heightAt: (width) => Math.max(1, Math.round(width * aspect)),
  };
}

function gap(index: number, role: LayoutBand["role"], height: number): LayoutBand {
  return {
    index,
    type: "transition",
    id: `tr-${index}`,
    role,
    heightAt: (width) => Math.round((height * width) / 800),
  };
}

/** Every band's rows appear exactly once, in order, across the plan's files. */
function assertCovers(plan: LayoutPlan, bands: LayoutBand[], width: number) {
  const seen = new Map<number, number>();
  for (const file of plan.files) {
    for (const piece of file.pieces) {
      assert.equal(piece.top, seen.get(piece.band) ?? 0, `band ${piece.band} rows are contiguous`);
      seen.set(piece.band, piece.top + piece.height);
    }
  }
  bands.forEach((band, i) => {
    const height = band.heightAt(width);
    if (height > 0) assert.equal(seen.get(i), height, `band ${i} fully covered`);
  });
}

test("slices keep whole bands and split only a band taller than the cap, at exact rows", () => {
  const units = splitTallBands([300, 500, 2900, 100, 0, 200], 800, 1000);
  assert.deepEqual(
    units.map((u) => [u.band, u.top, u.height]),
    [
      [0, 0, 300],
      [1, 0, 500],
      [2, 0, 1000],
      [2, 1000, 1000],
      [2, 2000, 900],
      [3, 0, 100],
      [5, 0, 200],
    ],
  );
  const slices = packSlices(units, 1000);
  assert.deepEqual(
    slices.map((slice) => slice.map((u) => `${u.band}:${u.top}+${u.height}`)),
    [["0:0+300", "1:0+500"], ["2:0+1000"], ["2:1000+1000"], ["2:2000+900", "3:0+100"], ["5:0+200"]],
  );
  // A cap above the total gives one slice; the plan is deterministic.
  assert.equal(packSlices(splitTallBands([300, 500], 800, 5000), 5000).length, 1);
  assert.deepEqual(packSlices(units, 1000), slices);
});

test("a strip plan stacks every band once; parts never exceed the part height", () => {
  const bands = [cut(0, 1.4), gap(1, "spacer", 48), cut(2, 3), gap(3, "card", 160), cut(4, 0.5)];
  const whole = planStrip(bands, { width: 800 });
  assert.equal(whole.files.length, 1);
  assert.equal(whole.files[0]?.role, "strip");
  assert.equal(whole.files[0]?.height, 1120 + 48 + 2400 + 160 + 400);
  assertCovers(whole, bands, 800);
  const parts = planStrip(bands, { width: 800, sliceHeight: 1280 });
  assert.ok(parts.files.length > 1);
  for (const file of parts.files) {
    assert.equal(file.role, "slice");
    assert.ok(file.height <= 1280);
    let y = 0;
    for (const piece of file.pieces) {
      assert.equal(piece.y, y);
      y += piece.height;
    }
    assert.equal(file.height, y);
  }
  assertCovers(parts, bands, 800);
  assert.equal(
    parts.files.reduce((total, file) => total + file.height, 0),
    whole.files[0]?.height,
  );
});

test("cut images pad each cut by the margin and include text cards only when asked", () => {
  const bands = [cut(0, 1.4), gap(1, "card", 160), gap(2, "spacer", 48), cut(3, 0.5)];
  const plain = planCuts(bands, { width: 1200, margin: 40, textCards: false });
  assert.deepEqual(
    plain.files.map((f) => [f.role, f.width, f.height]),
    [
      ["cut", 1200, Math.round(1120 * 1.4) + 80],
      ["cut", 1200, 560 + 80],
    ],
  );
  assert.deepEqual(plain.files[0]?.pieces[0], {
    band: 0,
    width: 1120,
    top: 0,
    height: 1568,
    x: 40,
    y: 40,
  });
  const cards = planCuts(bands, { width: 1200, margin: 0, textCards: true });
  assert.deepEqual(
    cards.files.map((f) => f.role),
    ["cut", "card", "cut"],
  );
});

test("art-less cuts produce one warning naming them by number", () => {
  const bands = [cut(0, 1.4, false), cut(1, 1.4), cut(2, 1.4, false)];
  const plan = planStrip(bands, { width: 800 });
  assert.deepEqual(plan.warnings, [
    {
      code: "artless-cuts",
      message: "2 cuts have no artwork yet: Cut 1 and Cut 3. They export as plain panels.",
      items: ["cut-0", "cut-2"],
    },
  ]);
  assert.deepEqual(planStrip([cut(0, 1.4)], { width: 800 }).warnings, []);
});

for (const frame of Object.values(SOCIAL_FRAMES)) {
  test(`social frames for ${frame.id} stay inside the safe area and keep bands whole`, () => {
    const bands = [
      cut(0, 0.5),
      gap(1, "spacer", 48),
      cut(2, 0.4),
      gap(3, "card", 120),
      cut(4, 0.3),
      gap(5, "spacer", 48),
    ];
    const plan = planSocial(bands, { frame: frame.id, tallCuts: "split", referenceWidth: 800 });
    const box = {
      left: frame.safe.left,
      top: frame.safe.top,
      right: frame.width - frame.safe.right,
      bottom: frame.height - frame.safe.bottom,
    };
    for (const file of plan.files) {
      assert.equal(file.width, frame.width);
      assert.equal(file.height, frame.height);
      assert.ok(file.pieces.length > 0);
      for (const piece of file.pieces) {
        assert.ok(piece.x >= box.left && piece.x + piece.width <= box.right);
        assert.ok(piece.y >= box.top && piece.y + piece.height <= box.bottom);
      }
      // No frame starts or ends with a spacer.
      assert.notEqual(bands[file.pieces[0]?.band ?? 0]?.role, "spacer");
      assert.notEqual(bands[file.pieces.at(-1)?.band ?? 0]?.role, "spacer");
    }
    const placed = plan.files.flatMap((file) => file.pieces.map((p) => p.band));
    for (const index of [0, 2, 3, 4]) assert.ok(placed.includes(index), `band ${index} placed`);
  });
}

test("a tall cut splits into rows by default and fits whole when it stays legible", () => {
  const frame = SOCIAL_FRAMES["instagram-portrait"]; // content box 972 x 1242
  const bands = [cut(0, 1.4)];
  const split = planSocial(bands, { frame: frame.id, tallCuts: "split", referenceWidth: 800 });
  assert.equal(split.files.length, 2);
  // Split evenly, so no frame carries a sliver: 1361 rows become 681 + 680.
  assert.deepEqual(
    split.files.map((f) => [f.pieces[0]?.top, f.pieces[0]?.height, f.pieces[0]?.width]),
    [
      [0, 681, 972],
      [681, 680, 972],
    ],
  );
  assert.deepEqual(
    split.warnings.map((w) => w.message),
    ["Cut 1 is split across 2 images."],
  );
  const fit = planSocial(bands, { frame: frame.id, tallCuts: "fit", referenceWidth: 800 });
  assert.equal(fit.files.length, 1);
  const piece = fit.files[0]?.pieces[0];
  assert.ok(piece);
  assert.ok(piece.width < 972 && piece.height <= 1242 && piece.top === 0);
  assert.equal(piece.height, Math.round(piece.width * 1.4));
  assert.equal(piece.x, 54 + Math.floor((972 - piece.width) / 2));
  assert.deepEqual(fit.warnings, []);
  // Too tall to fit legibly: below 0.6 of the reference column it splits instead.
  const tower = planSocial([cut(0, 4)], { frame: frame.id, tallCuts: "fit", referenceWidth: 800 });
  assert.ok(tower.files.length > 1);
  assert.deepEqual(
    tower.warnings.map((w) => w.code),
    ["social.fit-too-small", "social.split"],
  );
});

test("even parts cover every row once, never exceed the cap and differ by at most one row", () => {
  for (const [height, max] of [
    [1361, 1242],
    [2916, 1242],
    [1242, 1242],
    [5, 2],
    [10_001, 900],
  ] as const) {
    const parts = evenParts(height, max);
    assert.equal(parts.length, Math.ceil(height / max));
    let top = 0;
    for (const part of parts) {
      assert.equal(part.top, top);
      assert.ok(part.height <= max && part.height > 0);
      top += part.height;
    }
    assert.equal(top, height);
    const sizes = parts.map((part) => part.height);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1);
  }
});

test("a text card taller than the frame is fitted whole even when cuts split", () => {
  // A card 880 rows tall at the 1440 px X content box (810 rows high).
  const card: LayoutBand = {
    index: 0,
    type: "transition",
    id: "tr-card",
    role: "card",
    heightAt: (width) => Math.round((width * 880) / 1440),
  };
  const plan = planSocial([card, cut(1, 0.4)], {
    frame: "x-landscape",
    tallCuts: "split",
    referenceWidth: 800,
  });
  const pieces = plan.files.flatMap((file) => file.pieces.filter((piece) => piece.band === 0));
  assert.equal(pieces.length, 1);
  assert.ok((pieces[0]?.width ?? 0) < 1440 && (pieces[0]?.height ?? 0) <= 810);
  assert.deepEqual(plan.warnings, []);
});

test("frames are grouped into posts: up to 20 for Instagram, 4 for X", () => {
  const bands = Array.from({ length: 9 }, (_, i) => cut(i, 0.5));
  const x = planSocial(bands, { frame: "x-landscape", tallCuts: "split", referenceWidth: 800 });
  assert.equal(x.files.length, 9);
  assert.deepEqual(
    x.files.map((f) => f.post),
    [1, 1, 1, 1, 2, 2, 2, 2, 3],
  );
  assert.deepEqual(
    x.warnings.map((w) => w.message),
    ["This needs 3 posts of up to 4 images."],
  );
  const many = Array.from({ length: 21 }, (_, i) => cut(i, 1.2));
  const ig = planSocial(many, {
    frame: "instagram-portrait",
    tallCuts: "split",
    referenceWidth: 800,
  });
  assert.deepEqual([...new Set(ig.files.map((f) => f.post))], [1, 2]);
  assert.equal(ig.files.filter((f) => f.post === 1).length, 20);
});

test("output options resolve each engine's defaults", () => {
  assert.deepEqual(
    [resolveOutputOptions("strip", {}, 720).width, resolveOutputOptions("cuts", {}, 720).width],
    [720, 1200],
  );
  const cuts = resolveOutputOptions("cuts", { margin: 50, format: "jpeg" }, 800);
  assert.equal(cuts.contentWidth, 1100);
  assert.equal(cuts.quality, 82);
  const social = resolveOutputOptions("social", { frame: "x-landscape" }, 800);
  assert.equal(social.width, 1600);
  assert.equal(social.contentWidth, 1440);
  assert.equal(social.tallCuts, "split");
  assert.equal(resolveOutputOptions("social", {}, 800).frame?.id, "instagram-portrait");
});
