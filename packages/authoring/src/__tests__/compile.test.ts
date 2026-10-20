// The shared compile orchestration: what it writes, what it refuses, and that
// the written draft applies through project-io's own apply.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  applyDraft,
  buildInitialProject,
  draftPath,
  loadProject,
  writeBrief,
  writeEpisodeScript,
  writeProject,
  writeWebtoon,
} from "@toony/project-io";
import {
  EPISODE_SCRIPT_FORMAT_VERSION,
  type EpisodeScript,
  type LetteringTheme,
  PRODUCTION_BRIEF_FORMAT_VERSION,
} from "@toony/schema";
import { compileEpisodeDraft, DRAFT_LINTS_NOT_RUN } from "../index.js";

async function project(t: { after: (fn: () => Promise<void>) => void }): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "toony-authoring-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "work");
  const model = buildInitialProject("Harbor");
  model.webtoon.characters = [{ id: "mira", name: "Mira", lockstring: "teal coat" }];
  model.episodes = [];
  await writeProject(root, model);
  return root;
}

async function script(root: string, episodeId: string, over: Partial<EpisodeScript> = {}) {
  const briefRevision = await writeBrief(root, {
    briefFormat: PRODUCTION_BRIEF_FORMAT_VERSION,
    intent: "A harbour short.",
    audience: "Anyone.",
    world: "A harbour.",
    storyGoals: ["Keep it short."],
  });
  const value: EpisodeScript = {
    scriptFormat: EPISODE_SCRIPT_FORMAT_VERSION,
    episodeId,
    briefRevision,
    title: "Fog",
    beats: [
      {
        id: "beat-1",
        purpose: "Open.",
        cuts: [
          {
            id: "cut-001",
            intent: "Place us.",
            scene: "A pier in fog.",
            dialogue: [{ speaker: "mira", text: "Hello?" }],
            transitionAfter: { type: "beat" },
          },
          { id: "cut-002", intent: "Answer.", scene: "A lamp turns on." },
        ],
      },
    ],
    ...over,
  };
  await writeEpisodeScript(root, value);
  return value;
}

test("a compiled script writes a draft that applies as a new episode", async (t) => {
  const root = await project(t);
  await script(root, "ep-001");
  const result = await compileEpisodeDraft({
    root,
    episodeId: "ep-001",
    loaded: await loadProject(root),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.bundle.cuts.length, 2);
  assert.equal(result.bundle.lettering[0]?.speaker, "Mira");
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.diff.episodeExists, false);
  assert.equal(result.letteringTheme, null);
  assert.ok(result.measurement.cuts === 2);
  assert.deepEqual(DRAFT_LINTS_NOT_RUN.length, 3);
  const written = JSON.parse(await readFile(draftPath(root, "ep-001"), "utf8"));
  assert.equal(written.episodeId, "ep-001");
  assert.notEqual(written.reviewedAgainst, null);
  const applied = await applyDraft(root, "ep-001");
  assert.equal(applied.applied, true);
  const loaded = await loadProject(root);
  assert.equal(loaded.validation.valid, true);
  assert.equal(loaded.project.episodes[0]?.episode.title, "Fog");
});

test("refusals name their stage and write no draft", async (t) => {
  const root = await project(t);
  const loaded = await loadProject(root);
  const absent = await compileEpisodeDraft({ root, episodeId: "ep-001", loaded });
  assert.deepEqual(absent, { ok: false, stage: "script-absent" });

  await script(root, "ep-002", {
    beats: [
      {
        id: "beat-1",
        purpose: "Open.",
        cuts: [
          {
            id: "cut-001",
            intent: "Only.",
            scene: "Nothing after.",
            transitionAfter: { type: "beat" },
          },
        ],
      },
    ],
  });
  const compileError = await compileEpisodeDraft({ root, episodeId: "ep-002", loaded });
  assert.equal(compileError.ok, false);
  assert.equal(!compileError.ok && compileError.stage, "compile");
  await assert.rejects(readFile(draftPath(root, "ep-002")));
});

test("the project's lettering theme is applied, and a missing one is reported", async (t) => {
  const root = await project(t);
  await script(root, "ep-001");
  const before = await loadProject(root);
  await writeWebtoon(root, { ...before.project.webtoon, letteringTheme: "harbor" });
  const loaded = await loadProject(root);
  const missing: string[] = [];
  const unthemed = await compileEpisodeDraft({
    root,
    episodeId: "ep-001",
    loaded,
    onThemeMissing: (id) => missing.push(id),
  });
  assert.deepEqual(missing, ["harbor"]);
  assert.deepEqual(unthemed.ok && unthemed.letteringTheme, { id: "harbor", applied: false });

  const theme: LetteringTheme = {
    themeFormat: 1,
    kinds: { speech: { fontFamily: "noto-sans-kr", textColor: "#102030" } },
  };
  const themed = await compileEpisodeDraft({
    root,
    episodeId: "ep-001",
    loaded,
    letteringThemes: [{ id: "harbor", theme }],
  });
  assert.equal(themed.ok, true);
  if (!themed.ok) return;
  assert.deepEqual(themed.letteringTheme, { id: "harbor", applied: true });
  assert.equal(themed.bundle.lettering[0]?.textColor, "#102030");
  assert.equal(themed.bundle.lettering[0]?.fontFamily, "noto-sans-kr");
});
