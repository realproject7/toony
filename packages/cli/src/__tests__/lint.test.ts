// `toony lint` / `toony lint-episode` run the headless lints against a project.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { runExport } from "../commands/export.js";
import { runInit } from "../commands/init.js";
import { runLint, runLintEpisode } from "../commands/lint.js";
import { EXIT_OK, EXIT_USAGE, EXIT_VALIDATION } from "../exit.js";

let workdir: string;

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { cwd: workdir, out: (l: string) => out.push(l), err: (l: string) => err.push(l) },
    out,
    err,
  };
}

async function scaffold(): Promise<string> {
  assert.equal(await runInit(["demo"], capture().io), EXIT_OK);
  return join(workdir, "demo");
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), "toony-cli-"));
});

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

test("lint on a fresh project is clean", async () => {
  const dir = await scaffold();
  const c = capture();
  const code = await runLint([dir], c.io);
  assert.equal(code, EXIT_OK, c.err.join("\n"));
  assert.match(c.out.join("\n"), /clean:/);
});

test("lint --json reports a clean project", async () => {
  const dir = await scaffold();
  const c = capture();
  assert.equal(await runLint([dir, "--json"], c.io), EXIT_OK);
  const report = JSON.parse(c.out.join("\n"));
  assert.equal(report.clean, true);
  assert.equal(report.findingCount, 0);
  assert.equal(report.episodeId, null);
});

test("lint flags an export manifest whose declared file is missing", async () => {
  const dir = await scaffold();
  assert.equal(await runExport(["platform", dir, "--episode", "ep-001"], capture().io), EXIT_OK);

  const manifestPath = join(dir, "episodes/ep-001/exports/platform/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await unlink(join(dir, manifest.files[0].path));

  const c = capture();
  const code = await runLint([dir], c.io);
  assert.equal(code, EXIT_VALIDATION);
  assert.match(c.out.join("\n"), /manifest\/missing-file/);
});

test("lint flags an unparseable manifest", async () => {
  const dir = await scaffold();
  assert.equal(await runExport(["platform", dir, "--episode", "ep-001"], capture().io), EXIT_OK);
  await writeFile(join(dir, "episodes/ep-001/exports/platform/manifest.json"), "{ not json");

  const c = capture();
  assert.equal(await runLint([dir], c.io), EXIT_VALIDATION);
  assert.match(c.out.join("\n"), /manifest\/invalid/);
});

test("lint-episode scopes to one episode", async () => {
  const dir = await scaffold();
  const c = capture();
  assert.equal(await runLintEpisode(["ep-001", dir], c.io), EXIT_OK, c.err.join("\n"));
  assert.match(c.out.join("\n"), /episode ep-001/);
});

test("lint-episode without an id is a usage error", async () => {
  const c = capture();
  assert.equal(await runLintEpisode([], c.io), EXIT_USAGE);
  assert.match(c.err.join("\n"), /episode-id/);
});

test("lint-episode with an unknown id is a usage error", async () => {
  const dir = await scaffold();
  const c = capture();
  assert.equal(await runLintEpisode(["ep-999", dir], c.io), EXIT_USAGE);
  assert.match(c.err.join("\n"), /episode not found/);
});

test("an unknown option is a usage error", async () => {
  const dir = await scaffold();
  const c = capture();
  assert.equal(await runLint([dir, "--bogus"], c.io), EXIT_USAGE);
  assert.match(c.err.join("\n"), /unknown option/);
});
