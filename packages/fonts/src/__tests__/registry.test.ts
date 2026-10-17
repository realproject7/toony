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
  // The stack follows the same language-aware default the family does (#213).
  assert.equal(
    fontStackFor(undefined, "speech", "ko"),
    getFontFamily(defaultFontFamilyForKind("speech", "ko"))?.stack,
  );
});

// --- Dialogue language (#213) ------------------------------------------------
// The project declares which language its dialogue is written in, and the
// dialogue kinds default to the face built for that language's script. Asserting
// the resolved family's `scripts` rather than only its id keeps these honest if
// the curated set ever swaps which face covers a script.

/** The kinds whose default is the clean dialogue sans. */
const DIALOGUE_KINDS = ["speech", "whisper", "ambient"] as const;

test("dialogue kinds default to a face covering the declared language's script", () => {
  for (const kind of DIALOGUE_KINDS) {
    const en = resolveFontFamily(undefined, kind, "en");
    assert.ok(en.scripts.includes("latin"), `${kind} en face must cover Latin`);
    assert.ok(!en.scripts.includes("korean"), `${kind} en face must not be a Hangul face`);

    const ko = resolveFontFamily(undefined, kind, "ko");
    assert.ok(ko.scripts.includes("korean"), `${kind} ko face must cover Korean`);

    const ja = resolveFontFamily(undefined, kind, "ja");
    assert.ok(ja.scripts.includes("japanese"), `${kind} ja face must cover Japanese`);

    assert.notEqual(en.id, ko.id, `${kind} must not resolve en and ko to one face`);
  }
});

test("a region subtag resolves like its primary language, and a Latin-script language is Latin", () => {
  assert.equal(
    defaultFontFamilyForKind("speech", "ko-KR"),
    defaultFontFamilyForKind("speech", "ko"),
  );
  assert.equal(
    defaultFontFamilyForKind("speech", "en-US"),
    defaultFontFamilyForKind("speech", "en"),
  );
  // A language the curated set ships no CJK face for still needs its Latin
  // glyphs, so it takes the Latin sans rather than a Hangul-metric face.
  assert.equal(defaultFontFamilyForKind("speech", "fr"), defaultFontFamilyForKind("speech", "en"));
});

test("display and handwriting kinds keep their intent whatever the language is", () => {
  // Loud stays loud, hand-lettered stays hand-lettered: those defaults were
  // picked for intent, not for a script, so no language may move them.
  for (const kind of BUBBLE_KINDS) {
    if ((DIALOGUE_KINDS as readonly string[]).includes(kind)) continue;
    const baseline = defaultFontFamilyForKind(kind);
    for (const language of ["en", "ko", "ja", "fr"]) {
      assert.equal(
        defaultFontFamilyForKind(kind, language),
        baseline,
        `${kind} moved for ${language}`,
      );
    }
  }
});

test("no declared language leaves every kind on the pre-#213 baseline", () => {
  // The baseline is written out, not read back from the registry, so changing a
  // default face breaks this instead of silently redefining what it pins.
  const baseline: Record<string, string> = {
    speech: "noto-sans-kr",
    whisper: "noto-sans-kr",
    thought: "patrick-hand",
    narration: "patrick-hand",
    shout: "bangers",
    sfx: "anton",
    beat: "patrick-hand",
    ambient: "noto-sans-kr",
  };
  for (const kind of BUBBLE_KINDS) {
    for (const language of [undefined, null, "", "   "]) {
      assert.equal(
        defaultFontFamilyForKind(kind, language),
        baseline[kind],
        `${kind} / ${language}`,
      );
    }
  }
});

test("an explicit family id ignores the declared language entirely", () => {
  for (const language of ["en", "ko", "ja"]) {
    assert.equal(resolveFontFamily("gaegu", "speech", language).id, "gaegu");
    assert.equal(resolveFontFamily("anton", "ambient", language).id, "anton");
  }
});

test("every language resolves every kind to a registered family", () => {
  // resolveFontFamily must never hand render or export an unregistered face.
  for (const kind of BUBBLE_KINDS) {
    for (const language of ["en", "ko", "ja", "fr", "zh", "xx", "  ko  ", "EN"]) {
      assert.ok(
        isFontFamilyId(defaultFontFamilyForKind(kind, language)),
        `${kind} / ${language} default must be registered`,
      );
      assert.ok(
        getFontFamily(resolveFontFamily(undefined, kind, language).id),
        `${kind} / ${language} resolved family must be registered`,
      );
    }
  }
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
