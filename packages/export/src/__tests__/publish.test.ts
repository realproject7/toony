// The shared publisher proves ownership of previous outputs before replacing or
// removing anything, preserves unrelated files and never follows a symlink.

import assert from "node:assert/strict";
import {
  lstat,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { ExportError } from "../errors.js";
import { type ExportManifest, sha256Hex } from "../manifest.js";
import { publishExport } from "../publish.js";

const relativeDir = "episodes/ep-001/exports/cuts";

function manifestFor(names: string[], image: Uint8Array): ExportManifest {
  return {
    manifestVersion: 2,
    kind: "cuts",
    output: "cuts",
    projectId: "ownership-fixture",
    episodeId: "ep-001",
    width: 4,
    options: {
      format: "png",
      quality: null,
      contentWidth: 4,
      sliceHeight: null,
      maxBytes: null,
      margin: 0,
      textCards: false,
      frame: null,
      tallCuts: null,
      imagesPerPost: null,
      background: "#ffffff",
    },
    files: names.map((name, i) => ({
      path: `${relativeDir}/${name}`,
      format: "png",
      width: 4,
      height: 4,
      byteSize: image.length,
      quality: null,
      sha256: sha256Hex(image),
      role: "cut",
      items: [{ type: "cut", id: `cut-00${i + 1}`, index: i }],
    })),
    warnings: [],
    inputs: { sha256: "c".repeat(64) },
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "toony-publish-"));
  const dir = join(root, "output");
  const image = new Uint8Array(createCanvas(4, 4).toBuffer("image/png"));
  const manifest = manifestFor(["001.png", "002.png"], image);
  await publishExport(
    dir,
    relativeDir,
    new Map<string, string | Uint8Array>([
      ["001.png", image],
      ["002.png", image],
      ["manifest.json", JSON.stringify(manifest)],
    ]),
  );
  // The next output replaces 001 and removes stale 002. Both must be verified.
  const replacement = new Map<string, string | Uint8Array>([
    ["001.png", image],
    ["manifest.json", JSON.stringify(manifestFor(["001.png"], image))],
  ]);
  return { root, dir, image, manifest, replacement };
}

/** Snapshot symlink identity without reading anything through the link. */
async function snapshot(dir: string) {
  return Promise.all(
    (await readdir(dir)).sort().map(async (name) => {
      const path = join(dir, name);
      const stat = await lstat(path);
      return stat.isSymbolicLink()
        ? [name, "symlink", await readlink(path)]
        : [name, "file", (await readFile(path)).toString("hex")];
    }),
  );
}

async function assertConflictPreservesOutput(f: Awaited<ReturnType<typeof fixture>>) {
  const before = await snapshot(f.dir);
  await assert.rejects(
    () => publishExport(f.dir, relativeDir, f.replacement),
    (error: unknown) => error instanceof ExportError && error.code === "export.output-conflict",
  );
  assert.deepEqual(await snapshot(f.dir), before);
  // Verification fails before staging or renaming the existing folder.
  assert.deepEqual(await readdir(f.root), ["output"]);
}

for (const field of ["sha256", "byteSize"] as const) {
  test(`a valid manifest with a wrong ${field} cannot claim an existing image`, async () => {
    const f = await fixture();
    const first = f.manifest.files[0];
    assert.ok(first);
    if (field === "sha256") first.sha256 = "0".repeat(64);
    else first.byteSize++;
    await writeFile(join(f.dir, "manifest.json"), JSON.stringify(f.manifest));
    await assertConflictPreservesOutput(f);
  });
}

for (const name of ["001.png", "002.png"]) {
  test(`edits to ${name} prevent replacement and stale-file cleanup`, async () => {
    const f = await fixture();
    const edited = await readFile(join(f.dir, name));
    // Same byte count: checking size alone must not establish ownership.
    edited[edited.length - 1] = (edited.at(-1) ?? 0) ^ 1;
    await writeFile(join(f.dir, name), edited);
    await assertConflictPreservesOutput(f);
  });
}

test("a missing claimed stale image fails without replacing the surviving output", async () => {
  const f = await fixture();
  await unlink(join(f.dir, "002.png"));
  await assertConflictPreservesOutput(f);
});

for (const name of ["001.png", "002.png", "manifest.json"]) {
  test(`a claimed ${name} symlink is rejected even when its target bytes match`, async () => {
    const f = await fixture();
    const outsideDir = await mkdtemp(join(tmpdir(), "toony-unrelated-output-"));
    const outside = join(outsideDir, "user-file");
    const bytes = await readFile(join(f.dir, name));
    await writeFile(outside, bytes);
    await unlink(join(f.dir, name));
    await symlink(outside, join(f.dir, name));
    await assertConflictPreservesOutput(f);
    assert.deepEqual(await readFile(outside), bytes);
  });
}

test("verified previous bytes allow replacement and removal of only stale owned files", async () => {
  const f = await fixture();
  await writeFile(join(f.dir, "user-note.txt"), "Preserve this note.");
  await publishExport(f.dir, relativeDir, f.replacement);
  assert.deepEqual((await readdir(f.dir)).sort(), ["001.png", "manifest.json", "user-note.txt"]);
  assert.deepEqual(new Uint8Array(await readFile(join(f.dir, "001.png"))), f.image);
  assert.equal(await readFile(join(f.dir, "user-note.txt"), "utf8"), "Preserve this note.");
  assert.deepEqual(await readdir(f.root), ["output"]);
});

test("an unrelated file with an output's name stops the export unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "toony-publish-collision-"));
  const dir = join(root, "output");
  const image = new Uint8Array(createCanvas(4, 4).toBuffer("image/png"));
  await publishExport(dir, relativeDir, new Map([["notes.txt", "First."]]));
  await writeFile(join(dir, "001.png"), "A user image.");
  await assert.rejects(
    () =>
      publishExport(
        dir,
        relativeDir,
        new Map<string, string | Uint8Array>([
          ["001.png", image],
          ["manifest.json", JSON.stringify(manifestFor(["001.png"], image))],
        ]),
      ),
    (error: unknown) => error instanceof ExportError && error.code === "export.output-conflict",
  );
  assert.equal(await readFile(join(dir, "001.png"), "utf8"), "A user image.");
});

test("an older manifest owns nothing, so its files are kept as unrelated files", async () => {
  const root = await mkdtemp(join(tmpdir(), "toony-publish-legacy-"));
  const dir = join(root, "output");
  const image = new Uint8Array(createCanvas(4, 4).toBuffer("image/png"));
  const legacy = { ...manifestFor(["old.png"], image), manifestVersion: 1 };
  await publishExport(dir, relativeDir, new Map<string, string | Uint8Array>([["old.png", image]]));
  await writeFile(join(dir, "manifest.json"), JSON.stringify(legacy));
  // The new manifest name collides with the unowned old one.
  await assert.rejects(
    () =>
      publishExport(
        dir,
        relativeDir,
        new Map<string, string | Uint8Array>([
          ["001.png", image],
          ["manifest.json", JSON.stringify(manifestFor(["001.png"], image))],
        ]),
      ),
    (error: unknown) => error instanceof ExportError && error.code === "export.output-conflict",
  );
  assert.deepEqual((await readdir(dir)).sort(), ["manifest.json", "old.png"]);
});
