// The example pack committed at packages/packs/examples/example-pack is the
// reference a pack author copies, so it has to actually load. This pins that it
// is discoverable and contributes every kind — if the format changes and the
// example is not updated with it, this fails.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadPacks, PACKS_ENV_VAR } from "../index.js";

// This test file compiles to dist/__tests__/, so the package root is two up.
const EXAMPLES_ROOT = fileURLToPath(new URL("../../examples", import.meta.url));

test("the committed example pack loads and contributes every kind", async () => {
  const loaded = await loadPacks(EXAMPLES_ROOT, { [PACKS_ENV_VAR]: EXAMPLES_ROOT });
  assert.deepEqual(loaded.issues, [], JSON.stringify(loaded.issues, null, 2));
  assert.deepEqual(
    loaded.packs.map((pack) => pack.id),
    ["example-pack"],
  );

  assert.ok(loaded.content.workflows.has("high-detail"));
  assert.match(loaded.content.workflows.get("high-detail") ?? "", /high-detail\.workflow\.json$/);

  const noir = loaded.content.genres.find((genre) => genre.id === "noir");
  assert.ok(noir, "the example pack contributes the noir genre");
  assert.equal(noir.title, "Noir");
  assert.equal(noir.bundle.cuts.length, 4);

  assert.deepEqual(loaded.content.exportPresets, [
    {
      id: "webtoon-tall",
      target: "platform",
      options: { width: 1600, format: "jpeg", quality: 88 },
    },
  ]);

  // The band is carried as a path; that it is a WELL-FORMED band is `toony
  // measure`'s business, so read the file here and check the shape the example
  // is meant to demonstrate.
  const bandFile = loaded.content.craftBands.get("noir-band");
  assert.ok(bandFile, "the example pack contributes the noir band");
  assert.match(bandFile, /bands\/noir\.json$/);
  const band = JSON.parse(await readFile(bandFile, "utf8"));
  assert.equal(band.bandFormat, 1);
  assert.equal(band.screenAspect, 2);
  assert.ok(Object.keys(band.metrics).length > 0);
});
