// Scaffolder tests: deterministic writes, documented folder layout, and that a
// hand-built project (schema fixture) round-trips through write + load.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import type { Project } from "@toony/schema";
import { loadProject } from "../loader.js";
import { buildInitialProject, slugify, writeProject } from "../scaffold.js";

let workdir: string;

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), "toony-scaffold-"));
});

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

test("slugify normalizes names to safe ids", () => {
  assert.equal(slugify("My Demo Webtoon"), "my-demo-webtoon");
  assert.equal(slugify("  Spaced  "), "spaced");
  assert.equal(slugify("***"), "untitled");
});

test("buildInitialProject produces a valid starter project", () => {
  const project = buildInitialProject("Lantern Tide");
  assert.equal(project.webtoon.projectId, "lantern-tide");
  assert.equal(project.webtoon.languages.defaultLanguage, "en");
  assert.equal(project.episodes.length, 1);
  assert.equal(project.episodes[0]?.episode.sequence.length, 3);
});

test("writeProject creates the documented folder layout", async () => {
  const root = join(workdir, "demo");
  await writeProject(root, buildInitialProject("demo"));

  for (const path of [
    "webtoon.json",
    "story-bible.md",
    "style-guide.md",
    "characters",
    "assets",
    "logs",
    "episodes/ep-001/episode.json",
    "episodes/ep-001/cuts.json",
    "episodes/ep-001/transitions.json",
    "episodes/ep-001/lettering.json",
    "episodes/ep-001/assets/clean",
    "episodes/ep-001/exports/plotlink",
  ]) {
    await assert.doesNotReject(stat(join(root, path)), `expected ${path} to exist`);
  }
});

test("writeProject is deterministic across runs", async () => {
  const a = join(workdir, "a");
  const b = join(workdir, "b");
  await writeProject(a, buildInitialProject("demo"));
  await writeProject(b, buildInitialProject("demo"));

  const fileA = await readFile(join(a, "webtoon.json"), "utf8");
  const fileB = await readFile(join(b, "webtoon.json"), "utf8");
  assert.equal(fileA, fileB);
});

test("a multi-record project with lettering loads and validates", async () => {
  // A fuller fixture than the starter: two cuts, one transition, and overlays
  // exercising the loader's cross-file assembly and schema validation.
  const fixture: Project = {
    webtoon: {
      schemaVersion: 1,
      projectId: "lantern-tide",
      title: "Lantern Tide",
      languages: {
        defaultLanguage: "en",
        supportedLanguages: ["en", "ko"],
        dialogueLanguage: "en",
        promptLanguage: "en",
      },
      imageProviders: { defaultProvider: "manual", providers: [] },
    },
    episodes: [
      {
        episode: {
          schemaVersion: 1,
          id: "ep-001",
          title: "First Light",
          sequence: [
            { type: "cut", id: "cut-001" },
            { type: "transition", id: "tr-001" },
            { type: "cut", id: "cut-002" },
          ],
        },
        cuts: [
          { id: "cut-001", image: { clean: "assets/clean/cut-001.webp", final: null } },
          { id: "cut-002", image: null },
        ],
        transitions: [
          {
            id: "tr-001",
            type: "gutter",
            gutterHeight: 48,
            text: null,
            sfx: null,
            agentNote: null,
            humanNote: null,
            image: null,
            reviewStatus: "draft",
          },
        ],
        lettering: [
          {
            id: "ov-001",
            cutId: "cut-001",
            speaker: "Mira",
            kind: "speech",
            text: "The tide remembers every name.",
            font: "Nanum Gothic",
            fill: "#ffffff",
            opacity: 1,
            border: { width: 2, color: "#101010" },
            tail: { x: 0.42, y: 0.78 },
            geometry: { x: 0.1, y: 0.12, width: 0.45, height: 0.2 },
            overflow: false,
            reviewStatus: "human-edited",
          },
        ],
      },
    ],
  };

  const root = join(workdir, "fixture");
  await writeProject(root, fixture);
  const loaded = await loadProject(root);
  assert.equal(loaded.validation.valid, true, JSON.stringify(loaded.validation.issues));
  assert.equal(loaded.project.webtoon.projectId, "lantern-tide");
  assert.equal(loaded.project.episodes[0]?.cuts.length, 2);
  assert.equal(loaded.project.episodes[0]?.lettering.length, 1);
});
