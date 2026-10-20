// Regressions for the shared helpers Studio's write path and the CLI both use:
// numeric episode order, zero-padded new ids, an empty project that still
// loads, the `toony init` starter shared with Studio, the manual import of
// in-memory image bytes, the dialogue lettering a compiled draft places, and
// the story bible writer.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { compileDialogueOverlays } from "../draft.js";
import { compareEpisodeIds, nextEpisodeId, sortEpisodeIds } from "../episode-order.js";
import { importImageBytes } from "../ingest.js";
import { loadProject } from "../reader.js";
import { buildInitialProject, buildSeededProject } from "../scaffold.js";
import { readStoryBible, STORY_BIBLE_TEMPLATE, writeStoryBible } from "../story-bible.js";
import { writeProject } from "../writer.js";

// Named fixture: a real 1x1 PNG, accepted by the common metadata stripper.
const PNG_FIXTURE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n5sAAAAASUVORK5CYII=",
  "base64",
);

async function tempDir(t: { after: (fn: () => Promise<void>) => void }): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "toony-helpers-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("episode ids sort by number, not by text", () => {
  assert.deepEqual(sortEpisodeIds(["ep-10", "ep-2", "ep-001", "ep-1a", "intro"]), [
    "ep-001",
    "ep-1a",
    "ep-2",
    "ep-10",
    "intro",
  ]);
  assert.ok(compareEpisodeIds("ep-9", "ep-10") < 0);
  assert.ok(compareEpisodeIds("ep-02", "ep-2") !== 0, "padding still orders deterministically");
  assert.equal(compareEpisodeIds("ep-3", "ep-3"), 0);
});

test("new episode ids are zero-padded and never reuse a taken number", () => {
  assert.equal(nextEpisodeId([]), "ep-001");
  assert.equal(nextEpisodeId(["ep-001", "ep-002"]), "ep-003");
  assert.equal(nextEpisodeId(["ep-2", "ep-10", "extra"]), "ep-011");
  assert.equal(nextEpisodeId(["EP-004"]), "ep-005");
  assert.equal(nextEpisodeId(["ep-999"]), "ep-1000");
});

test("the loader reads the episodes folder in numeric order", async (t) => {
  const dir = await tempDir(t);
  const root = join(dir, "order");
  const project = buildInitialProject("Order");
  const first = project.episodes[0];
  assert.ok(first);
  const copy = (id: string) => ({
    ...structuredClone(first),
    episode: { ...structuredClone(first.episode), id, title: id },
  });
  project.episodes = [copy("ep-10"), copy("ep-2")];
  await writeProject(root, project);
  const loaded = await loadProject(root);
  assert.deepEqual(
    loaded.project.episodes.map((bundle) => bundle.episode.id),
    ["ep-2", "ep-10"],
  );
});

test("a project written with no episodes keeps an episodes folder and loads", async (t) => {
  const dir = await tempDir(t);
  const root = join(dir, "empty");
  const project = buildInitialProject("Empty");
  project.episodes = [];
  await writeProject(root, project);
  assert.deepEqual(await readdir(join(root, "episodes")), []);
  const loaded = await loadProject(root);
  assert.equal(loaded.validation.valid, true);
  assert.deepEqual(loaded.project.episodes, []);
});

test("the seeded starter matches toony init and refuses an unknown genre", async () => {
  const blank = await buildSeededProject("Night Shift", undefined);
  assert.deepEqual(blank, buildInitialProject("Night Shift"));
  const bundle = buildInitialProject("x").episodes[0];
  assert.ok(bundle);
  const scaffold = {
    id: "harbor",
    title: "Harbor",
    bundle,
    gutterBandWidth: 0.25,
    letteringTheme: "harbor-theme",
    styleLexicon: "harbor-style",
  };
  const seeded = await buildSeededProject("Night Shift", "harbor", [scaffold]);
  assert.ok(seeded);
  assert.equal(seeded.webtoon.gutterBandWidth, 0.25);
  assert.equal(seeded.webtoon.letteringTheme, "harbor-theme");
  assert.equal(seeded.webtoon.styleLexicon, "harbor-style");
  assert.equal(await buildSeededProject("Night Shift", "missing-genre"), null);
});

test("imported bytes are stored the way a manual import stores a file", async (t) => {
  const dir = await tempDir(t);
  const root = join(dir, "import");
  const project = buildInitialProject("Import");
  const cut = project.episodes[0]?.cuts[0];
  assert.ok(cut);
  cut.reviewStatus = "final";
  await writeProject(root, project);
  const result = await importImageBytes(
    root,
    { kind: "cut", episodeId: "ep-001", cutId: "cut-001", slot: "clean" },
    PNG_FIXTURE,
  );
  assert.equal(result.assetPath, "episodes/ep-001/assets/clean/cut-001.png");
  assert.equal(result.provenance.source, "manual");
  const loaded = await loadProject(root);
  const saved = loaded.project.episodes[0]?.cuts[0];
  assert.equal(saved?.image?.clean, result.assetPath);
  assert.equal(saved?.reviewStatus, "draft", "new artwork resets the review mark");
  const log = JSON.parse(await readFile(join(root, "episodes/ep-001/logs/ingest.json"), "utf8"));
  assert.equal(log[0]?.providerId, "manual");
  await assert.rejects(
    importImageBytes(
      root,
      { kind: "cut", episodeId: "ep-001", cutId: "cut-002", slot: "clean" },
      new TextEncoder().encode("not an image"),
    ),
    /not a recognized image/,
  );
  assert.equal((await loadProject(root)).project.episodes[0]?.cuts[1]?.image, null);
});

test("dialogue lettering stacks one box per line and skips taken ids", () => {
  const names = new Map([["mira", "Mira"]]);
  const { overlays, defaults } = compileDialogueOverlays(
    "cut-004",
    [
      { speaker: "mira", text: "Who is there?" },
      { speaker: null, text: "The pier was empty." },
    ],
    names,
    { takenIds: new Set(["ov-cut-004-1"]) },
  );
  assert.deepEqual(
    overlays.map((o) => [o.id, o.kind, o.speaker, o.text]),
    [
      ["ov-cut-004-2", "speech", "Mira", "Who is there?"],
      ["ov-cut-004-3", "narration", "", "The pier was empty."],
    ],
  );
  assert.ok((overlays[1]?.geometry.y ?? 0) > (overlays[0]?.geometry.y ?? 0));
  assert.ok(defaults.some((d) => d.id === "ov-cut-004-2" && d.field === "geometry"));
});

test("the story bible writer normalizes text and blank text restores the template", async (t) => {
  const root = await tempDir(t);
  await mkdir(root, { recursive: true });
  await writeStoryBible(root, "# Harbor\r\n\r\nFog every night.  \n\n");
  assert.equal(
    await readFile(join(root, "story-bible.md"), "utf8"),
    "# Harbor\n\nFog every night.\n",
  );
  assert.equal(await readStoryBible(root), "# Harbor\n\nFog every night.");
  await writeStoryBible(root, "   ");
  assert.equal(await readFile(join(root, "story-bible.md"), "utf8"), STORY_BIBLE_TEMPLATE);
  assert.equal(await readStoryBible(root), "");
});
