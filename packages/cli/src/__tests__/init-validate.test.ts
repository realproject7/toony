// Round-trip tests: `toony init` output passes `toony validate`, and corrupting
// a field makes `validate` fail with actionable, agent-readable output.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { cutsFile, GENRES, slugify, transitionsFile } from "@toony/project-io";
import { runInit } from "../commands/init.js";
import { runLint } from "../commands/lint.js";
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

test("validate fails (exit 1) on a corrupted YAML content field", async () => {
  assert.equal(await runInit(["demo"], capture().io), EXIT_OK);
  const projectDir = join(workdir, "demo");

  // Valid YAML, invalid value: gutterHeight must be a non-negative integer.
  await writeFile(
    transitionsFile(projectDir, "ep-001"),
    "- id: tr-001\n  type: gutter\n  gutterHeight: -5\n  text: null\n  sfx: null\n" +
      "  agentNote: null\n  humanNote: null\n  image: null\n  reviewStatus: draft\n",
  );

  const c = capture();
  const code = await runValidate([projectDir], c.io);
  assert.equal(code, EXIT_VALIDATION);
  assert.match(c.out.join("\n"), /gutterHeight/);
});

test("validate reports an IO error (exit 2) for malformed YAML", async () => {
  assert.equal(await runInit(["demo"], capture().io), EXIT_OK);
  const projectDir = join(workdir, "demo");
  await writeFile(cutsFile(projectDir, "ep-001"), "- id: cut-001\n  image: [unterminated\n");

  const c = capture();
  const code = await runValidate([projectDir], c.io);
  assert.equal(code, EXIT_USAGE);
  assert.match(c.err.join("\n"), /load error/);
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

// --- Genre init templates (#101) -------------------------------------------

test("init --genre seeds a project that passes both validate AND lint, for every genre", async () => {
  for (const genre of GENRES) {
    const name = `demo-${genre}`;
    const init = capture();
    assert.equal(await runInit([name, "--genre", genre], init.io), EXIT_OK, init.err.join("\n"));
    // The success line names the genre template.
    assert.match(init.out.join("\n"), new RegExp(`${genre} template`));

    const projectDir = join(workdir, slugify(name));
    const validate = capture();
    assert.equal(
      await runValidate([projectDir], validate.io),
      EXIT_OK,
      `${genre} validate: ${validate.out.concat(validate.err).join("\n")}`,
    );
    // Lint must be clean (no warnings/errors) — the scaffold is craft-correct.
    const lint = capture();
    const lintCode = await runLint([projectDir, "--json"], lint.io);
    assert.equal(lintCode, EXIT_OK, `${genre} lint not clean: ${lint.out.join("\n")}`);
    const report = JSON.parse(lint.out.join("\n"));
    assert.equal(report.clean, true, `${genre}: ${JSON.stringify(report.findings)}`);
  }
});

test("init --genre with an unknown genre is a usage error", async () => {
  const c = capture();
  assert.equal(await runInit(["demo", "--genre", "horror"], c.io), EXIT_USAGE);
  assert.match(c.err.join("\n"), /unknown genre/);
});

test("init --genre with no value is a usage error", async () => {
  const c = capture();
  assert.equal(await runInit(["demo", "--genre"], c.io), EXIT_USAGE);
  assert.match(c.err.join("\n"), /missing value for --genre/);
});

test("init rejects an unknown option", async () => {
  const c = capture();
  assert.equal(await runInit(["demo", "--bogus"], c.io), EXIT_USAGE);
  assert.match(c.err.join("\n"), /unknown option/);
});
