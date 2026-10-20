import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EXPORT_QUALITY_MAX,
  EXPORT_QUALITY_MIN,
  EXPORT_TARGET_KINDS,
  EXPORT_WIDTH_MAX,
  EXPORT_WIDTH_MIN,
  parseExportOptions,
  resolveExportKind,
  validateExportInt,
  validateExportQuality,
  validateExportWidth,
} from "../export-options.js";

test("validateExportInt returns null for undefined and in-range integers", () => {
  assert.equal(validateExportInt(undefined, "width", 1, 100), null);
  assert.equal(validateExportInt(1, "width", 1, 100), null);
  assert.equal(validateExportInt(100, "width", 1, 100), null);
});

test("validateExportInt rejects out-of-range and non-integers with a stable message", () => {
  assert.equal(validateExportInt(0, "width", 1, 100), "width must be an integer between 1 and 100");
  assert.equal(
    validateExportInt(101, "width", 1, 100),
    "width must be an integer between 1 and 100",
  );
  assert.equal(
    validateExportInt(1.5, "width", 1, 100),
    "width must be an integer between 1 and 100",
  );
  assert.equal(
    validateExportInt(Number.NaN, "width", 1, 100),
    "width must be an integer between 1 and 100",
  );
});

test("width/quality helpers use the shared bounds", () => {
  assert.equal(validateExportWidth(EXPORT_WIDTH_MIN), null);
  assert.equal(validateExportWidth(EXPORT_WIDTH_MAX), null);
  assert.equal(validateExportWidth(EXPORT_WIDTH_MAX + 1) !== null, true);
  assert.equal(validateExportQuality(EXPORT_QUALITY_MIN), null);
  assert.equal(validateExportQuality(EXPORT_QUALITY_MAX), null);
  assert.equal(validateExportQuality(EXPORT_QUALITY_MAX + 1) !== null, true);
});

test("export kinds are strip, cuts and social; stitched and platform stay as aliases", () => {
  assert.deepEqual([...EXPORT_TARGET_KINDS], ["strip", "cuts", "social"]);
  assert.equal(resolveExportKind("strip"), "strip");
  assert.equal(resolveExportKind("stitched"), "strip");
  assert.equal(resolveExportKind("platform"), "cuts");
  assert.equal(resolveExportKind("social"), "social");
  for (const retired of ["plotlink", "toString", "", 3, null]) {
    assert.equal(resolveExportKind(retired), null);
  }
});

test("parseExportOptions keeps valid keys and reports every problem by key", () => {
  const ok = parseExportOptions({
    width: 800,
    format: "jpg",
    quality: 90,
    sliceHeight: 1280,
    margin: 24,
    textCards: true,
    frame: "x-landscape",
    tallCuts: "fit",
  });
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.options, {
    width: 800,
    format: "jpeg",
    quality: 90,
    sliceHeight: 1280,
    margin: 24,
    textCards: true,
    frame: "x-landscape",
    tallCuts: "fit",
  });
  const bad = parseExportOptions({
    width: "800",
    sliceHeight: 10,
    maxBytes: 5,
    frame: "story",
    tallCuts: "shrink",
    textCards: "yes",
    encoder: "./enc.js",
  });
  assert.deepEqual(bad.options, {});
  assert.deepEqual(bad.problems.map((problem) => problem.key).sort(), [
    "encoder",
    "frame",
    "maxBytes",
    "sliceHeight",
    "tallCuts",
    "textCards",
    "width",
  ]);
  assert.equal(parseExportOptions([1]).problems[0]?.key, "options");
  assert.deepEqual(parseExportOptions(undefined), { options: {}, problems: [] });
});
