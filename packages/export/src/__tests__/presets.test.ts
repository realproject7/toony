// The export preset registry merges contributed presets with the three built-in
// engines (#192). The built-ins must pin nothing — that is what makes the
// zero-pack path identical to the pre-seam behaviour — and must always win.

import assert from "node:assert/strict";
import { test } from "node:test";
import { EXPORT_TARGET_KINDS } from "@toony/schema";
import {
  BUILTIN_EXPORT_PRESETS,
  type ExportPreset,
  listExportPresetIds,
  resolveExportPreset,
} from "../presets.js";

const TALL: ExportPreset = {
  id: "webtoon-tall",
  target: "platform",
  options: { width: 1600, format: "jpeg", quality: 88 },
};

test("the built-in presets are one per engine and pin no options", () => {
  assert.deepEqual(
    BUILTIN_EXPORT_PRESETS.map((preset) => preset.id),
    [...EXPORT_TARGET_KINDS],
  );
  for (const preset of BUILTIN_EXPORT_PRESETS) {
    assert.equal(preset.target, preset.id);
    // Empty options mean each engine applies its own default width/format/
    // quality, exactly as it did before presets existed.
    assert.deepEqual(preset.options, {});
  }
});

test("with no contributed presets the registry is exactly the three built-ins", async () => {
  assert.deepEqual(await listExportPresetIds(), [...EXPORT_TARGET_KINDS]);
  assert.deepEqual(await listExportPresetIds([]), [...EXPORT_TARGET_KINDS]);
  for (const kind of EXPORT_TARGET_KINDS) {
    assert.deepEqual(await resolveExportPreset(kind), { id: kind, target: kind, options: {} });
  }
});

test("a contributed preset is offered and resolves with its pinned options", async () => {
  assert.deepEqual(await listExportPresetIds([TALL]), [...EXPORT_TARGET_KINDS, "webtoon-tall"]);
  assert.deepEqual(await resolveExportPreset("webtoon-tall", [TALL]), TALL);
});

test("a contributed preset cannot redefine a built-in", async () => {
  const hijack: ExportPreset = { id: "platform", target: "plotlink", options: { width: 99 } };
  assert.deepEqual(await resolveExportPreset("platform", [hijack]), {
    id: "platform",
    target: "platform",
    options: {},
  });
  assert.deepEqual(await listExportPresetIds([hijack]), [...EXPORT_TARGET_KINDS]);
});

test("contributed presets present but unselected do not change a built-in", async () => {
  for (const kind of EXPORT_TARGET_KINDS) {
    assert.deepEqual(await resolveExportPreset(kind, [TALL]), await resolveExportPreset(kind));
  }
});

test("an unknown preset id resolves to undefined rather than throwing", async () => {
  assert.equal(await resolveExportPreset("gif"), undefined);
  assert.equal(await resolveExportPreset("gif", [TALL]), undefined);
});

test("registry lookups return Promises", () => {
  assert.ok(listExportPresetIds() instanceof Promise);
  assert.ok(resolveExportPreset("platform") instanceof Promise);
});
