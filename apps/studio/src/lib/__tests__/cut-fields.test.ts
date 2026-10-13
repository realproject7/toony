// Editing a cut's own fields from Studio (#332): the save round-trips through
// the surgical writer, leaves every other file byte-identical, keeps the render
// record, marks the cut human-edited, writes nothing for a no-op, and refuses an
// invalid shape with nothing written.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { buildInitialProject, loadProject, writeCuts, writeProject } from "@toony/project-io";
import type { Character, Cut } from "@toony/schema";
import {
  applyCutFields,
  cutFieldsOf,
  describeCutFieldsProblem,
  isCutFieldsPayload,
  saveCutFields,
} from "../cut-fields.js";

const CAST: Character[] = [{ id: "mira", name: "Mira", lockstring: "teal coat" }];

let workdir: string;
beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), "toony-cut-fields-"));
});
afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

async function newProject(): Promise<{ root: string; episodeId: string; cut: Cut }> {
  const root = join(workdir, "demo");
  const project = buildInitialProject("demo");
  project.webtoon.characters = CAST;
  await writeProject(root, project);
  const loaded = await loadProject(root);
  const bundle = loaded.project.episodes[0];
  assert.ok(bundle);
  // A cut that has been rendered: the record must survive a field edit.
  const cuts = bundle.cuts.map((c, i) =>
    i === 0
      ? { ...c, imagePrompt: "a rooftop at dusk", imageSeed: 4242, imageWorkflow: "default" }
      : c,
  );
  await writeCuts(root, bundle.episode.id, cuts);
  const cut = cuts[0];
  assert.ok(cut);
  return { root, episodeId: bundle.episode.id, cut };
}

async function snapshot(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  async function walk(dir: string, rel: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const next = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) await walk(join(dir, entry.name), next);
      else
        out.set(
          next,
          createHash("sha256")
            .update(await readFile(join(dir, entry.name)))
            .digest("hex"),
        );
    }
  }
  await walk(root, "");
  return out;
}

async function readCut(root: string, episodeId: string, cutId: string): Promise<Cut> {
  const loaded = await loadProject(root);
  const cut = loaded.project.episodes
    .find((b) => b.episode.id === episodeId)
    ?.cuts.find((c) => c.id === cutId);
  assert.ok(cut);
  return cut;
}

test("applyCutFields changes only what differs, marks the cut human-edited, and keeps the render record", () => {
  const cut: Cut = {
    id: "cut-001",
    image: { clean: "episodes/ep-001/assets/clean/cut-001.png", final: null },
    imagePrompt: "a rooftop",
    negativePrompt: "",
    imageSeed: 7,
    imageWorkflow: "wf",
    reviewStatus: "final",
  };
  const same = applyCutFields(cut, cutFieldsOf(cut));
  assert.equal(same.next, cut);
  assert.deepEqual(same.changed, []);

  const { next, changed } = applyCutFields(cut, {
    ...cutFieldsOf(cut),
    imagePrompt: "a pier",
    characters: ["mira", " mira ", ""],
    shotType: "close_up",
    palette: "  #9fb4c7 ",
    panelAspect: 1.4,
  });
  assert.deepEqual(changed, ["imagePrompt", "characters", "shotType", "palette", "panelAspect"]);
  assert.equal(next.imagePrompt, "a pier");
  assert.deepEqual(next.characters, ["mira"]);
  assert.equal(next.shotType, "close_up");
  assert.equal(next.palette, "#9fb4c7");
  assert.equal(next.panelAspect, 1.4);
  assert.equal(next.reviewStatus, "human-edited");
  assert.equal(next.imageSeed, 7);
  assert.equal(next.imageWorkflow, "wf");
  assert.deepEqual(next.image, cut.image);

  const cleared = applyCutFields(next, {
    ...cutFieldsOf(next),
    characters: [],
    palette: "",
    shotType: null,
    panelAspect: null,
  });
  assert.equal(Object.hasOwn(cleared.next, "characters"), false);
  assert.equal(Object.hasOwn(cleared.next, "palette"), false);
  assert.equal(Object.hasOwn(cleared.next, "shotType"), false);
  assert.equal(Object.hasOwn(cleared.next, "panelAspect"), false);
});

