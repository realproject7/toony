// The two pack style formats (#334, #335): a lettering theme is held to the
// overlay vocabulary it writes into, applying it writes exactly the fields it
// states, and a style lexicon composes the negative prompt without touching a
// cut that has neither.

import assert from "node:assert/strict";
import { test } from "node:test";
import { applyLetteringTheme, validateLetteringThemeValue } from "../lettering-theme.js";
import { composeNegativePrompt, validateStyleLexiconValue } from "../style-lexicon.js";
import type { LetteringOverlay } from "../types.js";

function overlay(kind: LetteringOverlay["kind"]): LetteringOverlay {
  return {
    id: "ov-1",
    cutId: "cut-001",
    speaker: "",
    kind,
    text: "x",
    fill: "#ffffff",
    opacity: 1,
    border: null,
    tail: null,
    geometry: { x: 0.1, y: 0.1, width: 0.5, height: 0.2 },
    overflow: false,
    reviewStatus: "draft",
  };
}

const THEME = {
  themeFormat: 1,
  name: "Cold",
  kinds: {
    speech: {
      fontFamily: "nunito",
      fontWeight: 700,
      fill: "#f2f6fa",
      textColor: "#102030",
      border: { width: 2, color: "#102030" },
      cornerRadius: 18,
    },
    narration: { fill: "#0b1420", textColor: "#dbe6f3", border: null, opacity: 0.92 },
  },
  sfxMode: "impact_band",
};

test("a theme validates against the overlay vocabulary, and names what is wrong", () => {
  assert.deepEqual(validateLetteringThemeValue(THEME).issues, []);
  const codes = (value: unknown) => validateLetteringThemeValue(value).issues.map((i) => i.code);
  assert.deepEqual(codes({ ...THEME, themeFormat: 2 }), ["theme.format"]);
  assert.deepEqual(codes({ ...THEME, kinds: { yell: {} } }), ["theme.unknown-kind"]);
  assert.deepEqual(codes({ ...THEME, kinds: { speech: { fontFamily: "comic-sans" } } }), [
    "theme.font-family",
  ]);
  assert.deepEqual(codes({ ...THEME, kinds: { speech: { fontWeight: 450 } } }), [
    "theme.font-weight",
  ]);
  assert.deepEqual(
    codes({ ...THEME, kinds: { speech: { border: { width: -1, color: "#000" } } } }),
    ["theme.border"],
  );
  assert.deepEqual(codes({ ...THEME, kinds: { speech: { cornerRadius: 999 } } }), [
    "theme.corner-radius",
  ]);
  assert.deepEqual(codes({ ...THEME, kinds: { speech: { opacity: 2 } } }), ["theme.opacity"]);
  assert.deepEqual(codes({ ...THEME, kinds: { speech: { shadow: true } } }), ["theme.unknown-key"]);
  assert.deepEqual(codes({ ...THEME, sfxMode: "loud" }), ["theme.sfx-mode"]);
  assert.deepEqual(codes("theme"), ["theme.type"]);
});

test("applying a theme writes the fields it states for the kind and nothing else", () => {
  const themed = applyLetteringTheme(overlay("speech"), THEME as never);
  assert.equal(themed.fontFamily, "nunito");
  assert.equal(themed.fontWeight, 700);
  assert.equal(themed.fill, "#f2f6fa");
  assert.equal(themed.textColor, "#102030");
  assert.deepEqual(themed.border, { width: 2, color: "#102030" });
  assert.equal(themed.cornerRadius, 18);
  assert.equal(themed.opacity, 1, "the speech defaults state no opacity");
  assert.equal(themed.sfxMode, undefined, "sfxMode applies to sfx only");
  assert.deepEqual(themed.geometry, overlay("speech").geometry);

  const narration = applyLetteringTheme(overlay("narration"), THEME as never);
  assert.equal(narration.fill, "#0b1420");
  assert.equal(narration.opacity, 0.92);
  assert.equal(narration.border, null);
  assert.equal(narration.fontFamily, undefined);

  const sfx = applyLetteringTheme(overlay("sfx"), THEME as never);
  assert.equal(sfx.sfxMode, "impact_band");
  assert.equal(sfx.fill, "#ffffff", "a kind the theme does not state is untouched");

  const untouched = applyLetteringTheme(overlay("thought"), THEME as never);
  assert.deepEqual(untouched, overlay("thought"));
});

test("a lexicon validates, and the negative prompt composes base then own, leaving an empty cut empty", () => {
  assert.deepEqual(
    validateStyleLexiconValue({
      lexiconFormat: 1,
      styleClause: "flat cel shading, clean ink line",
      negativeBase: "",
    }).issues,
    [],
  );
  const codes = (value: unknown) => validateStyleLexiconValue(value).issues.map((i) => i.code);
  assert.deepEqual(codes({ lexiconFormat: 1, styleClause: "", negativeBase: "" }), [
    "lexicon.style-clause",
  ]);
  assert.deepEqual(codes({ lexiconFormat: 1, styleClause: "x" }), ["lexicon.negative-base"]);
  assert.deepEqual(codes({ lexiconFormat: 1, styleClause: "x", negativeBase: "", mood: "y" }), [
    "lexicon.unknown-key",
  ]);
  // The prefix and the story context setting (#351): optional, held to their vocabulary.
  assert.deepEqual(
    validateStyleLexiconValue({
      lexiconFormat: 1,
      styleClause: "x",
      negativeBase: "",
      stylePrefix: "masterpiece, best quality",
      storyContext: "none",
    }).issues,
    [],
  );
  assert.deepEqual(
    codes({ lexiconFormat: 1, styleClause: "x", negativeBase: "", stylePrefix: "" }),
    ["lexicon.style-prefix"],
  );
  assert.deepEqual(
    codes({ lexiconFormat: 1, styleClause: "x", negativeBase: "", storyContext: "prefix" }),
    ["lexicon.story-context"],
  );

  assert.equal(composeNegativePrompt("", undefined), "");
  assert.equal(composeNegativePrompt("", ""), "");
  assert.equal(composeNegativePrompt("blurry", undefined), "blurry");
  assert.equal(composeNegativePrompt(" blurry ", undefined), " blurry ", "no base: untouched");
  assert.equal(composeNegativePrompt("", "lowres, watermark"), "lowres, watermark");
  assert.equal(composeNegativePrompt("blurry", "lowres, watermark "), "lowres, watermark, blurry");
});
