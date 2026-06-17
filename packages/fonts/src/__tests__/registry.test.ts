import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { BUBBLE_KINDS, FONT_FAMILY_IDS } from "@toony/schema";
import { fontAssetPath } from "../assets.js";
import {
  defaultFontFamilyForKind,
  FONT_FAMILIES,
  fontFileForWeight,
  fontStackFor,
  getFontFamily,
  isFontFamilyId,
  resolveFontFamily,
} from "../registry.js";

test("registry has exactly one family per schema id and vice versa (no drift)", () => {
  const registryIds = FONT_FAMILIES.map((f) => f.id).sort();
  const schemaIds = [...FONT_FAMILY_IDS].sort();
  assert.deepEqual(registryIds, schemaIds);
  // No duplicate ids in the registry.
  assert.equal(new Set(registryIds).size, registryIds.length);
});

test("every family ships a 400 woff2 file and a valid stack", () => {
  for (const family of FONT_FAMILIES) {
    assert.ok(
      family.files.some((f) => f.weight === 400),
      `${family.id} must ship a 400 weight`,
    );
    for (const f of family.files) {
      assert.ok(f.file.endsWith(".woff2"), `${family.id} files must be woff2`);
    }
    assert.match(family.stack, /sans-serif$/, `${family.id} stack must end in a generic fallback`);
    assert.ok(family.stack.includes(`"${family.name}"`));
  }
});

test("every referenced asset file actually exists on disk (woff2 + OFL license)", () => {
  for (const family of FONT_FAMILIES) {
    for (const f of family.files) {
      assert.ok(existsSync(fontAssetPath(f.file)), `missing woff2: ${f.file}`);
    }
    assert.ok(existsSync(fontAssetPath(family.license)), `missing license: ${family.license}`);
  }
});

test("isFontFamilyId / getFontFamily accept known ids and reject unknown", () => {
  assert.ok(isFontFamilyId("bangers"));
  assert.ok(!isFontFamilyId("comic-sans"));
  assert.ok(!isFontFamilyId(42));
  assert.equal(getFontFamily("bangers")?.name, "Bangers");
  assert.equal(getFontFamily("nope"), undefined);
});

test("defaultFontFamilyForKind returns a registered id for every bubble kind", () => {
  for (const kind of BUBBLE_KINDS) {
    const id = defaultFontFamilyForKind(kind);
    assert.ok(isFontFamilyId(id), `${kind} default must be a registered id`);
  }
});

test("resolveFontFamily honors an explicit id and falls back per kind", () => {
  // Explicit, known id wins regardless of kind.
  assert.equal(resolveFontFamily("anton", "speech").id, "anton");
  // Absent / unknown → the per-kind default.
  assert.equal(resolveFontFamily(undefined, "shout").id, defaultFontFamilyForKind("shout"));
  assert.equal(resolveFontFamily(null, "narration").id, defaultFontFamilyForKind("narration"));
  assert.equal(
    resolveFontFamily("not-a-real-family", "speech").id,
    defaultFontFamilyForKind("speech"),
  );
});

test("fontStackFor matches the resolved family stack", () => {
  assert.equal(fontStackFor("gaegu", "speech"), getFontFamily("gaegu")?.stack);
  assert.equal(fontStackFor(undefined, "sfx"), resolveFontFamily(undefined, "sfx").stack);
});

test("fontFileForWeight picks bold when available, else falls back to 400", () => {
  const nunito = getFontFamily("nunito");
  assert.ok(nunito);
  assert.equal(fontFileForWeight(nunito, 700).weight, 700);
  assert.equal(fontFileForWeight(nunito, 400).weight, 400);
  // A 400-only family always returns its 400 file regardless of requested weight.
  const bangers = getFontFamily("bangers");
  assert.ok(bangers);
  assert.equal(fontFileForWeight(bangers, 700).weight, 400);
});
