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
import { writePlotlinkPackage } from "../plotlink-package.js";

const relativeDir = "episodes/ep-001/exports/plotlink";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "toony-plotlink-ownership-"));
  const dir = join(root, "package");
  const image = createCanvas(4, 4).toBuffer("image/webp", 82);
  const markdown = "An original caption. ".repeat(30);
  const manifest: ExportManifest = {
    manifestVersion: 1,
    target: "plotlink",
    projectId: "ownership-fixture",
    episodeId: "ep-001",
    width: 4,
    files: ["001.webp", "002.webp"].map((name) => ({
      path: `${relativeDir}/${name}`,
      format: "webp",
      width: 4,
      height: 4,
      byteSize: image.length,
      quality: 82,
      sha256: sha256Hex(image),
    })),
    markdown: {
      path: `${relativeDir}/episode.md`,
      characters: markdown.length,
      sha256: sha256Hex(Buffer.from(markdown)),
    },
  };
  const outputs = new Map<string, string | Uint8Array>([
    ["001.webp", image],
    ["002.webp", image],
    ["episode.md", markdown],
    ["manifest.json", JSON.stringify(manifest)],
  ]);
  await writePlotlinkPackage(dir, relativeDir, outputs);
  // The next package replaces 001 and removes stale 002. Both must be verified.
  const replacement = new Map(outputs);
  replacement.delete("002.webp");
  replacement.set(
    "manifest.json",
    JSON.stringify({ ...manifest, files: manifest.files.slice(0, 1) }),
  );
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

async function assertConflictPreservesPackage(f: Awaited<ReturnType<typeof fixture>>) {
  const before = await snapshot(f.dir);
  await assert.rejects(
    () => writePlotlinkPackage(f.dir, relativeDir, f.replacement),
    (error: unknown) => error instanceof ExportError && error.code === "plotlink.output-conflict",
  );
  assert.deepEqual(await snapshot(f.dir), before);
  // Verification fails before staging or renaming the existing package.
  assert.deepEqual(await readdir(f.root), ["package"]);
}

for (const field of ["sha256", "byteSize"] as const) {
  test(`a structurally valid manifest with wrong ${field} cannot claim an existing image`, async () => {
    const f = await fixture();
    const first = f.manifest.files[0];
    assert.ok(first);
    if (field === "sha256") first.sha256 = "0".repeat(64);
    else first.byteSize++;
    await writeFile(join(f.dir, "manifest.json"), JSON.stringify(f.manifest));
    await assertConflictPreservesPackage(f);
  });
}

for (const name of ["001.webp", "002.webp", "episode.md"]) {
  test(`user edits to ${name} prevent replacement and stale-file cleanup`, async () => {
    const f = await fixture();
    const edited = await readFile(join(f.dir, name));
    // Same byte count: checking size alone must not establish ownership.
    edited[0] = (edited[0] ?? 0) ^ 1;
    await writeFile(join(f.dir, name), edited);
    await assertConflictPreservesPackage(f);
  });
}

test("markdown character-count metadata must also match its current bytes", async () => {
  const f = await fixture();
  assert.ok(f.manifest.markdown);
  f.manifest.markdown.characters++;
  await writeFile(join(f.dir, "manifest.json"), JSON.stringify(f.manifest));
  await assertConflictPreservesPackage(f);
});

test("a missing claimed stale image fails without replacing the surviving package", async () => {
  const f = await fixture();
  await unlink(join(f.dir, "002.webp"));
  await assertConflictPreservesPackage(f);
});

for (const name of ["001.webp", "002.webp", "episode.md", "manifest.json"]) {
  test(`a claimed ${name} symlink is rejected even when its target bytes match`, async () => {
    const f = await fixture();
    const outsideDir = await mkdtemp(join(tmpdir(), "toony-unrelated-output-"));
    const outside = join(outsideDir, "user-file");
    const bytes = await readFile(join(f.dir, name));
    await writeFile(outside, bytes);
    await unlink(join(f.dir, name));
    await symlink(outside, join(f.dir, name));
    await assertConflictPreservesPackage(f);
    assert.deepEqual(await readFile(outside), bytes);
  });
}

test("verified previous bytes allow replacement and removal of only stale owned images", async () => {
  const f = await fixture();
  await writeFile(join(f.dir, "user-note.txt"), "Preserve this note.");
  await writePlotlinkPackage(f.dir, relativeDir, f.replacement);
  assert.deepEqual((await readdir(f.dir)).sort(), [
    "001.webp",
    "episode.md",
    "manifest.json",
    "user-note.txt",
  ]);
  assert.deepEqual(await readFile(join(f.dir, "001.webp")), f.image);
  assert.equal(await readFile(join(f.dir, "user-note.txt"), "utf8"), "Preserve this note.");
});
