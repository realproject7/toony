// Tests for the crash-safe atomic-write helpers (#144).
//
// A failed write is simulated by making the `<file>.tmp` staging path a
// directory: `writeFile` onto a directory fails with EISDIR before any rename,
// which is exactly the "helper throws before rename" case the acceptance
// criteria call for. The invariant under test is that the original target file
// is never truncated or replaced when a write fails.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { atomicWrite, atomicWriteAll } from "../atomic.js";

let workdir: string;

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), "toony-atomic-"));
});

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

test("atomicWrite replaces the target and leaves no temp behind", async () => {
  const file = join(workdir, "note.txt");
  await writeFile(file, "original", "utf8");
  await atomicWrite(file, "updated");
  assert.equal(await readFile(file, "utf8"), "updated");
  assert.deepEqual(await readdir(workdir), ["note.txt"]);
});

test("atomicWrite creates a new file when the target does not exist", async () => {
  const file = join(workdir, "fresh.txt");
  await atomicWrite(file, "hello");
  assert.equal(await readFile(file, "utf8"), "hello");
});

test("a failed write leaves the original file intact (no truncation)", async () => {
  const file = join(workdir, "cuts.yaml");
  await writeFile(file, "original: content\n", "utf8");
  // Make the staging path a directory so writeFile(<file>.tmp, …) fails with
  // EISDIR before the rename step could ever run.
  await mkdir(`${file}.tmp`);

  await assert.rejects(atomicWrite(file, "replacement: data\n"));

  // The original bytes must still be exactly what we wrote.
  assert.equal(await readFile(file, "utf8"), "original: content\n");
});

test("atomicWriteAll commits every file on success", async () => {
  const a = join(workdir, "transitions.yaml");
  const b = join(workdir, "episode.yaml");
  await atomicWriteAll([
    { file: a, data: "a: 1\n" },
    { file: b, data: "b: 2\n" },
  ]);
  assert.equal(await readFile(a, "utf8"), "a: 1\n");
  assert.equal(await readFile(b, "utf8"), "b: 2\n");
  // No stray temp files from a successful batch.
  assert.deepEqual((await readdir(workdir)).sort(), ["episode.yaml", "transitions.yaml"]);
});

test("a staging failure in a batch leaves ALL originals intact and renames nothing", async () => {
  const a = join(workdir, "transitions.yaml");
  const b = join(workdir, "episode.yaml");
  await writeFile(a, "transitions: old\n", "utf8");
  await writeFile(b, "episode: old\n", "utf8");
  // Second file's staging path is a directory → its writeFile fails, after the
  // first temp was already written. Nothing should have been renamed.
  await mkdir(`${b}.tmp`);

  await assert.rejects(
    atomicWriteAll([
      { file: a, data: "transitions: new\n" },
      { file: b, data: "episode: new\n" },
    ]),
  );

  assert.equal(await readFile(a, "utf8"), "transitions: old\n");
  assert.equal(await readFile(b, "utf8"), "episode: old\n");
  // The first file's staged temp was cleaned up; only the originals and the
  // test's own `.tmp` directory remain (no leftover `transitions.yaml.tmp`).
  assert.equal((await readdir(workdir)).includes("transitions.yaml.tmp"), false);
});
