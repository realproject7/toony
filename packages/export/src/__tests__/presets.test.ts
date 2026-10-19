// The export preset registry merges contributed presets with the built-in
// outputs (#192). Built-ins always win, including the `stitched` and `platform`
// aliases, and a contributed preset may name its engine by an alias.

import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILTIN_OUTPUTS } from "../defaults.js";
import {
  BUILTIN_EXPORT_PRESETS,
  type ContributedExportPreset,
  listExportPresetIds,
  resolveExportPreset,
} from "../presets.js";

const BUILTIN_IDS = ["strip", "cuts", "instagram", "instagram-square", "x", "webtoon"];

const TALL: ContributedExportPreset = {
  id: "webtoon-tall",
  target: "platform",
  options: { width: 1600, format: "jpeg", quality: 88 },
};

test("the built-in presets are the built-in outputs with their pinned options", () => {
  assert.deepEqual(
    BUILTIN_EXPORT_PRESETS.map((preset) => preset.id),
    BUILTIN_IDS,
  );
  assert.deepEqual(
    BUILTIN_EXPORT_PRESETS.map((preset) => preset.target),
    ["strip", "cuts", "social", "social", "social", "strip"],
  );
  // The plain engines pin nothing: each applies its own defaults.
  assert.deepEqual(BUILTIN_EXPORT_PRESETS[0]?.options, {});
  assert.deepEqual(BUILTIN_EXPORT_PRESETS[1]?.options, {});
  assert.deepEqual(BUILTIN_EXPORT_PRESETS.find((preset) => preset.id === "webtoon")?.options, {
    width: 800,
    sliceHeight: 1280,
    format: "jpeg",
    quality: 90,
  });
  assert.deepEqual(
    BUILTIN_EXPORT_PRESETS.filter((preset) => preset.target === "social").map(
      (preset) => preset.options.frame,
    ),
    ["instagram-portrait", "instagram-square", "x-landscape"],
  );
  assert.equal(BUILTIN_OUTPUTS.length, BUILTIN_EXPORT_PRESETS.length);
});

test("with no contributed presets the registry is exactly the built-ins", async () => {
  assert.deepEqual(await listExportPresetIds(), BUILTIN_IDS);
  assert.deepEqual(await listExportPresetIds([]), BUILTIN_IDS);
});

test("stitched and platform resolve to the strip and cuts outputs", async () => {
  assert.equal((await resolveExportPreset("stitched"))?.id, "strip");
  assert.equal((await resolveExportPreset("platform"))?.id, "cuts");
  assert.equal(await resolveExportPreset("plotlink"), undefined);
});

test("a contributed preset is offered and resolves with its engine alias normalized", async () => {
  assert.deepEqual(await listExportPresetIds([TALL]), [...BUILTIN_IDS, "webtoon-tall"]);
  assert.deepEqual(await resolveExportPreset("webtoon-tall", [TALL]), {
    id: "webtoon-tall",
    target: "cuts",
    options: { width: 1600, format: "jpeg", quality: 88 },
  });
});

test("a contributed preset cannot redefine a built-in or an alias", async () => {
  const hijacks: ContributedExportPreset[] = [
    { id: "cuts", target: "strip", options: { width: 99 } },
    { id: "platform", target: "strip", options: { width: 99 } },
  ];
  assert.deepEqual(await resolveExportPreset("cuts", hijacks), {
    id: "cuts",
    target: "cuts",
    options: {},
  });
  assert.equal((await resolveExportPreset("platform", hijacks))?.target, "cuts");
  assert.deepEqual(await listExportPresetIds(hijacks), BUILTIN_IDS);
});

test("contributed presets present but unselected do not change a built-in", async () => {
  for (const id of BUILTIN_IDS) {
    assert.deepEqual(await resolveExportPreset(id, [TALL]), await resolveExportPreset(id));
  }
});

test("an unknown preset id resolves to undefined rather than throwing", async () => {
  assert.equal(await resolveExportPreset("gif"), undefined);
  assert.equal(await resolveExportPreset("gif", [TALL]), undefined);
});

test("registry lookups return Promises", () => {
  assert.ok(listExportPresetIds() instanceof Promise);
  assert.ok(resolveExportPreset("strip") instanceof Promise);
});
