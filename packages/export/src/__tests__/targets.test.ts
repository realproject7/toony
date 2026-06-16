import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildInitialProject, writeProject } from "@toony/project-io";
import {
  buildExportProject,
  buildManyCutsProject,
  writeCutImages,
} from "../__fixtures__/project.js";
import { ExportError } from "../errors.js";
import { validateManifest } from "../manifest.js";
import { exportPlatform, exportPlotlink, exportStitched } from "../targets.js";

async function richProject(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "toony-export-"));
  const root = join(base, "proj");
  await writeProject(root, buildExportProject());
  await writeCutImages(root);
  return root;
}

function isPng(bytes: Uint8Array): boolean {
  return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

function isWebp(bytes: Uint8Array): boolean {
  const tag = (i: number) => String.fromCharCode(bytes[i] ?? 0);
  return (
    tag(0) + tag(1) + tag(2) + tag(3) === "RIFF" && tag(8) + tag(9) + tag(10) + tag(11) === "WEBP"
  );
}

test("platform export writes ordered PNG files with a valid manifest", async () => {
  const root = await richProject();
  const out = await exportPlatform(root, "ep-001", { width: 600, format: "png" });

  assert.deepEqual(validateManifest(out.manifest), []);
  assert.equal(out.manifest.target, "platform");
  assert.equal(out.manifest.files.length, 2);
  assert.equal(out.manifest.files[0]?.path, "episodes/ep-001/exports/platform/001.png");
  assert.equal(out.manifest.files[1]?.path, "episodes/ep-001/exports/platform/002.png");

  for (const file of out.manifest.files) {
    assert.equal(file.width, 600);
    assert.ok(!file.path.startsWith("/"));
    const bytes = new Uint8Array(await readFile(join(root, file.path)));
    assert.ok(isPng(bytes));
    assert.equal(bytes.length, file.byteSize);
  }
});

test("platform export supports configurable jpeg width and quality", async () => {
  const root = await richProject();
  const out = await exportPlatform(root, "ep-001", { width: 320, format: "jpeg", quality: 70 });
  assert.deepEqual(validateManifest(out.manifest), []);
  assert.equal(out.manifest.files[0]?.format, "jpeg");
  assert.equal(out.manifest.files[0]?.quality, 70);
  assert.equal(out.manifest.files[0]?.width, 320);
});

test("stitched export writes one image preserving the full sequence height", async () => {
  const root = await richProject();
  const out = await exportStitched(root, "ep-001", { width: 500, format: "png" });

  assert.deepEqual(validateManifest(out.manifest), []);
  assert.equal(out.manifest.target, "stitched");
  assert.equal(out.manifest.files.length, 1);
  const file = out.manifest.files[0];
  assert.ok(file);
  assert.equal(file.width, 500);
  // Two cuts (each ~500*1.4) plus a transition band → taller than a single cut.
  assert.ok(file.height > 500 * 1.4);
  const bytes = new Uint8Array(await readFile(join(root, file.path)));
  assert.ok(isPng(bytes));
});

test("plotlink export writes WebP within budget, markdown, and a manifest", async () => {
  const root = await richProject();
  const out = await exportPlotlink(root, "ep-001", { width: 400 });

  assert.deepEqual(validateManifest(out.manifest), []);
  assert.equal(out.manifest.target, "plotlink");
  assert.equal(out.manifest.files.length, 2);
  for (const file of out.manifest.files) {
    assert.equal(file.format, "webp");
    assert.ok(file.byteSize <= 1_000_000);
    const bytes = new Uint8Array(await readFile(join(root, file.path)));
    assert.ok(isWebp(bytes));
  }

  const md = out.manifest.markdown;
  assert.ok(md);
  assert.ok(md.characters >= 500 && md.characters <= 10000);
  const text = await readFile(join(root, md.path), "utf8");
  assert.equal(text.length, md.characters);
});

test("plotlink export refuses an episode below the markdown minimum", async () => {
  const base = await mkdtemp(join(tmpdir(), "toony-export-"));
  const root = join(base, "proj");
  await writeProject(root, buildInitialProject("Sparse")); // no lettering → short markdown
  await assert.rejects(() => exportPlotlink(root, "ep-001"), ExportError);
});

test("plotlink export enforces the 20-image limit", async () => {
  const base = await mkdtemp(join(tmpdir(), "toony-export-"));
  const root = join(base, "proj");
  await writeProject(root, buildManyCutsProject(21));
  await assert.rejects(() => exportPlotlink(root, "ep-001"), ExportError);
});

test("export refuses an unknown episode", async () => {
  const root = await richProject();
  await assert.rejects(() => exportPlatform(root, "ep-999"), ExportError);
});
