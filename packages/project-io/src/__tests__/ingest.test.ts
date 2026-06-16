import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { ProviderResult } from "@toony/providers";
import { ProjectIoError } from "../errors.js";
import { ingestImageAsset } from "../ingest.js";
import { loadProject } from "../reader.js";
import { buildInitialProject } from "../scaffold.js";
import { writeProject } from "../writer.js";

function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function pngChunk(type: string, data: number[]): number[] {
  return [...u32be(data.length), ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
}

/** A small PNG carrying a tEXt metadata chunk, to prove ingest strips it. */
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
    ...pngChunk("tEXt", [...[..."owner device serial"].map((c) => c.charCodeAt(0))]),
    ...pngChunk("IDAT", [0x08, 0x1d, 0x01]),
    ...pngChunk("IEND", []),
  ]);
}

function manualResult(): ProviderResult {
  return {
    bytes: pngWithText(),
    format: "png",
    provenance: { source: "manual", providerId: "manual", contentType: "image/png" },
  };
}

async function freshProject(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "toony-io-"));
  const root = join(base, "proj");
  await writeProject(root, buildInitialProject("Ingest Sample"));
  return root;
}

test("ingesting a cut clean asset associates the record and strips metadata", async () => {
  const root = await freshProject();
  const out = await ingestImageAsset(
    root,
    { kind: "cut", episodeId: "ep-001", cutId: "cut-001", slot: "clean" },
    manualResult(),
  );
  assert.equal(out.assetPath, "episodes/ep-001/assets/clean/cut-001.png");

  const loaded = await loadProject(root);
  const cut = loaded.project.episodes[0]?.cuts.find((c) => c.id === "cut-001");
  assert.equal(cut?.image?.clean, "episodes/ep-001/assets/clean/cut-001.png");
  assert.equal(cut?.image?.final, null);

  const written = await readFile(
    join(root, "episodes", "ep-001", "assets", "clean", "cut-001.png"),
  );
  const text = Buffer.from(written).toString("latin1");
  assert.ok(!text.includes("tEXt"));
  assert.ok(text.includes("IDAT"));
});

test("the ingested project still validates", async () => {
  const root = await freshProject();
  await ingestImageAsset(
    root,
    { kind: "cut", episodeId: "ep-001", cutId: "cut-001", slot: "clean" },
    manualResult(),
  );
  const loaded = await loadProject(root);
  assert.equal(loaded.validation.valid, true, JSON.stringify(loaded.validation.issues));
});

test("ingesting a transition asset associates the single image ref", async () => {
  const root = await freshProject();
  const out = await ingestImageAsset(
    root,
    { kind: "transition", episodeId: "ep-001", transitionId: "tr-001" },
    manualResult(),
  );
  assert.equal(out.assetPath, "episodes/ep-001/assets/clean/tr-001.png");
  const loaded = await loadProject(root);
  const transition = loaded.project.episodes[0]?.transitions.find((t) => t.id === "tr-001");
  assert.equal(transition?.image, "episodes/ep-001/assets/clean/tr-001.png");
});

test("a final-slot ingest preserves a previously-set clean slot", async () => {
  const root = await freshProject();
  await ingestImageAsset(
    root,
    { kind: "cut", episodeId: "ep-001", cutId: "cut-001", slot: "clean" },
    manualResult(),
  );
  await ingestImageAsset(
    root,
    { kind: "cut", episodeId: "ep-001", cutId: "cut-001", slot: "final" },
    manualResult(),
  );
  const loaded = await loadProject(root);
  const cut = loaded.project.episodes[0]?.cuts.find((c) => c.id === "cut-001");
  assert.equal(cut?.image?.clean, "episodes/ep-001/assets/clean/cut-001.png");
  assert.equal(cut?.image?.final, "episodes/ep-001/assets/final/cut-001.png");
});

test("a neutral provenance entry is recorded without leaking absolute paths", async () => {
  const root = await freshProject();
  await ingestImageAsset(
    root,
    { kind: "cut", episodeId: "ep-001", cutId: "cut-001", slot: "clean" },
    manualResult(),
  );
  const log = JSON.parse(
    await readFile(join(root, "episodes", "ep-001", "logs", "ingest.json"), "utf8"),
  );
  assert.equal(Array.isArray(log), true);
  assert.equal(log.length, 1);
  assert.equal(log[0].assetPath, "episodes/ep-001/assets/clean/cut-001.png");
  assert.equal(log[0].source, "manual");
  assert.equal(log[0].providerId, "manual");
  assert.equal(typeof log[0].sha256, "string");
  // No absolute project path may appear anywhere in the provenance log.
  assert.ok(!JSON.stringify(log).includes(root));
});

test("a schema-valid but path-unsafe record id cannot escape the asset folder", async () => {
  // A cut id with parent segments is a non-empty string, so the schema accepts
  // it — but ingest must refuse to derive an asset path from it.
  const base = await mkdtemp(join(tmpdir(), "toony-io-"));
  const root = join(base, "proj");
  const project = buildInitialProject("Traversal Sample");
  const bundle = project.episodes[0];
  assert.ok(bundle);
  const evilId = "../../pwned";
  bundle.cuts.push({ id: evilId, image: null });
  bundle.episode.sequence.push({ type: "cut", id: evilId }); // keep it referenced so the project is valid
  await writeProject(root, project);

  await assert.rejects(
    () =>
      ingestImageAsset(
        root,
        { kind: "cut", episodeId: "ep-001", cutId: evilId, slot: "clean" },
        manualResult(),
      ),
    ProjectIoError,
  );
  // Nothing was written outside the asset folder.
  await assert.rejects(() => readFile(join(base, "pwned.png")));
  await assert.rejects(() => readFile(join(root, "pwned.png")));
});

test("an unknown cut id is rejected", async () => {
  const root = await freshProject();
  await assert.rejects(
    () =>
      ingestImageAsset(
        root,
        { kind: "cut", episodeId: "ep-001", cutId: "cut-404", slot: "clean" },
        manualResult(),
      ),
    ProjectIoError,
  );
});
