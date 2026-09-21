// Planned geometry stays on the shared plan path (#242): no render, no CLI,
// and no implicit relationship between a project's genre and a craft band.

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { comparePlanToCraftBand, measureEpisodePlan, type PlanBandReport } from "@toony/export";
import type { PackContent } from "@toony/packs";
import { buildInitialProject, writeProject } from "@toony/project-io";
import {
  loadPlannedGeometry,
  rangeMiss,
  transitionVocabularyDetails,
} from "../planned-geometry.js";

const EMPTY_CONTENT: PackContent = {
  workflows: new Map(),
  genres: [],
  exportPresets: [],
  craftBands: new Map(),
};

test("planned geometry agrees with the shared plan report and an explicit selected band", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "toony-studio-plan-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, "work");
  await writeProject(root, buildInitialProject("Geometry fixture"));
  const bandFile = join(root, "night-band.json");
  const bandValue = {
    bandFormat: 1,
    screenAspect: 3,
    metrics: { gutterRatio: { min: 0, max: 1 }, valueMean: { min: 0, max: 255 } },
    recorded: { panelHeightMedian: { min: 0.2, max: 4 } },
  };
  await writeFile(bandFile, JSON.stringify(bandValue));
  const packs: PackContent = { ...EMPTY_CONTENT, craftBands: new Map([["night-band", bandFile]]) };

  const studio = await loadPlannedGeometry(root, "ep-001", "night-band", packs);
  const cliPath = await measureEpisodePlan(root, "ep-001", { screenAspect: 3 });
  assert.deepEqual(studio.measurement, cliPath);
  assert.ok(studio.report);
  assert.deepEqual(studio.report, comparePlanToCraftBand(cliPath, bandValue));
  assert.equal(
    studio.report.unchecked.some((entry) => entry.metric === "valueMean"),
    true,
  );
  assert.ok(Math.abs(rangeMiss(0.1, 0.2, 0.8) - 0.1) < Number.EPSILON);
  assert.ok(Math.abs(rangeMiss(0.9, 0.2, 0.8) - 0.1) < Number.EPSILON);
});

test("no-band and missing-band states do not invent a craft verdict", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "toony-studio-plan-none-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, "work");
  await writeProject(root, buildInitialProject("No band fixture"));

  const noBand = await loadPlannedGeometry(root, "ep-001", "", EMPTY_CONTENT);
  assert.ok(noBand.measurement);
  assert.equal(noBand.report, null);
  assert.equal(noBand.error, null);

  const missing = await loadPlannedGeometry(root, "ep-001", "not-a-band", EMPTY_CONTENT);
  assert.ok(missing.measurement);
  assert.equal(missing.report, null);
  assert.match(missing.error ?? "", /no longer available/);
});

test("transition vocabulary exposes each visible share and height miss behind the aggregate", () => {
  const report = {
    transitions: [
      {
        kinds: ["gutter"],
        count: 2,
        share: { value: 0.25, min: 0.5, max: 0.75, inBand: false },
        height: { value: 0.1, min: 0.2, max: 0.8, inBand: false },
        inBand: false,
      },
    ],
  } satisfies Pick<PlanBandReport, "transitions">;

  const [detail] = transitionVocabularyDetails(report);
  assert.deepEqual(detail, {
    kinds: ["gutter"],
    count: 2,
    share: { value: 0.25, min: 0.5, max: 0.75, inBand: false, miss: 0.25 },
    height: { value: 0.1, min: 0.2, max: 0.8, inBand: false, miss: 0.1 },
    inBand: false,
  });
});
