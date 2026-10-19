// Downloads serve only the files an output's manifest lists, from the real
// export folder, verified against their recorded size and hash. Requests must
// come from this computer and this page.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { exportCuts } from "@toony/export";
import { buildInitialProject, LEGACY_EXPORT_DIRS, writeProject } from "@toony/project-io";
import {
  assertLocalRead,
  buildExportZip,
  ExportAccessError,
  readExportFile,
  readExportFolder,
} from "../export-download.js";

async function exported(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), "toony-export-download-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "work");
  await writeProject(root, buildInitialProject("Download fixture"));
  const out = await exportCuts(root, "ep-001", { width: 200 });
  return { dir, root, out };
}

function status(code: number) {
  return (error: unknown) => error instanceof ExportAccessError && error.status === code;
}

test("downloads come only from a loopback host and this page", () => {
  const request = (url: string, headers: Record<string, string>) => new Request(url, { headers });
  assert.doesNotThrow(() =>
    assertLocalRead(request("http://127.0.0.1:4501/x", { host: "127.0.0.1:4501" })),
  );
  assert.doesNotThrow(() =>
    assertLocalRead(
      request("http://localhost:4501/x", {
        host: "localhost:4501",
        "sec-fetch-site": "same-origin",
      }),
    ),
  );
  assert.doesNotThrow(() =>
    assertLocalRead(
      request("http://localhost:4501/x", { host: "localhost:4501", "sec-fetch-site": "none" }),
    ),
  );
  for (const [url, headers] of [
    ["http://127.0.0.1:4501/x", { host: "127.0.0.1:4501", "sec-fetch-site": "cross-site" }],
    ["http://127.0.0.1:4501/x", { host: "127.0.0.1:4501", "sec-fetch-site": "same-site" }],
    ["http://127.0.0.1:4501/x", { host: "studio.example:4501" }],
    ["http://192.168.1.4:4501/x", { host: "192.168.1.4:4501" }],
  ] as const) {
    assert.throws(
      () => assertLocalRead(request(url, headers)),
      status(403),
      JSON.stringify(headers),
    );
  }
});

test("a listed file is served with its bytes; anything else is not", async (t) => {
  const { root, out } = await exported(t);
  const first = out.manifest.files[0];
  assert.ok(first);
  const file = await readExportFile(root, "ep-001", "cuts", "001.png", first.sha256.slice(0, 16));
  assert.equal(file.contentType, "image/png");
  assert.deepEqual(Buffer.from(file.bytes), await readFile(join(root, first.path)));
  const manifest = await readExportFile(root, "ep-001", "cuts", "manifest.json");
  assert.equal(manifest.contentType, "application/json");
  await writeFile(join(out.outDir, "notes.txt"), "Not part of the export.");
  for (const name of ["notes.txt", "../cuts/001.png", "../../cuts.yaml", "", "003.png"]) {
    await assert.rejects(() => readExportFile(root, "ep-001", "cuts", name), status(404), name);
  }
  for (const [episode, output] of [
    ["..", "cuts"],
    ["ep-001", "../ep-001"],
    ...LEGACY_EXPORT_DIRS.map((folder) => ["ep-001", folder] as const),
  ]) {
    await assert.rejects(() => readExportFile(root, episode, output, "001.png"), status(400));
  }
  await assert.rejects(() => readExportFile(root, "ep-001", "strip", "episode.png"), status(404));
  await assert.rejects(
    () => readExportFile(root, "ep-001", "cuts", "001.png", "0".repeat(16)),
    status(409),
  );
});

test("a changed file or a symlink is refused instead of served", async (t) => {
  const { dir, root, out } = await exported(t);
  const path = join(root, out.manifest.files[0]?.path ?? "");
  const bytes = await readFile(path);
  bytes[bytes.length - 1] = (bytes.at(-1) ?? 0) ^ 1;
  await writeFile(path, bytes);
  await assert.rejects(() => readExportFile(root, "ep-001", "cuts", "001.png"), status(409));
  await assert.rejects(() => buildExportZip(root, "ep-001", "cuts"), status(409));
  // A listed name that is a symlink to identical bytes elsewhere is not followed.
  const second = join(root, out.manifest.files[1]?.path ?? "");
  const outside = join(dir, "outside.png");
  await writeFile(outside, await readFile(second));
  await rm(second);
  await symlink(outside, second);
  await assert.rejects(() => readExportFile(root, "ep-001", "cuts", "002.png"), status(409));
});

test("a symlinked export folder is never read through", async (t) => {
  const { dir, root } = await exported(t);
  const exportsDir = join(root, "episodes/ep-001/exports");
  const moved = join(dir, "elsewhere");
  await rename(exportsDir, moved);
  await symlink(moved, exportsDir);
  await assert.rejects(() => readExportFolder(root, "ep-001", "cuts"), status(400));
  await assert.rejects(() => buildExportZip(root, "ep-001", "cuts"), status(400));
});

test("Download all is a ZIP of every file plus the manifest, in reading order", async (t) => {
  const { root, out } = await exported(t);
  const zip = await buildExportZip(root, "ep-001", "cuts");
  assert.equal(zip.name, "ep-001-cuts.zip");
  const bytes = Buffer.from(zip.bytes);
  assert.equal(bytes.readUInt32LE(0), 0x04034b50);
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50);
  assert.equal(bytes.readUInt16LE(end + 10), out.manifest.files.length + 1);
  const names: string[] = [];
  let at = bytes.readUInt32LE(end + 16);
  for (let i = 0; i < out.manifest.files.length + 1; i++) {
    const length = bytes.readUInt16LE(at + 28);
    names.push(bytes.subarray(at + 46, at + 46 + length).toString("utf8"));
    at += 46 + length;
  }
  assert.deepEqual(names, [
    "ep-001-cuts/001.png",
    "ep-001-cuts/002.png",
    "ep-001-cuts/manifest.json",
  ]);
  // Each stored file's bytes appear verbatim after its local header.
  const png = await readFile(join(root, out.manifest.files[0]?.path ?? ""));
  assert.ok(bytes.includes(png));
});
