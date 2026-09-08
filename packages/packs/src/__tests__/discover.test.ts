// Discovery reads local pack directories, merges what they contribute, and never
// throws — a malformed pack is reported and skipped so the core keeps working.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { loadPacks, PACKS_ENV_VAR, PROJECT_PACKS_DIR, packRoots } from "../index.js";

let workdir: string;

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), "toony-packs-"));
});
afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

const SCAFFOLD = {
  episode: {
    schemaVersion: 1,
    id: "ep-001",
    title: "Episode 1",
    sequence: [{ type: "cut", id: "cut-001" }],
  },
  cuts: [{ id: "cut-001", image: null, imagePrompt: "a street", negativePrompt: "" }],
  transitions: [],
  lettering: [],
};

const GRAPH = { "3": { class_type: "KSampler", inputs: { seed: 0 } } };

/** Write a complete pack contributing all three kinds. Returns its directory. */
async function writePack(
  root: string,
  id: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const dir = join(root, id);
  await mkdir(join(dir, "workflows"), { recursive: true });
  await mkdir(join(dir, "genres"), { recursive: true });
  const manifest = {
    packFormat: 1,
    id,
    name: id,
    workflows: [{ name: `${id}-flow`, file: "workflows/flow.json" }],
    genres: [{ id: `${id}-genre`, title: id, file: "genres/scaffold.json" }],
    exportPresets: [{ id: `${id}-preset`, target: "platform", options: { width: 1600 } }],
    ...overrides,
  };
  await writeFile(join(dir, "toony-pack.json"), JSON.stringify(manifest, null, 2));
  await writeFile(join(dir, "workflows", "flow.json"), JSON.stringify(GRAPH));
  await writeFile(join(dir, "genres", "scaffold.json"), JSON.stringify(SCAFFOLD));
  return dir;
}

test("with no packs installed, discovery returns empty content and no issues", async () => {
  const loaded = await loadPacks(workdir);
  assert.deepEqual(loaded.packs, []);
  assert.deepEqual(loaded.issues, []);
  assert.equal(loaded.content.workflows.size, 0);
  assert.deepEqual(loaded.content.genres, []);
  assert.deepEqual(loaded.content.exportPresets, []);
});

test("an unreadable pack root is the zero-pack case, not a failure", async () => {
  const loaded = await loadPacks(join(workdir, "does-not-exist"));
  assert.deepEqual(loaded.issues, []);
  assert.deepEqual(loaded.packs, []);
});

test("a pack in <root>/.toony/packs contributes all three kinds", async () => {
  const packsDir = join(workdir, PROJECT_PACKS_DIR);
  await mkdir(packsDir, { recursive: true });
  const dir = await writePack(packsDir, "alpha");

  const loaded = await loadPacks(workdir);
  assert.deepEqual(loaded.issues, []);
  assert.deepEqual(loaded.packs, [{ id: "alpha", name: "alpha", dir }]);
  assert.equal(loaded.content.workflows.get("alpha-flow"), join(dir, "workflows", "flow.json"));
  assert.equal(loaded.content.genres[0]?.id, "alpha-genre");
  assert.equal(loaded.content.genres[0]?.bundle.episode.id, "ep-001");
  assert.deepEqual(loaded.content.exportPresets[0], {
    id: "alpha-preset",
    target: "platform",
    options: { width: 1600 },
  });
});

test("TOONY_PACKS names extra pack roots and they are searched first", async () => {
  const envRoot = join(workdir, "global-packs");
  await mkdir(envRoot, { recursive: true });
  await writePack(envRoot, "fromenv");

  const loaded = await loadPacks(workdir, { [PACKS_ENV_VAR]: envRoot });
  assert.deepEqual(loaded.issues, []);
  assert.deepEqual(
    loaded.packs.map((p) => p.id),
    ["fromenv"],
  );
  assert.equal(packRoots(workdir, { [PACKS_ENV_VAR]: envRoot })[0], envRoot);
});

test("a pack installed for the workspace is visible from inside a project", async () => {
  // `<workspace>/.toony/packs` with the command running against
  // `<workspace>/my-story` — the same parent lookup `toony generate` does for
  // the shared ComfyUI config.
  const packsDir = join(workdir, PROJECT_PACKS_DIR);
  await mkdir(packsDir, { recursive: true });
  await writePack(packsDir, "shared");
  const project = join(workdir, "my-story");
  await mkdir(project, { recursive: true });

  const loaded = await loadPacks(project);
  assert.deepEqual(
    loaded.packs.map((p) => p.id),
    ["shared"],
  );
});

