// `toony export` resolves an output, checks its flags and reports the result.

import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
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

async function manifestOf(dir: string, output: string) {
  return JSON.parse(
    await readFile(join(dir, "episodes/ep-001/exports", output, "manifest.json"), "utf8"),
  );
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), "toony-cli-"));
});

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

test("export <episode> --output cuts writes ordered files and reports them", async () => {
  const dir = await scaffold();
  const c = capture();
  const code = await runExport(["ep-001", dir, "--output", "cuts", "--width", "400"], c.io);
  assert.equal(code, EXIT_OK, c.err.join("\n"));
  assert.match(
    c.out.join("\n"),
    /exported cuts: \d+ file\(s\) for ep-001 → episodes\/ep-001\/exports\/cuts/,
  );
  // The scaffold's cuts have no art yet: a note, not a failure.
  assert.match(c.out.join("\n"), /^note: .*no artwork yet/m);
  assert.equal((await manifestOf(dir, "cuts")).width, 400);
});

test("the strip is the default output, and the earlier spellings still work", async () => {
  const dir = await scaffold();
  const plain = capture();
  assert.equal(await runExport(["ep-001", dir], plain.io), EXIT_OK, plain.err.join("\n"));
  assert.match(plain.out.join("\n"), /exported strip: 1 file/);
  const legacy = capture();
  assert.equal(await runExport(["stitched", dir, "--episode", "ep-001"], legacy.io), EXIT_OK);
  assert.match(legacy.out.join("\n"), /exported strip/);
  const target = capture();
  assert.equal(
    await runExport(["ep-001", dir, "--target", "platform", "--margin", "10"], target.io),
    EXIT_OK,
    target.err.join("\n"),
  );
  assert.match(target.out.join("\n"), /exported cuts/);
  assert.equal((await manifestOf(dir, "cuts")).options.margin, 10);
});

test("social outputs write fixed frames grouped into posts", async () => {
  const dir = await scaffold();
  const c = capture();
  assert.equal(await runExport(["ep-001", dir, "--output", "x"], c.io), EXIT_OK, c.err.join("\n"));
  const manifest = await manifestOf(dir, "x");
  assert.equal(manifest.kind, "social");
  manifest.files.forEach((file: { width: number; height: number; post: number }, i: number) => {
    assert.equal(file.width, 1600);
    assert.equal(file.height, 900);
    assert.equal(file.post, Math.floor(i / 4) + 1);
  });
  const square = capture();
  assert.equal(
    await runExport(
      ["ep-001", dir, "--output", "instagram-square", "--tall-cuts", "fit"],
      square.io,
    ),
    EXIT_OK,
    square.err.join("\n"),
  );
  assert.equal((await manifestOf(dir, "instagram-square")).options.tallCuts, "fit");
});

test("the webtoon output writes 800 px JPEG parts", async () => {
  const dir = await scaffold();
  const c = capture();
  assert.equal(
    await runExport(["ep-001", dir, "--output", "webtoon"], c.io),
    EXIT_OK,
    c.err.join("\n"),
  );
  const names = (await readdir(join(dir, "episodes/ep-001/exports/webtoon"))).sort();
  assert.ok(names.includes("001.jpg") && names.includes("manifest.json"));
  const manifest = await manifestOf(dir, "webtoon");
  assert.equal(manifest.width, 800);
  assert.ok(
    manifest.files.every(
      (f: { height: number; quality: number }) => f.height <= 1280 && f.quality === 90,
    ),
  );
});

test("an unknown output is a usage error that lists the outputs", async () => {
  const dir = await scaffold();
  const c = capture();
  assert.equal(await runExport(["ep-001", dir, "--output", "gif"], c.io), EXIT_USAGE);
  assert.match(c.err.join("\n"), /strip, cuts, instagram, instagram-square, x, webtoon/);
  const retired = capture();
  assert.equal(await runExport(["plotlink", dir, "--episode", "ep-001"], retired.io), EXIT_USAGE);
});

test("a missing episode is a usage error", async () => {
  const c = capture();
  assert.equal(await runExport(["--output", "strip"], c.io), EXIT_USAGE);
  assert.match(c.err.join("\n"), /missing episode/);
});

test("a flag that does not apply to the output is a usage error", async () => {
  const dir = await scaffold();
  for (const [args, message] of [
    [["--output", "strip", "--margin", "10"], /--margin does not apply to strip/],
    [["--output", "instagram", "--width", "800"], /--width does not apply to instagram/],
    [["--output", "cuts", "--slice-height", "1280"], /--slice-height does not apply to cuts/],
    [["--output", "strip", "--quality", "80"], /--quality applies to JPEG only/],
  ] as const) {
    const c = capture();
    assert.equal(await runExport(["ep-001", dir, ...args], c.io), EXIT_USAGE, args.join(" "));
    assert.match(c.err.join("\n"), message);
  }
});

test("out-of-range numbers are usage errors with the shared wording", async () => {
  const dir = await scaffold();
  for (const [flag, value] of [
    ["--width", "0"],
    ["--slice-height", "10"],
    ["--quality", "999"],
  ] as const) {
    const c = capture();
    const code = await runExport(
      ["ep-001", dir, "--output", "strip", "--format", "jpg", flag, value],
      c.io,
    );
    assert.equal(code, EXIT_USAGE, `${flag} ${value} should be rejected`);
    assert.match(c.err.join("\n"), new RegExp(`${flag} must be an integer between`));
  }
});
