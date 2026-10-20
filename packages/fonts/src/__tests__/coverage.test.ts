import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fontAssetPath } from "../assets.js";
import { fontHasCodepoint, resolveFontRuns } from "../coverage.js";
import { FONT_COVERAGE_DATA } from "../coverage-data.js";
import { FONT_FAMILIES } from "../registry.js";

test("coverage metadata is tied to every actual bundled face, not family script labels", () => {
  for (const family of FONT_FAMILIES)
    for (const file of family.files) {
      const data = FONT_COVERAGE_DATA[file.file];
      assert.ok(data);
      assert.equal(
        createHash("sha256")
          .update(readFileSync(fontAssetPath(file.file)))
          .digest("hex"),
        data.sha256,
        `regenerate cmap metadata for ${file.file}`,
      );
    }
  assert.equal(fontHasCodepoint("anton", "H".codePointAt(0) as number), false);
  assert.equal(fontHasCodepoint("nunito", "H".codePointAt(0) as number), true);
});

// Codepoints a bundled file has no glyph for at all (not merely unmapped). Gaegu
// ships no grave accent; resolveFontRuns sends it to a fallback face. Any other
// gap in printable Basic Latin means the subset dropped characters.
const KNOWN_BASIC_LATIN_GAPS: Record<string, readonly number[]> = {
  "gaegu-400.woff2": [0x60],
  "gaegu-700.woff2": [0x60],
};

test("every Latin-capable bundled face covers printable Basic Latin in its coverage data", () => {
  for (const family of FONT_FAMILIES) {
    if (!family.scripts.includes("latin")) continue;
    for (const file of family.files) {
      const gaps = KNOWN_BASIC_LATIN_GAPS[file.file] ?? [];
      const missing: string[] = [];
      for (let point = 0x20; point <= 0x7e; point++)
        if (!gaps.includes(point) && !fontHasCodepoint(family.id, point, file.weight))
          missing.push(String.fromCodePoint(point));
      assert.deepEqual(missing, [], `${file.file} lacks Basic Latin: ${missing.join("")}`);
    }
  }
});

test("supported requested faces stay selected; missing Latin and Korean use bundled fallbacks", () => {
  for (const weight of [400, 700]) {
    assert.equal(resolveFontRuns("Hello", "nunito", weight)[0]?.fontFamily, "nunito");
    const latin = resolveFontRuns("Hello", "anton", weight);
    assert.ok(latin.some((run) => run.fontFamily === "nunito"));
    const korean = resolveFontRuns("안녕하세요", "bangers", weight);
    assert.deepEqual(
      korean.map((run) => [run.start, run.end, run.fontFamily, run.missingCodepoints]),
      [[0, 5, "noto-sans-kr", []]],
    );
    assert.ok(korean.every((run) => run.requestedFontFamily === "bangers"));
    assert.equal(resolveFontRuns("こんにちは", "bangers", weight)[0]?.fontFamily, "noto-sans-jp");
    const combining = "e\u0301";
    assert.deepEqual(
      resolveFontRuns(combining, "bangers", weight).map((run) => [run.start, run.end]),
      [[0, combining.length]],
    );
  }
});

test("unsupported emoji stays one literal cluster with explicit unresolved coverage", () => {
  const text = "A👩‍🚀B";
  const runs = resolveFontRuns(text, "nunito");
  assert.deepEqual(
    runs.map((run) => text.slice(run.start, run.end)),
    ["A", "👩‍🚀", "B"],
  );
  assert.deepEqual(runs[1]?.missingCodepoints, [0x1f469, 0x1f680]);
  assert.equal(runs[1]?.fontFamily, "nunito");
});

test("format controls and blank lines require no painted glyph and retain exact source offsets", () => {
  const text = "\t\r\n\u200d\ufe0f ";
  const runs = resolveFontRuns(text, "anton");
  assert.deepEqual(runs, [
    {
      start: 0,
      end: text.length,
      requestedFontFamily: "anton",
      fontFamily: "anton",
      missingCodepoints: [],
    },
  ]);
});
