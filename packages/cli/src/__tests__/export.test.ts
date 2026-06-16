// `toony export` dispatches to the headless export targets and reports results.

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { runExport } from "../commands/export.js";
import { runInit } from "../commands/init.js";
import { EXIT_OK, EXIT_USAGE } from "../exit.js";

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

test("export platform writes ordered files and reports them", async () => {
  const dir = await scaffold();
  const c = capture();
  const code = await runExport(["platform", dir, "--episode", "ep-001", "--width", "400"], c.io);
  assert.equal(code, EXIT_OK, c.err.join("\n"));
  assert.match(c.out.join("\n"), /exported platform: \d+ file/);
});

test("export stitched succeeds", async () => {
  const dir = await scaffold();
  const c = capture();
  const code = await runExport(["stitched", dir, "--episode", "ep-001"], c.io);
  assert.equal(code, EXIT_OK, c.err.join("\n"));
  assert.match(c.out.join("\n"), /exported stitched/);
});

test("an unknown target is a usage error", async () => {
  const dir = await scaffold();
  const c = capture();
  const code = await runExport(["gif", dir, "--episode", "ep-001"], c.io);
  assert.equal(code, EXIT_USAGE);
  assert.match(c.err.join("\n"), /platform, stitched, plotlink/);
});

test("missing --episode is a usage error", async () => {
  const dir = await scaffold();
  const c = capture();
  assert.equal(await runExport(["platform", dir], c.io), EXIT_USAGE);
  assert.match(c.err.join("\n"), /--episode/);
});

test("a non-positive --width is a usage error", async () => {
  const dir = await scaffold();
  const c = capture();
  const code = await runExport(["platform", dir, "--episode", "ep-001", "--width", "0"], c.io);
  assert.equal(code, EXIT_USAGE);
  assert.match(c.err.join("\n"), /--width/);
});

test("plotlink on a sparse project reports an export failure", async () => {
  const dir = await scaffold(); // scaffold has no lettering → markdown below minimum
  const c = capture();
  const code = await runExport(["plotlink", dir, "--episode", "ep-001"], c.io);
  assert.equal(code, EXIT_USAGE);
  assert.match(c.err.join("\n"), /export failed/);
});
