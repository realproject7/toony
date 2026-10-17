import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EXPORT_QUALITY_MAX,
  EXPORT_QUALITY_MIN,
  EXPORT_WIDTH_MAX,
  EXPORT_WIDTH_MIN,
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