test("a malformed pack is reported and skipped; the good packs still load", async () => {
  const packsDir = join(workdir, PROJECT_PACKS_DIR);
  await mkdir(packsDir, { recursive: true });
  await writePack(packsDir, "good");
  // A pack whose manifest declares code.
  await writePack(packsDir, "bad", { main: "./evil.js" });
  // A pack with no manifest at all.
  await mkdir(join(packsDir, "empty"), { recursive: true });
  // A pack whose manifest is not JSON.
  await mkdir(join(packsDir, "broken"), { recursive: true });
  await writeFile(join(packsDir, "broken", "toony-pack.json"), "{ not json");

  const loaded = await loadPacks(workdir);
  assert.deepEqual(
    loaded.packs.map((p) => p.id),
    ["good"],
  );
  const codes = loaded.issues.map((i) => i.code);
  assert.ok(codes.includes("pack.unexpected-field"));
  assert.ok(codes.includes("pack.manifest-missing"));
  assert.ok(codes.includes("pack.manifest-parse"));
  // Every issue names the pack directory it came from, so it is actionable.
  for (const issue of loaded.issues) assert.match(issue.pack, /packs\//);
  // The good pack's content is intact despite the broken neighbours.
  assert.equal(loaded.content.workflows.size, 1);
  assert.equal(loaded.content.genres.length, 1);
});

test("a manifest naming a file that is not there is reported, not thrown", async () => {
  const packsDir = join(workdir, PROJECT_PACKS_DIR);
  await mkdir(packsDir, { recursive: true });
  await writePack(packsDir, "gap", {
    workflows: [{ name: "missing-flow", file: "workflows/absent.json" }],
    genres: [{ id: "missing-genre", title: "Gone", file: "genres/absent.json" }],
  });

  const loaded = await loadPacks(workdir);
  const codes = loaded.issues.map((i) => i.code);
  assert.ok(codes.includes("pack.workflow.file-missing"));
  assert.ok(codes.includes("pack.genre.file-missing"));
  // The pack still counts as installed; only the broken contributions are gone.
  assert.equal(loaded.packs.length, 1);
  assert.equal(loaded.content.workflows.size, 0);
  assert.equal(loaded.content.genres.length, 0);
  assert.equal(loaded.content.exportPresets.length, 1);
});

test("a genre scaffold that would not validate as a project is rejected", async () => {
  const packsDir = join(workdir, PROJECT_PACKS_DIR);
  await mkdir(packsDir, { recursive: true });
  const dir = await writePack(packsDir, "invalid");
  await writeFile(
    join(dir, "genres", "scaffold.json"),
    JSON.stringify({ ...SCAFFOLD, cuts: [] }), // sequence now references a missing cut
  );

  const loaded = await loadPacks(workdir);
  assert.ok(loaded.issues.some((i) => i.code === "sequence.missing-cut"));
  assert.equal(loaded.content.genres.length, 0);
});

test("the first pack to claim a name keeps it and the loser is told why", async () => {
  const envRoot = join(workdir, "global-packs");
  await mkdir(envRoot, { recursive: true });
  const winner = await writePack(envRoot, "first");
  const packsDir = join(workdir, PROJECT_PACKS_DIR);
  await mkdir(packsDir, { recursive: true });
  // A second pack claiming the same workflow name, genre id, and preset id.
  await writePack(packsDir, "second", {
    workflows: [{ name: "first-flow", file: "workflows/flow.json" }],
    genres: [{ id: "first-genre", title: "Second", file: "genres/scaffold.json" }],
    exportPresets: [{ id: "first-preset", target: "stitched", options: {} }],
  });

  const loaded = await loadPacks(workdir, { [PACKS_ENV_VAR]: envRoot });
  assert.equal(loaded.content.workflows.get("first-flow"), join(winner, "workflows", "flow.json"));
  assert.equal(loaded.content.genres.length, 1);
  assert.equal(loaded.content.genres[0]?.title, "first");
  assert.equal(loaded.content.exportPresets[0]?.target, "platform");
  const codes = loaded.issues.map((i) => i.code);
  assert.ok(codes.includes("pack.workflow.claimed"));
  assert.ok(codes.includes("pack.genre.claimed"));
  assert.ok(codes.includes("pack.export-preset.claimed"));
});

test("two packs declaring the same pack id are reported; only the first loads", async () => {
  const envRoot = join(workdir, "global-packs");
  await mkdir(envRoot, { recursive: true });
  await writePack(envRoot, "twin");
  const packsDir = join(workdir, PROJECT_PACKS_DIR);
  await mkdir(packsDir, { recursive: true });
  await writePack(packsDir, "clone", { id: "twin" });

  const loaded = await loadPacks(workdir, { [PACKS_ENV_VAR]: envRoot });
  assert.equal(loaded.packs.length, 1);
  assert.ok(loaded.issues.some((i) => i.code === "pack.duplicate"));
});

test("discovery is deterministic across runs", async () => {
  const packsDir = join(workdir, PROJECT_PACKS_DIR);
  await mkdir(packsDir, { recursive: true });
  for (const id of ["zeta", "alpha", "mid"]) await writePack(packsDir, id);

  const first = await loadPacks(workdir);
  const second = await loadPacks(workdir);
  assert.deepEqual(
    first.packs.map((p) => p.id),
    ["alpha", "mid", "zeta"],
  );
  assert.deepEqual(first.packs, second.packs);
  assert.deepEqual(first.content.genres, second.content.genres);
});
