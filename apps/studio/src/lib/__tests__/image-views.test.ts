// Image views in Studio (CMP-01): framing a cut's picture and reusing another
// cut's picture are single undoable changes; the source pixels are never
// rewritten; redrawing one cut never changes what another shows; the preview
// art carries the same crop the export reads.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import { loadProject } from "@toony/project-io";
import { editCutsArgs } from "../agent/tools/args.js";
import {
  contextFor,
  createBlankEpisode,
  createWork,
  editCuts,
  importArtwork,
  reuseCutPicture,
  setCutImageView,
  undoChange,
} from "../ops/index.js";
import { resolveCutArt, viewedArt } from "../project.js";

function crc(bytes: Buffer): number {
  let c = ~0;
  for (const byte of bytes) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc(body));
  return Buffer.concat([head, body, tail]);
}

/** A 100 x 300 PNG of one colour, "#rrggbb". */
function picture(color: string): Buffer {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16));
  const row = Buffer.from([
    0,
    ...Array.from({ length: 100 }, () => [r ?? 0, g ?? 0, b ?? 0]).flat(),
  ]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(100, 0);
  header.writeUInt32BE(300, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: 300 }, () => row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function work(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), "toony-views-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const created = await createWork(dir, "Tower");
  const root = join(dir, created.workId);
  const ctx = contextFor(root, { workId: created.workId, actor: "human" });
  await createBlankEpisode(ctx, { cuts: 3 });
  return { root, ctx, workId: created.workId };
}

const cutOf = async (root: string, id: string) =>
  (await loadProject(root)).project.episodes[0]?.cuts.find((c) => c.id === id);

test("framing a cut is one undoable change that leaves the picture as it was", async (t) => {
  const { root, ctx, workId } = await work(t);
  await assert.rejects(
    setCutImageView(ctx, "ep-001", "cut-001", { x: 0, y: 0, width: 1, height: 0.5 }),
    /no picture to frame/,
  );
  const imported = await importArtwork(ctx, "ep-001", "cut-001", picture("#ff0000"));
  const before = await readFile(join(root, imported.image));
  const change = await setCutImageView(ctx, "ep-001", "cut-001", {
    x: 0,
    y: 1 / 3,
    width: 1,
    height: 1 / 3,
  });
  const framed = await cutOf(root, "cut-001");
  assert.deepEqual(framed?.imageView, { x: 0, y: 0.3333, width: 1, height: 0.3333 });
  assert.deepEqual(await readFile(join(root, imported.image)), before, "source untouched");
  assert.ok(framed);
  const art = await resolveCutArt(workId, root, framed);
  assert.deepEqual([art.width, art.height], [100, 100]);
  assert.deepEqual(art.view, {
    x: 0,
    y: 100,
    width: 100,
    height: 100,
    sourceWidth: 100,
    sourceHeight: 300,
  });

  await assert.rejects(
    setCutImageView(ctx, "ep-001", "cut-001", { x: 0, y: 0.8, width: 1, height: 0.5 }),
    /inside the picture/,
  );
  assert.ok(change);
  await undoChange(ctx, change.changeId);
  assert.equal((await cutOf(root, "cut-001"))?.imageView, undefined);
  const reset = await setCutImageView(ctx, "ep-001", "cut-001", null);
  assert.equal(reset, null, "showing all of an unframed picture changes nothing");
});

test("a cut can show part of another cut's picture without the two sharing a file", async (t) => {
  const { root, ctx } = await work(t);
  await importArtwork(ctx, "ep-001", "cut-001", picture("#00ff00"));
  await assert.rejects(
    reuseCutPicture(ctx, "ep-001", "cut-002", "cut-003", null),
    /no picture yet/,
  );
  const change = await reuseCutPicture(ctx, "ep-001", "cut-002", "cut-001", {
    x: 0,
    y: 0.5,
    width: 1,
    height: 0.5,
  });
  const upper = await cutOf(root, "cut-001");
  const lower = await cutOf(root, "cut-002");
  assert.ok(upper?.image?.clean && lower?.image?.clean);
  assert.notEqual(lower.image.clean, upper.image.clean, "each cut keeps its own copy");
  assert.deepEqual(lower.imageView, { x: 0, y: 0.5, width: 1, height: 0.5 });
  const copy = await readFile(join(root, lower.image.clean));
  // Redrawing the first cut never changes what the second shows.
  await writeFile(join(root, upper.image.clean), picture("#0000ff"));
  assert.deepEqual(await readFile(join(root, lower.image.clean)), copy);
  assert.ok(change);
  await undoChange(ctx, change.changeId);
  const undone = await cutOf(root, "cut-002");
  assert.equal(undone?.image, null);
  assert.equal(undone?.imageView, undefined);

  // A picture that is a link out of the work is not copied in.
  const outside = join(await mkdtemp(join(tmpdir(), "toony-outside-")), "secret.png");
  t.after(() => rm(outside, { force: true }));
  await writeFile(outside, picture("#123456"));
  const linked = await importArtwork(ctx, "ep-001", "cut-003", picture("#ffffff"));
  await unlink(join(root, linked.image));
  await symlink(outside, join(root, linked.image));
  await assert.rejects(
    reuseCutPicture(ctx, "ep-001", "cut-002", "cut-003", null),
    /could not be read/,
  );
});

test("preview art for a framed cut is the view's size with the crop it needs", () => {
  assert.deepEqual(viewedArt("/a", 832, 1216, undefined), { src: "/a", width: 832, height: 1216 });
  assert.deepEqual(viewedArt("/a", 832, 1216, { x: 0, y: 0, width: 1, height: 1 }), {
    src: "/a",
    width: 832,
    height: 1216,
  });
  assert.deepEqual(viewedArt("/a", 832, 1216, { x: 0, y: 0.5, width: 1, height: 0.5 }), {
    src: "/a",
    width: 832,
    height: 608,
    view: { x: 0, y: 608, width: 832, height: 608, sourceWidth: 832, sourceHeight: 1216 },
  });
});

test("the agent frames a cut through edit_cuts, and only a cut that has a picture", async (t) => {
  const { root, ctx } = await work(t);
  await importArtwork(ctx, "ep-001", "cut-001", picture("#ff0000"));
  const parsed = editCutsArgs({
    episodeId: "ep-001",
    operations: [{ op: "update", cutId: "cut-001", view: { x: 0, y: 0.5, width: 1, height: 0.5 } }],
  });
  await editCuts(ctx, "ep-001", parsed.operations);
  assert.deepEqual((await cutOf(root, "cut-001"))?.imageView, {
    x: 0,
    y: 0.5,
    width: 1,
    height: 0.5,
  });
  await assert.rejects(
    editCuts(ctx, "ep-001", [
      { op: "update", cutId: "cut-002", imageView: { x: 0, y: 0, width: 1, height: 0.5 } },
    ]),
    /picture before framing/,
  );
  assert.throws(
    () =>
      editCutsArgs({
        episodeId: "ep-001",
        operations: [
          { op: "update", cutId: "cut-001", view: { x: 0, y: 0.7, width: 1, height: 0.5 } },
        ],
      }),
    /view must be/,
  );
  await editCuts(
    ctx,
    "ep-001",
    editCutsArgs({
      episodeId: "ep-001",
      operations: [{ op: "update", cutId: "cut-001", view: null }],
    }).operations,
  );
  assert.equal((await cutOf(root, "cut-001"))?.imageView, undefined);
});
