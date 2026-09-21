// Studio pack discovery and starter parity (#212). These tests deliberately
// exercise the Studio seam rather than duplicating the CLI's pack tests.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildInitialProject, resolveGenreSeed } from "@toony/project-io";
import { buildStudioProject, discoverStudioPacks } from "../packs.js";

async function writePack(root: string): Promise<void> {
  const pack = join(root, "packs", "night-pack");
  await mkdir(join(pack, "genres"), { recursive: true });
  await mkdir(join(pack, "bands"), { recursive: true });
  const scaffold = buildInitialProject("Pack fixture").episodes[0];
  assert.ok(scaffold);
  await writeFile(
    join(pack, "toony-pack.json"),
    JSON.stringify({
      packFormat: 1,
      id: "night-pack",
      name: "Night Pack",
      genres: [
        {
          id: "night-rail",
          title: "Night Rail",
          file: "genres/night-rail.json",
          gutterBandWidth: 0.32,
        },
      ],
      craftBands: [{ id: "night-band", file: "bands/night-band.json" }],
    }),
  );
  await writeFile(join(pack, "genres/night-rail.json"), JSON.stringify(scaffold));
  await writeFile(
    join(pack, "bands/night-band.json"),
    JSON.stringify({ bandFormat: 1, metrics: { gutterRatio: { min: 0, max: 1 } } }),
  );
}

test("Studio discovers core and installed genres, and carries the exact CLI starter seed", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "toony-studio-packs-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writePack(directory);

  const packs = await discoverStudioPacks(directory, { TOONY_PACKS: join(directory, "packs") });
  assert.deepEqual(
    packs.genreOptions.map((genre) => genre.id),
    ["romance", "comedy", "action", "thriller", "slice-of-life", "night-rail"],
  );
  assert.deepEqual(packs.craftBandOptions, [{ id: "night-band", title: "night-band" }]);

  const seed = await resolveGenreSeed("night-rail", packs.content.genres);
  assert.ok(seed);
  const studio = await buildStudioProject("Night Shift", "night-rail", packs.content);
  assert.deepEqual(
    studio,
    buildInitialProject("Night Shift", seed.bundle, { gutterBandWidth: seed.gutterBandWidth }),
  );
  assert.deepEqual(
    await buildStudioProject("Bare", "", packs.content),
    buildInitialProject("Bare"),
  );
});

test("Studio pack diagnostics never expose an absolute pack directory", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "toony-studio-pack-warning-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const broken = join(directory, "packs", "broken-pack");
  await mkdir(broken, { recursive: true });
  await writeFile(join(broken, "toony-pack.json"), "{");

  const packs = await discoverStudioPacks(directory, { TOONY_PACKS: join(directory, "packs") });
  assert.equal(packs.warnings.length, 1);
  assert.doesNotMatch(
    packs.warnings[0] ?? "",
    new RegExp(directory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
});
