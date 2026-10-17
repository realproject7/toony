// Path-safety regression tests for the IO layer (#74, #75).

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { episodeDir } from "../paths.js";
import { buildInitialProject } from "../scaffold.js";
import { writeCuts, writeProject } from "../writer.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "toony-path-safety-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("episodeDir refuses an unsafe episode id (#74)", () => {
  for (const bad of ["../../outside", "..", "a/b", "/abs"]) {
    assert.throws(() => episodeDir(dir, bad), /unsafe episode id/);
  }
});

test("episodeDir accepts a normal episode id", () => {
  assert.equal(episodeDir(dir, "ep-001"), join(dir, "episodes", "ep-001"));
});

test("writeCuts refuses to write through an unsafe episode id (#74)", async () => {
  const root = join(dir, "work");
  await writeProject(root, buildInitialProject("Demo"));
  await assert.rejects(
    () => writeCuts(root, "../../escape", []),
    /unsafe episode id/,
    "an episode id that traverses out of the episodes tree must be rejected before any write",
  );
});

test("a project can be scaffolded after creating a missing workspace root (#75)", async () => {
  // First-run shape: the workspace root does not exist yet. writeProject creates
  // only the work folder non-recursively, so the caller must ensure the root
  // exists first (the Studio /api/work route now does this).
  const workspaceRoot = join(dir, "Documents", "Toony");
  const target = join(workspaceRoot, "my-first-work");

  await assert.rejects(
    () => writeProject(target, buildInitialProject("First")),
    /ENOENT/,
    "writing into a missing workspace root must fail without the root being created first",
  );

  await mkdir(workspaceRoot, { recursive: true });
  await writeProject(target, buildInitialProject("First"));
  const info = await stat(join(target, "webtoon.json"));
  assert.equal(info.isFile(), true);
});
