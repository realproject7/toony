// The character registry from Studio (#328): a save goes through the surgical
// writer and leaves every episode file byte-identical, a no-op writes nothing,
// an invalid registry is refused with nothing written, ids are made once and
// kept unique, and uses and sheets are read as they are.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { buildInitialProject, loadProject, writeCuts, writeProject } from "@toony/project-io";
import {
  characterRows,
  cutsNaming,
  isCharactersPayload,
  newCharacterId,
  saveCharacters,
} from "../characters.js";

let workdir: string;
beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), "toony-characters-"));
});
afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

async function newProject(): Promise<string> {
  const root = join(workdir, "demo");
  const project = buildInitialProject("demo");
  project.webtoon.characters = [
    {
      id: "mira",
      name: "Mira",
      lockstring: "teal coat",
      references: ["characters/mira/sheet.png"],
    },
    { id: "sol", name: "Sol", lockstring: "grey scarf" },
  ];
  await writeProject(root, project);
  const loaded = await loadProject(root);
  const bundle = loaded.project.episodes[0];
  assert.ok(bundle);
  await writeCuts(
    root,
    bundle.episode.id,
    bundle.cuts.map((c, i) => (i === 0 ? { ...c, characters: ["mira"] } : c)),
  );
  await mkdir(join(root, "characters", "mira"), { recursive: true });
  await writeFile(join(root, "characters", "mira", "sheet.png"), "png bytes");
  return root;
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

test("identity, development and wardrobe survive Studio registry saves", async () => {
  const root = await newProject();
  const loaded = await loadProject(root);
  const characters = loaded.project.webtoon.characters ?? [];
  assert.ok(characters[0]);
  characters[0].visualIdentity = "Cropped hair and round glasses";
  characters[0].wardrobe = [{ id: "work", description: "Teal work coat" }];
  characters[0].development = {
    role: "Lead",
    desire: "Earn trust",
    flaw: "Avoids asking",
    voice: "Direct",
    arc: "Accept help",
  };
  assert.deepEqual(await saveCharacters(root, characters), { ok: true, changed: true });
  assert.deepEqual((await loadProject(root)).project.webtoon.characters, characters);
});

test("rows carry each character's uses and whether its sheets are on disk", async () => {
  const root = await newProject();
  const rows = await characterRows(root, (await loadProject(root)).project);
  assert.deepEqual(
    rows.map((r) => [r.character.id, r.uses.length, r.sheets]),
    [
      ["mira", 1, [{ path: "characters/mira/sheet.png", present: true }]],
      ["sol", 0, []],
    ],
  );
  assert.deepEqual(cutsNaming((await loadProject(root)).project, "mira"), [
    { episodeId: "ep-001", cutId: "cut-001" },
  ]);
});

test("a save writes only webtoon.json and keeps every other file byte-identical", async () => {
  const root = await newProject();
  const before = await snapshot(root);
  const result = await saveCharacters(root, [
    {
      id: "mira",
      name: "Mira",
      lockstring: "teal coat, cropped hair",
      references: ["characters/mira/sheet.png"],
    },
    { id: "sol", name: "Sol", lockstring: "grey scarf" },
    { id: "nell", name: "Nell", lockstring: "red cap" },
  ]);
  assert.deepEqual(result, { ok: true, changed: true });
  const after = await snapshot(root);
  for (const [file, digest] of before) {
    if (file === "webtoon.json") assert.notEqual(after.get(file), digest);
    else assert.equal(after.get(file), digest, file);
  }
  const registry = (await loadProject(root)).project.webtoon.characters ?? [];
  assert.deepEqual(
    registry.map((c) => [c.id, c.lockstring]),
    [
      ["mira", "teal coat, cropped hair"],
      ["sol", "grey scarf"],
      ["nell", "red cap"],
    ],
  );
  assert.equal((await loadProject(root)).validation.valid, true);
});

test("a save that changes nothing writes nothing, trimmed or not", async () => {
  const root = await newProject();
  const before = await snapshot(root);
  const result = await saveCharacters(root, [
    {
      id: " mira ",
      name: "Mira ",
      lockstring: " teal coat",
      references: ["characters/mira/sheet.png", ""],
    },
    { id: "sol", name: "Sol", lockstring: "grey scarf" },
  ]);
  assert.deepEqual(result, { ok: true, changed: false });
  assert.deepEqual(await snapshot(root), before);
});

test("an invalid registry is refused with nothing written", async () => {
  const root = await newProject();
  const before = await snapshot(root);
  const duplicate = await saveCharacters(root, [
    { id: "mira", name: "Mira", lockstring: "a" },
    { id: "mira", name: "Mira again", lockstring: "b" },
  ]);
  assert.equal(duplicate.ok, false);
  const badSheet = await saveCharacters(root, [
    { id: "mira", name: "Mira", lockstring: "a", references: ["characters/sol/sheet.png"] },
  ]);
  assert.equal(badSheet.ok, false);
  const badId = await saveCharacters(root, [{ id: "../mira", name: "Mira", lockstring: "a" }]);
  assert.equal(badId.ok, false);
  const blank = await saveCharacters(root, [{ id: "mira", name: "", lockstring: "a" }]);
  assert.equal(blank.ok, false);
  assert.deepEqual(await snapshot(root), before);
});

test("a new id comes from the name and stays unique", () => {
  assert.equal(newCharacterId("Mira", []), "mira");
  assert.equal(newCharacterId("Mira", ["mira"]), "mira-2");
  assert.equal(newCharacterId("Mira", ["mira", "mira-2"]), "mira-3");
  assert.equal(newCharacterId("The Caller!", []), "the-caller");
});

test("the payload guard admits a registry and nothing else", () => {
  assert.equal(isCharactersPayload({ workId: "w", characters: [] }), true);
  assert.equal(
    isCharactersPayload({
      workId: "w",
      characters: [{ id: "a", name: "A", lockstring: "x", references: ["characters/a/s.png"] }],
    }),
    true,
  );
  assert.equal(isCharactersPayload({ workId: "w", characters: [{ id: "a", name: "A" }] }), false);
  assert.equal(
    isCharactersPayload({
      workId: "w",
      characters: [{ id: "a", name: "A", lockstring: "x", references: "s.png" }],
    }),
    false,
  );
  assert.equal(isCharactersPayload({ characters: [] }), false);
});