test("saveCutFields writes only cuts.yaml and leaves every other file byte-identical", async () => {
  const { root, episodeId, cut } = await newProject();
  const before = await snapshot(root);
  const result = await saveCutFields(root, {
    workId: "demo",
    episodeId,
    cutId: cut.id,
    fields: {
      ...cutFieldsOf(cut),
      imagePrompt: "a pier at dawn",
      characters: ["mira"],
      panelAspect: 1.4,
    },
  });
  assert.deepEqual(result, { ok: true, changed: ["imagePrompt", "characters", "panelAspect"] });
  const after = await snapshot(root);
  for (const [file, digest] of before) {
    if (file.endsWith("cuts.yaml")) assert.notEqual(after.get(file), digest);
    else assert.equal(after.get(file), digest, file);
  }
  const saved = await readCut(root, episodeId, cut.id);
  assert.equal(saved.imagePrompt, "a pier at dawn");
  assert.deepEqual(saved.characters, ["mira"]);
  assert.equal(saved.panelAspect, 1.4);
  assert.equal(saved.reviewStatus, "human-edited");
  assert.equal(saved.imageSeed, 4242, "the render record survives a prompt edit");
  assert.equal(saved.imageWorkflow, "default");
  assert.equal((await loadProject(root)).validation.valid, true);
});

test("a save that changes nothing writes nothing", async () => {
  const { root, episodeId, cut } = await newProject();
  const before = await snapshot(root);
  const result = await saveCutFields(root, {
    workId: "demo",
    episodeId,
    cutId: cut.id,
    fields: cutFieldsOf(cut),
  });
  assert.deepEqual(result, { ok: true, changed: [] });
  assert.deepEqual(await snapshot(root), before);
  assert.equal(
    (await readCut(root, episodeId, cut.id)).reviewStatus,
    undefined,
    "an untouched cut keeps its mark",
  );
});

test("an out-of-range shape is refused before the validator and nothing is written", async () => {
  const { root, episodeId, cut } = await newProject();
  assert.match(
    describeCutFieldsProblem({ ...cutFieldsOf(cut), panelAspect: 99 }) ?? "",
    /between 0.1 and 10/,
  );
  const before = await snapshot(root);
  const result = await saveCutFields(root, {
    workId: "demo",
    episodeId,
    cutId: cut.id,
    fields: { ...cutFieldsOf(cut), panelAspect: 99 },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(await snapshot(root), before);
  const unknown = await saveCutFields(root, {
    workId: "demo",
    episodeId,
    cutId: "ghost",
    fields: cutFieldsOf(cut),
  });
  assert.equal(unknown.ok, false);
});

test("the payload guard admits the editable fields and nothing else", () => {
  const fields = {
    imagePrompt: "x",
    negativePrompt: "",
    characters: ["mira"],
    shotType: null,
    palette: null,
    panelAspect: null,
  };
  assert.equal(isCutFieldsPayload({ workId: "w", episodeId: "e", cutId: "c", fields }), true);
  assert.equal(
    isCutFieldsPayload({
      workId: "w",
      episodeId: "e",
      cutId: "c",
      fields: { ...fields, shotType: "wide" },
    }),
    false,
  );
  assert.equal(
    isCutFieldsPayload({
      workId: "w",
      episodeId: "e",
      cutId: "c",
      fields: { ...fields, characters: "mira" },
    }),
    false,
  );
  assert.equal(
    isCutFieldsPayload({
      workId: "w",
      episodeId: "e",
      cutId: "c",
      fields: { ...fields, panelAspect: "1.4" },
    }),
    false,
  );
  assert.equal(isCutFieldsPayload({ workId: "w", episodeId: "e", fields }), false);
  assert.equal(isCutFieldsPayload(null), false);
});
