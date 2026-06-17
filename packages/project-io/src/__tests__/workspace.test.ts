// Tests for the workspace scan (listWorkspace).

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import type { Project } from "@toony/schema";
import { buildInitialProject } from "../scaffold.js";
import { listWorkspace } from "../workspace.js";
import { writeProject } from "../writer.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "toony-workspace-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A work whose first cut carries a project-relative image, for cover tests. */
function workWithCover(): Project {
  return {
    webtoon: {
      schemaVersion: 1,
      projectId: "zeta-tide",
      title: "Zeta Tide",
      languages: {
        defaultLanguage: "en",
        supportedLanguages: ["en"],
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
          {
            id: "cut-001",
            image: { clean: "assets/clean/cut-001.webp", final: null },
            imagePrompt: "",
            negativePrompt: "",
          },
          { id: "cut-002", image: null, imagePrompt: "", negativePrompt: "" },
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
        lettering: [],
      },
    ],
  };
}

test("scans works, ignores non-projects and dot-folders, sorted by id", async () => {
  await writeProject(join(root, "alpha"), buildInitialProject("alpha"));
  await writeProject(join(root, "zeta"), workWithCover());
  // Noise the scan must ignore:
  await mkdir(join(root, "not-a-project"), { recursive: true });
  await writeFile(join(root, "not-a-project", "notes.txt"), "scratch", "utf8");
  await mkdir(join(root, ".toony"), { recursive: true });
  await writeFile(join(root, "loose-file.txt"), "ignore me", "utf8");

  const entries = await listWorkspace(root);
  assert.deepEqual(
    entries.map((e) => e.id),
    ["alpha", "zeta"],
  );
});

test("summaries report correct title, counts, and cover", async () => {
  await writeProject(join(root, "alpha"), buildInitialProject("alpha"));
  await writeProject(join(root, "zeta"), workWithCover());

  const byId = Object.fromEntries((await listWorkspace(root)).map((e) => [e.id, e]));

  // alpha: scaffold default — 1 episode, 2 cuts, no image.
  assert.equal(byId.alpha?.title, "Alpha");
  assert.equal(byId.alpha?.episodeCount, 1);
  assert.equal(byId.alpha?.cutCount, 2);
  assert.equal(byId.alpha?.coverImagePath, null);

  // zeta: title from webtoon.json, cover = first cut's project-relative image.
  assert.equal(byId.zeta?.title, "Zeta Tide");
  assert.equal(byId.zeta?.episodeCount, 1);
  assert.equal(byId.zeta?.cutCount, 2);
  assert.equal(byId.zeta?.coverImagePath, "assets/clean/cut-001.webp");
});

test("updatedAt is a valid ISO timestamp for each work", async () => {
  await writeProject(join(root, "alpha"), buildInitialProject("alpha"));
  for (const entry of await listWorkspace(root)) {
    assert.ok(!Number.isNaN(Date.parse(entry.updatedAt)), entry.updatedAt);
    assert.equal(entry.updatedAt, new Date(entry.updatedAt).toISOString());
  }
});

test("the scan is deterministic across repeated calls", async () => {
  await writeProject(join(root, "alpha"), buildInitialProject("alpha"));
  await writeProject(join(root, "zeta"), workWithCover());
  assert.deepEqual(await listWorkspace(root), await listWorkspace(root));
});

test("a folder with malformed webtoon.json stays listed under its folder id", async () => {
  await mkdir(join(root, "broken"), { recursive: true });
  await writeFile(join(root, "broken", "webtoon.json"), "{ not valid json", "utf8");

  const entries = await listWorkspace(root);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.id, "broken");
  assert.equal(entries[0]?.title, "broken"); // falls back to the folder id
  assert.equal(entries[0]?.episodeCount, 0);
  assert.equal(entries[0]?.cutCount, 0);
  assert.equal(entries[0]?.coverImagePath, null);
});

test("a missing or empty workspace root scans as empty", async () => {
  assert.deepEqual(await listWorkspace(join(root, "does-not-exist")), []);
  assert.deepEqual(await listWorkspace(root), []);
});
