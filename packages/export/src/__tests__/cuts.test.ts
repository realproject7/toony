// Cut images: one opaque image per cut, equal to the shared compositor's output
// at the content width, padded by the margin; text cards on request.

import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { writeProject } from "@toony/project-io";
import { resolveReferenceWidth } from "@toony/schema";
import { buildSequenceProject, writeSequenceImages } from "../__fixtures__/project.js";
import { composeCut, composeTransitionBand } from "../compose.js";
import { ExportError } from "../errors.js";
import { composeOptions, loadEpisode } from "../load.js";
import { validateManifest } from "../manifest.js";
import { exportCuts } from "../outputs.js";
import { assertSamePixels, crop, decodePixels, isWhite, regionPixels } from "./pixels.js";

async function sequenceProject(): Promise<string> {
  const root = join(await mkdtemp(join(tmpdir(), "toony-cuts-")), "project");
  await writeProject(root, buildSequenceProject());
  await writeSequenceImages(root);
  return root;
}

/** The compositor's own raster of one cut at `width`. */
async function composed(root: string, cutId: string, width: number) {
  const loaded = await loadEpisode(root, "ep-001");
  const cut = loaded.bundle.cuts.find((c) => c.id === cutId);
  assert.ok(cut);
  return composeCut(
    loaded.bundle.lettering.filter((o) => o.cutId === cutId),
    loaded.imageFor(cutId)?.bytes ?? null,
    width,
    composeOptions(loaded.project, cut),
  );
}

test("each cut image equals the compositor's cut, in reading order", async () => {
  const root = await sequenceProject();
  const out = await exportCuts(root, "ep-001", { width: 600 });
  assert.deepEqual(validateManifest(out.manifest), []);
  assert.deepEqual(
    out.manifest.files.map((file) => [file.role, file.items[0]?.id, file.items[0]?.index]),
    [
      ["cut", "cut-001", 0],
      ["cut", "cut-002", 2],
      ["cut", "cut-003", 4],
      ["cut", "cut-004", 6],
      ["cut", "cut-005", 8],
    ],
  );
  for (const file of out.manifest.files) {
    const id = file.items[0]?.id as string;
    const cut = await composed(root, id, 600);
    const decoded = await decodePixels(await readFile(join(root, file.path)));
    assert.equal(decoded.width, 600);
    assert.equal(decoded.height, cut.height);
    assertSamePixels(decoded.data, regionPixels(cut.canvas, 0, 0, 600, cut.height), id);
  }
});

test("a margin pads every side with the background and keeps the cut at the content width", async () => {
  const root = await sequenceProject();
  const out = await exportCuts(root, "ep-001", { width: 600, margin: 30 });
  assert.equal(out.manifest.options.contentWidth, 540);
  for (const file of out.manifest.files) {
    const id = file.items[0]?.id as string;
    const cut = await composed(root, id, 540);
    const decoded = await decodePixels(await readFile(join(root, file.path)));
    assert.equal(decoded.width, 600);
    assert.equal(decoded.height, cut.height + 60);
    assert.ok(isWhite(decoded, 0, 0, 600, 30), `${id} top margin`);
    assert.ok(isWhite(decoded, 0, cut.height + 30, 600, 30), `${id} bottom margin`);
    assert.ok(isWhite(decoded, 0, 0, 30, decoded.height), `${id} left margin`);
    assert.ok(isWhite(decoded, 570, 0, 30, decoded.height), `${id} right margin`);
    assertSamePixels(
      crop(decoded, 30, 30, 540, cut.height),
      regionPixels(cut.canvas, 0, 0, 540, cut.height),
      id,
    );
  }
});

test("art with transparency becomes an opaque image on the background", async () => {
  const root = await sequenceProject();
  const out = await exportCuts(root, "ep-001", { width: 300 });
  const file = out.manifest.files.find((f) => f.items[0]?.id === "cut-005");
  assert.ok(file);
  const decoded = await decodePixels(await readFile(join(root, file.path)));
  for (let i = 3; i < decoded.data.length; i += 4) assert.equal(decoded.data[i], 255);
  // The source's transparent bottom third reads as the white background.
  assert.ok(isWhite(decoded, 0, decoded.height - 20, 300, 20));
});

test("text cards become their own images only when asked", async () => {
  const root = await sequenceProject();
  const out = await exportCuts(root, "ep-001", { width: 600, textCards: true });
  assert.deepEqual(
    out.manifest.files.map((file) => `${file.role}:${file.items[0]?.id}`),
    [
      "cut:cut-001",
      "card:tr-001",
      "cut:cut-002",
      "cut:cut-003",
      "card:tr-003",
      "cut:cut-004",
      "cut:cut-005",
    ],
  );
  // A card image is the compositor's band at the content width.
  const loaded = await loadEpisode(root, "ep-001");
  const card = loaded.bundle.transitions.find((t) => t.id === "tr-003");
  assert.ok(card);
  const band = composeTransitionBand(
    card,
    600,
    resolveReferenceWidth(loaded.project.webtoon.referenceWidth),
  );
  assert.ok(band);
  const file = out.manifest.files[4];
  assert.ok(file);
  const decoded = await decodePixels(await readFile(join(root, file.path)));
  assertSamePixels(decoded.data, regionPixels(band.canvas, 0, 0, 600, band.height), "tr-003");
  assert.equal(out.manifest.options.textCards, true);
});

test("a margin that leaves no room for the cut is refused", async () => {
  const root = await sequenceProject();
  await assert.rejects(
    () => exportCuts(root, "ep-001", { width: 600, margin: 300 }),
    (error: unknown) => error instanceof ExportError && error.code === "cuts.margin-too-large",
  );
});
