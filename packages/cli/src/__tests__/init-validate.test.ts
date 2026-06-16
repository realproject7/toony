// Round-trip tests: `toony init` output passes `toony validate`, and corrupting
// a field makes `validate` fail with actionable, agent-readable output.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { runInit } from "../commands/init.js";
import { runValidate } from "../commands/validate.js";
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

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), "toony-cli-"));
});

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

test("init scaffolds a project that validate accepts", async () => {
  const init = capture();
  const initCode = await runInit(["My Demo Webtoon"], init.io);
  assert.equal(initCode, EXIT_OK, init.err.join("\n"));

  const projectDir = join(workdir, "my-demo-webtoon");
  const validate = capture();
  const code = await runValidate([projectDir], validate.io);
  assert.equal(code, EXIT_OK, validate.out.concat(validate.err).join("\n"));
  assert.match(validate.out.join("\n"), /^valid:/);
});

test("init refuses to overwrite an existing directory", async () => {
  const first = capture();
  assert.equal(await runInit(["demo"], first.io), EXIT_OK);
  const second = capture();
  assert.equal(await runInit(["demo"], second.io), EXIT_USAGE);
  assert.match(second.err.join("\n"), /already exists/);
});

test("init without a name is a usage error", async () => {
  const c = capture();
  assert.equal(await runInit([], c.io), EXIT_USAGE);
  assert.match(c.err.join("\n"), /usage: toony init/);
});

test("validate fails (exit 1) on a corrupted field with actionable output", async () => {
  assert.equal(await runInit(["demo"], capture().io), EXIT_OK);
  const projectDir = join(workdir, "demo");

  // Corrupt the language config so a documented validator fires.
  const webtoonFile = join(projectDir, "webtoon.json");
  const webtoon = JSON.parse(await readFile(webtoonFile, "utf8"));
  webtoon.languages.defaultLanguage = "fr"; // not in supportedLanguages
  await writeFile(webtoonFile, JSON.stringify(webtoon, null, 2));

  const c = capture();
  const code = await runValidate([projectDir], c.io);
  assert.equal(code, EXIT_VALIDATION);
  const text = c.out.join("\n");
  assert.match(text, /^invalid:/);
  assert.match(text, /defaultLanguage/);
});

test("validate --json emits a structured report", async () => {
  assert.equal(await runInit(["demo"], capture().io), EXIT_OK);
  const projectDir = join(workdir, "demo");

  const c = capture();
  const code = await runValidate([projectDir, "--json"], c.io);
  assert.equal(code, EXIT_OK);
  const report = JSON.parse(c.out.join("\n"));
  assert.equal(report.valid, true);
  assert.equal(report.issueCount, 0);
  assert.ok(Array.isArray(report.issues));
});

test("validate reports an IO error (exit 2) for a missing project", async () => {
  const c = capture();
  const code = await runValidate([join(workdir, "does-not-exist")], c.io);
  assert.equal(code, EXIT_USAGE);
  assert.match(c.err.join("\n"), /load error/);
});
