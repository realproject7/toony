// Social frames: fixed-size images with content inside the safe insets, whole
// bands per frame, tall cuts split into rows or fitted, posts grouped.

import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { writeProject } from "@toony/project-io";
import { resolveReferenceWidth } from "@toony/schema";
import { buildSequenceProject, writeSequenceImages } from "../__fixtures__/project.js";
import { composeCut } from "../compose.js";
import { SOCIAL_FRAMES } from "../defaults.js";
import { planOutput, resolveOutputOptions } from "../layout.js";
import { composeOptions, loadEpisode, loadedBands } from "../load.js";
import { validateManifest } from "../manifest.js";
import { exportSocial } from "../outputs.js";
import { assertSamePixels, crop, decodePixels, isWhite, regionPixels } from "./pixels.js";

async function sequenceProject(): Promise<string> {
  const root = join(await mkdtemp(join(tmpdir(), "toony-social-")), "project");
  await writeProject(root, buildSequenceProject());
  await writeSequenceImages(root);
  return root;
}

for (const frame of Object.values(SOCIAL_FRAMES)) {
  test(`${frame.id} frames are exactly ${frame.width} x ${frame.height} with clear safe insets`, async () => {
    const root = await sequenceProject();
    const out = await exportSocial(root, "ep-001", { frame: frame.id });
    assert.deepEqual(validateManifest(out.manifest), []);
    assert.equal(out.manifest.kind, "social");
    assert.equal(
      out.manifest.output,
      {
        "instagram-portrait": "instagram",
        "instagram-square": "instagram-square",
        "x-landscape": "x",
      }[frame.id],
    );
    assert.equal(out.manifest.options.frame?.id, frame.id);
    assert.equal(out.manifest.options.imagesPerPost, frame.imagesPerPost);
    for (const file of out.manifest.files) {
      assert.equal(file.role, "frame");
      const decoded = await decodePixels(await readFile(join(root, file.path)));
      assert.equal(decoded.width, frame.width);
      assert.equal(decoded.height, frame.height);
      const { top, right, bottom, left } = frame.safe;
      assert.ok(isWhite(decoded, 0, 0, frame.width, top), `${file.path} top inset`);
      assert.ok(
        isWhite(decoded, 0, frame.height - bottom, frame.width, bottom),
        `${file.path} bottom`,
      );
      assert.ok(isWhite(decoded, 0, 0, left, frame.height), `${file.path} left inset`);
      assert.ok(
        isWhite(decoded, frame.width - right, 0, right, frame.height),
        `${file.path} right`,
      );
      assert.equal(
        file.post,
        Math.floor(out.manifest.files.indexOf(file) / frame.imagesPerPost) + 1,
      );
    }
    // Every cut and every text card is shown; a plain gutter never starts a frame.
    const shown = new Set(out.manifest.files.flatMap((file) => file.items.map((item) => item.id)));
    for (const id of ["cut-001", "cut-002", "cut-003", "cut-004", "cut-005", "tr-001", "tr-003"]) {
      assert.ok(shown.has(id), `${id} is shown`);
    }
    for (const file of out.manifest.files) assert.notEqual(file.items[0]?.id, "tr-002");
  });
}

test("a tall cut split across frames shows each of its rows exactly once", async () => {
  const root = await sequenceProject();
  const out = await exportSocial(root, "ep-001", { frame: "instagram-portrait" });
  // cut-004 is 3x as tall as wide: 2916 rows at the 972 px content width.
  const pieces = out.manifest.files.flatMap((file) =>
    file.items.filter((item) => item.id === "cut-004").map((item) => ({ file, item })),
  );
  assert.deepEqual(
    pieces.map(({ item }) => [item.top, item.height]),
    [
      [0, 1242],
      [1242, 1242],
      [2484, 432],
    ],
  );
  assert.ok(
    out.manifest.warnings.some((w) => w.code === "social.split" && w.items.includes("cut-004")),
  );
  // The pixels of the middle frame are the compositor's rows 1242..2484 of the cut.
  const loaded = await loadEpisode(root, "ep-001");
  const cut = loaded.bundle.cuts.find((c) => c.id === "cut-004");
  assert.ok(cut);
  const raster = await composeCut(
    loaded.bundle.lettering.filter((o) => o.cutId === "cut-004"),
    null,
    972,
    composeOptions(loaded.project, cut),
  );
  const middle = pieces[1]?.file;
  assert.ok(middle);
  const decoded = await decodePixels(await readFile(join(root, middle.path)));
  assertSamePixels(
    crop(decoded, 54, 54, 972, 1242),
    regionPixels(raster.canvas, 0, 1242, 972, 1242),
    "rows",
  );
});

test("fit mode composes a tall cut narrower when it stays legible, and splits otherwise", async () => {
  const root = await sequenceProject();
  const out = await exportSocial(root, "ep-001", { frame: "x-landscape", tallCuts: "fit" });
  const items = out.manifest.files.flatMap((file) => file.items);
  // cut-001 (art 240 x 336) fits whole at 578 px wide: 0.72 of the 800 px column.
  const fitted = items.filter((item) => item.id === "cut-001");
  assert.deepEqual(fitted, [{ type: "cut", id: "cut-001", index: 0, width: 578 }]);
  // cut-004 would be 270 px wide, too small to read: it is split instead.
  assert.ok(items.filter((item) => item.id === "cut-004").length > 1);
  assert.ok(
    out.manifest.warnings.some(
      (w) => w.code === "social.fit-too-small" && w.items[0] === "cut-004",
    ),
  );
  // The fitted cut sits centred in the content box, as the plan placed it.
  const loaded = await loadEpisode(root, "ep-001");
  const referenceWidth = resolveReferenceWidth(loaded.project.webtoon.referenceWidth);
  const options = resolveOutputOptions(
    "social",
    { frame: "x-landscape", tallCuts: "fit" },
    referenceWidth,
  );
  const plan = planOutput(loadedBands(loaded), options, referenceWidth);
  const piece = plan.files[0]?.pieces[0];
  assert.ok(piece);
  assert.equal(piece.x, 80 + Math.floor((1440 - 578) / 2));
});

test("X frames are grouped into posts of four", async () => {
  const root = await sequenceProject();
  const out = await exportSocial(root, "ep-001", { frame: "x-landscape" });
  assert.ok(out.manifest.files.length > 4);
  const posts = out.manifest.files.map((file) => file.post);
  assert.deepEqual(
    posts,
    out.manifest.files.map((_, i) => Math.floor(i / 4) + 1),
  );
  const last = posts.at(-1) as number;
  assert.ok(
    out.manifest.warnings.some(
      (w) =>
        w.code === "social.posts" && w.message === `This needs ${last} posts of up to 4 images.`,
    ),
  );
});
