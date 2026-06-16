// `toony import-image` ingests a real image, associates it with a record, and
// the project still validates. Also covers usage errors and metadata stripping.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { runImportImage } from "../commands/import-image.js";
import { runInit } from "../commands/init.js";
import { runValidate } from "../commands/validate.js";
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

function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function pngChunk(type: string, data: number[]): number[] {
  return [...u32be(data.length), ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
}

function pngWithText(): Uint8Array {
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...pngChunk("IHDR", [...u32be(1), ...u32be(1), 8, 2, 0, 0, 0]),
    ...pngChunk("tEXt", [...[..."owner serial 42"].map((c) => c.charCodeAt(0))]),
    ...pngChunk("IDAT", [0x08, 0x1d, 0x01]),
    ...pngChunk("IEND", []),
  ]);
}

async function scaffold(): Promise<string> {
  assert.equal(await runInit(["demo"], capture().io), EXIT_OK);
  return join(workdir, "demo");
}

async function sourceImage(): Promise<string> {
  const path = join(workdir, "source-art.png");
  await writeFile(path, pngWithText());
  return path;
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), "toony-cli-"));
});

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

test("import-image ingests a cut asset; project still validates; metadata stripped", async () => {
  const projectDir = await scaffold();
  const src = await sourceImage();

  const c = capture();
  const code = await runImportImage(
    [projectDir, "--episode", "ep-001", "--cut", "cut-001", "--slot", "clean", "--from", src],
    c.io,
  );
  assert.equal(code, EXIT_OK, c.err.join("\n"));
  assert.match(c.out.join("\n"), /imported episodes\/ep-001\/assets\/clean\/cut-001\.png/);

  const validate = capture();
  assert.equal(await runValidate([projectDir], validate.io), EXIT_OK);

  const written = await readFile(
    join(projectDir, "episodes", "ep-001", "assets", "clean", "cut-001.png"),
  );
  assert.ok(!Buffer.from(written).toString("latin1").includes("tEXt"));
});

test("import-image ingests a transition asset", async () => {
  const projectDir = await scaffold();
  const src = await sourceImage();
  const c = capture();
  const code = await runImportImage(
    [projectDir, "--episode", "ep-001", "--transition", "tr-001", "--from", src],
    c.io,
  );
  assert.equal(code, EXIT_OK, c.err.join("\n"));
  assert.match(c.out.join("\n"), /transition tr-001/);
});

test("missing --episode is a usage error", async () => {
  const projectDir = await scaffold();
  const src = await sourceImage();
  const c = capture();
  assert.equal(
    await runImportImage([projectDir, "--cut", "cut-001", "--from", src], c.io),
    EXIT_USAGE,
  );
  assert.match(c.err.join("\n"), /--episode/);
});

test("specifying both --cut and --transition is a usage error", async () => {
  const projectDir = await scaffold();
  const src = await sourceImage();
  const c = capture();
  const code = await runImportImage(
    [
      projectDir,
      "--episode",
      "ep-001",
      "--cut",
      "cut-001",
      "--transition",
      "tr-001",
      "--from",
      src,
    ],
    c.io,
  );
  assert.equal(code, EXIT_USAGE);
  assert.match(c.err.join("\n"), /exactly one of/);
});

test("an unknown provider is a usage error", async () => {
  const projectDir = await scaffold();
  const src = await sourceImage();
  const c = capture();
  const code = await runImportImage(
    [projectDir, "--episode", "ep-001", "--cut", "cut-001", "--from", src, "--provider", "ghost"],
    c.io,
  );
  assert.equal(code, EXIT_USAGE);
  assert.match(c.err.join("\n"), /unknown provider/);
});

test("manual import without --from is a usage error", async () => {
  const projectDir = await scaffold();
  const c = capture();
  const code = await runImportImage([projectDir, "--episode", "ep-001", "--cut", "cut-001"], c.io);
  assert.equal(code, EXIT_USAGE);
  assert.match(c.err.join("\n"), /--from/);
});

test("a non-image source is reported as an import failure", async () => {
  const projectDir = await scaffold();
  const bad = join(workdir, "notes.txt");
  await writeFile(bad, "definitely not an image");
  const c = capture();
  const code = await runImportImage(
    [projectDir, "--episode", "ep-001", "--cut", "cut-001", "--from", bad],
    c.io,
  );
  assert.equal(code, EXIT_USAGE);
  assert.match(c.err.join("\n"), /import failed/);
});
