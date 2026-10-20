// Image views (CMP-01): a cut shows part of its picture, and every output reads
// the same crop. A tall synthetic picture with known colour bands stands in for
// art: red on top, green in the middle, blue at the bottom.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { writeProject } from "@toony/project-io";
import { buildManyCutsProject } from "../__fixtures__/project.js";
import { loadEpisode, loadedBands } from "../load.js";
import { exportCuts } from "../outputs.js";
import { stitchEpisode } from "../targets.js";
import { decodePixels } from "./pixels.js";

const BANDS = ["#ff0000", "#00ff00", "#0000ff"] as const;

/** A 200 x 600 picture in three 200-pixel colour bands. */
function landmarks(): Buffer {
  const canvas = createCanvas(200, 600);
  const ctx = canvas.getContext("2d");
  BANDS.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, i * 200, 200, 200);
  });
  return canvas.toBuffer("image/png");
}

async function viewProject(): Promise<string> {
  const root = join(await mkdtemp(join(tmpdir(), "toony-view-")), "project");
  const project = buildManyCutsProject(3);
  const bundle = project.episodes[0];
  assert.ok(bundle);
  const ref = (id: string) => ({ clean: `episodes/ep-001/assets/clean/${id}.png`, final: null });
  const [whole, top, lower] = bundle.cuts;
  assert.ok(whole && top && lower);
  whole.image = ref(whole.id);
  // The top band only.
  top.image = ref(top.id);
  top.imageView = { x: 0, y: 0, width: 1, height: 1 / 3 };
  // The lower half: overlapping the middle band, reaching the bottom.
  lower.image = ref(lower.id);
  lower.imageView = { x: 0, y: 0.5, width: 1, height: 0.5 };
  await writeProject(root, project);
  const dir = join(root, "episodes/ep-001/assets/clean");
  await mkdir(dir, { recursive: true });
  for (const cut of bundle.cuts) await writeFile(join(dir, `${cut.id}.png`), landmarks());
  return root;
}

function colorAt(pixels: { width: number; data: Uint8ClampedArray }, x: number, y: number) {
  const i = (y * pixels.width + x) * 4;
  const [r, g, b] = [pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]];
  return `#${[r, g, b].map((v) => (v ?? 0).toString(16).padStart(2, "0")).join("")}`;
}

test("every output and the layout read a cut's view, and the source stays whole", async () => {
  const root = await viewProject();
  const loaded = await loadEpisode(root, "ep-001");
  assert.deepEqual(
    ["cut-01", "cut-02", "cut-03"].map((id) => {
      const image = loaded.imageFor(id);
      return [image?.width, image?.height];
    }),
    [
      [200, 600],
      [200, 200],
      [200, 300],
    ],
  );
  const bands = loadedBands(loaded).filter((band) => band.type === "cut");
  assert.deepEqual(
    bands.map((band) => Math.round(band.heightAt(200))),
    [600, 200, 300],
    "measurement uses the view's shape",
  );

  const out = await exportCuts(root, "ep-001", { width: 200 });
  const [whole, top, lower] = await Promise.all(
    out.manifest.files.map(async (file) => decodePixels(await readFile(join(root, file.path)))),
  );
  assert.ok(whole && top && lower);
  assert.deepEqual([whole.height, top.height, lower.height], [600, 200, 300]);
  assert.equal(colorAt(whole, 100, 100), BANDS[0]);
  assert.equal(colorAt(whole, 100, 500), BANDS[2]);
  assert.equal(colorAt(top, 100, 10), BANDS[0]);
  assert.equal(colorAt(top, 100, 190), BANDS[0]);
  assert.equal(colorAt(lower, 100, 40), BANDS[1], "the lower half starts in the middle band");
  assert.equal(colorAt(lower, 100, 260), BANDS[2]);
  // The source pixels are never rewritten.
  const source = await readFile(join(root, "episodes/ep-001/assets/clean/cut-02.png"));
  assert.deepEqual(source, landmarks());
});

/** Two cuts showing the upper and lower halves of one picture, optionally with a gap between. */
async function splitProject(gap: number | null): Promise<string> {
  const root = join(await mkdtemp(join(tmpdir(), "toony-split-")), "project");
  const project = buildManyCutsProject(2);
  const bundle = project.episodes[0];
  assert.ok(bundle);
  const [upper, lower] = bundle.cuts;
  assert.ok(upper && lower);
  for (const cut of [upper, lower]) {
    cut.image = { clean: `episodes/ep-001/assets/clean/${cut.id}.png`, final: null };
  }
  upper.imageView = { x: 0, y: 0, width: 1, height: 0.5 };
  lower.imageView = { x: 0, y: 0.5, width: 1, height: 0.5 };
  if (gap !== null) {
    bundle.transitions = [
      {
        id: "tr-01",
        type: "gutter",
        gutterHeight: gap,
        text: null,
        sfx: null,
        agentNote: null,
        humanNote: null,
        image: null,
        reviewStatus: "draft",
      },
    ];
    bundle.episode.sequence = [
      { type: "cut", id: upper.id },
      { type: "transition", id: "tr-01" },
      { type: "cut", id: lower.id },
    ];
  }
  project.webtoon.referenceWidth = 200;
  await writeProject(root, project);
  const dir = join(root, "episodes/ep-001/assets/clean");
  await mkdir(dir, { recursive: true });
  for (const cut of bundle.cuts) await writeFile(join(dir, `${cut.id}.png`), landmarks());
  return root;
}

test("one picture split across two cuts reads as one picture, and a transition sits between", async () => {
  // Adjacent halves leave no seam: the page is the picture, pixel for pixel.
  const joined = await stitchEpisode(await splitProject(null), "ep-001", 200);
  assert.equal(joined.height, 600);
  const page = joined.canvas.getContext("2d").getImageData(0, 0, 200, 600).data;
  const original = await decodePixels(landmarks());
  assert.ok(Buffer.from(page).equals(Buffer.from(original.data)), "no seam between the halves");

  // Upper view, then the transition, then the lower view, in reading order.
  const split = await stitchEpisode(await splitProject(40), "ep-001", 200);
  assert.equal(split.height, 640);
  const at = (y: number) => {
    const [r, g, b] = split.canvas.getContext("2d").getImageData(100, y, 1, 1).data;
    return `#${[r, g, b].map((v) => (v ?? 0).toString(16).padStart(2, "0")).join("")}`;
  };
  assert.equal(at(10), BANDS[0]);
  assert.equal(at(290), BANDS[1], "the upper view ends inside the middle band");
  assert.ok(![...BANDS].includes(at(320) as (typeof BANDS)[number]), "the gap is not art");
  assert.equal(at(350), BANDS[1], "the lower view starts inside the middle band");
  assert.equal(at(630), BANDS[2]);
});
