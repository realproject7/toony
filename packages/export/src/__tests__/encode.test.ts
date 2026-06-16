import assert from "node:assert/strict";
import { test } from "node:test";

import { createCanvas } from "@napi-rs/canvas";
import { encodeCanvas, encodeWebpToFit } from "../encode.js";
import { validateManifest } from "../manifest.js";

function solid(width: number, height: number, color: string) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  return canvas;
}

test("encodeCanvas emits valid PNG, JPEG, and WebP", () => {
  const canvas = solid(32, 32, "#3a7");
  const png = encodeCanvas(canvas, "png");
  assert.ok(png[0] === 0x89 && png[1] === 0x50);
  const jpeg = encodeCanvas(canvas, "jpeg", 80);
  assert.ok(jpeg[0] === 0xff && jpeg[1] === 0xd8);
  const webp = encodeCanvas(canvas, "webp", 80);
  const tag = (i: number) => String.fromCharCode(webp[i] ?? 0);
  assert.equal(tag(0) + tag(1) + tag(2) + tag(3), "RIFF");
});

test("encodeWebpToFit meets a tight byte budget by downscaling", () => {
  const canvas = solid(800, 1200, "#246");
  const fit = encodeWebpToFit(canvas, 2000);
  assert.equal(fit.withinBudget, true);
  assert.ok(fit.bytes.length <= 2000);
  assert.ok(fit.width <= 800);
});

test("validateManifest rejects an absolute path", () => {
  const problems = validateManifest({
    manifestVersion: 1,
    target: "platform",
    projectId: "p",
    episodeId: "ep-001",
    width: 800,
    files: [
      {
        path: "/etc/evil.png",
        format: "png",
        width: 1,
        height: 1,
        byteSize: 1,
        quality: null,
        sha256: "x",
      },
    ],
    markdown: null,
  });
  assert.ok(problems.some((p) => p.includes("project-relative")));
});

test("validateManifest rejects lossy quality outside 0..100", () => {
  const problems = validateManifest({
    manifestVersion: 1,
    target: "platform",
    projectId: "p",
    episodeId: "ep-001",
    width: 800,
    files: [
      {
        path: "episodes/ep-001/exports/platform/001.jpg",
        format: "jpeg",
        width: 1,
        height: 1,
        byteSize: 1,
        quality: 999,
        sha256: "a".repeat(64),
      },
    ],
    markdown: null,
  });
  assert.ok(problems.some((p) => p.includes("quality")));
});

test("validateManifest requires null quality for png", () => {
  const problems = validateManifest({
    manifestVersion: 1,
    target: "platform",
    projectId: "p",
    episodeId: "ep-001",
    width: 800,
    files: [
      {
        path: "episodes/ep-001/exports/platform/001.png",
        format: "png",
        width: 1,
        height: 1,
        byteSize: 1,
        quality: 80,
        sha256: "a".repeat(64),
      },
    ],
    markdown: null,
  });
  assert.ok(problems.some((p) => p.includes("quality must be null")));
});

test("validateManifest accepts a well-formed manifest", () => {
  const problems = validateManifest({
    manifestVersion: 1,
    target: "stitched",
    projectId: "p",
    episodeId: "ep-001",
    width: 800,
    files: [
      {
        path: "episodes/ep-001/exports/stitched/episode.png",
        format: "png",
        width: 800,
        height: 2400,
        byteSize: 1234,
        quality: null,
        sha256: "a".repeat(64),
      },
    ],
    markdown: null,
  });
  assert.deepEqual(problems, []);
});
