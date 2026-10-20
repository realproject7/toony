import assert from "node:assert/strict";
import { test } from "node:test";

import type { ExportManifest, ManifestFile, RasterFormat } from "@toony/export";
import { lintManifestCompleteness, type ResolveManifestFile } from "../manifest-lint.js";

const SHA = "a".repeat(64);

function file(
  path: string,
  format: RasterFormat,
  quality: number | null,
  byteSize = 1000,
  over: Partial<ManifestFile> = {},
): ManifestFile {
  return {
    path,
    format,
    width: 800,
    height: 100,
    byteSize,
    quality,
    sha256: SHA,
    role: "cut",
    items: [{ type: "cut", id: "cut-001", index: 0 }],
    ...over,
  };
}

function manifest(over: Partial<ExportManifest>, options: Partial<ExportManifest["options"]> = {}) {
  const base: ExportManifest = {
    manifestVersion: 2,
    kind: "cuts",
    output: "cuts",
    projectId: "p",
    episodeId: "ep-001",
    width: 800,
    options: {
      format: "png",
      quality: null,
      contentWidth: 800,
      sliceHeight: null,
      maxBytes: null,
      margin: 0,
      textCards: false,
      frame: null,
      tallCuts: null,
      imagesPerPost: null,
      background: "#ffffff",
      ...options,
    },
    files: [file("episodes/ep-001/exports/cuts/001.png", "png", null)],
    warnings: [],
    inputs: { sha256: SHA },
  };
  return { ...base, ...over };
}

function codes(findings: { code: string }[]): string[] {
  return findings.map((f) => f.code);
}

test("a valid cut images manifest has no findings", () => {
  assert.deepEqual(lintManifestCompleteness(manifest({}), "m"), []);
});

test("a structurally invalid manifest yields manifest/invalid errors only", () => {
  for (const value of [{ kind: "cuts" }, manifest({ manifestVersion: 1 })]) {
    const findings = lintManifestCompleteness(value, "m");
    assert.ok(findings.length > 0);
    assert.ok(findings.every((f) => f.code === "manifest/invalid" && f.severity === "error"));
  }
});

test("a disturbed reading order is a warning", () => {
  const findings = lintManifestCompleteness(
    manifest({
      files: [
        file("episodes/ep-001/exports/cuts/002.png", "png", null),
        file("episodes/ep-001/exports/cuts/001.png", "png", null),
      ],
    }),
    "m",
  );
  assert.ok(codes(findings).includes("manifest/reading-order"));
});

test("resolveFile flags missing files and size mismatches", () => {
  const m = manifest({
    files: [
      file("episodes/ep-001/exports/cuts/001.png", "png", null, 1000),
      file("episodes/ep-001/exports/cuts/002.png", "png", null, 1000),
    ],
  });
  const resolve: ResolveManifestFile = (path) => {
    if (path.endsWith("001.png")) return { exists: true, byteSize: 999 };
    return { exists: false, byteSize: 0 };
  };
  const findings = lintManifestCompleteness(m, "m", resolve);
  assert.ok(codes(findings).includes("manifest/size-mismatch"));
  assert.ok(codes(findings).includes("manifest/missing-file"));
});

test("strip parts must keep the width, the part height, the size cap and their rows", () => {
  const dir = "episodes/ep-001/exports/strip";
  const m = manifest(
    {
      kind: "strip",
      output: "strip",
      files: [
        file(`${dir}/001.png`, "png", null, 1000, {
          role: "slice",
          height: 1280,
          items: [{ type: "cut", id: "cut-001", index: 0, top: 0, height: 1280 }],
        }),
        file(`${dir}/002.png`, "png", null, 5000, {
          role: "slice",
          width: 640,
          height: 1300,
          items: [{ type: "cut", id: "cut-001", index: 0, top: 1300, height: 1300 }],
        }),
      ],
    },
    { sliceHeight: 1280, maxBytes: 2000 },
  );
  assert.deepEqual(codes(lintManifestCompleteness(m, "m")).sort(), [
    "manifest/over-size-cap",
    "manifest/part-too-tall",
    "manifest/row-gap",
    "manifest/width-mismatch",
  ]);
});

test("social frames must have the frame size and consecutive posts", () => {
  const dir = "episodes/ep-001/exports/x";
  const frame = {
    id: "x-landscape",
    width: 1600,
    height: 900,
    safe: { top: 45, right: 80, bottom: 45, left: 80 },
  };
  const frameFile = (name: string, post: number, over: Partial<ManifestFile> = {}) =>
    file(`${dir}/${name}`, "png", null, 1000, {
      role: "frame",
      width: 1600,
      height: 900,
      post,
      ...over,
    });
  const ok = manifest(
    {
      kind: "social",
      output: "x",
      width: 1600,
      files: [frameFile("001.png", 1), frameFile("002.png", 1)],
    },
    { frame, imagesPerPost: 4 },
  );
  assert.deepEqual(lintManifestCompleteness(ok, "m"), []);
  const bad = manifest(
    {
      kind: "social",
      output: "x",
      width: 1600,
      files: [frameFile("001.png", 1, { height: 899 }), frameFile("002.png", 3)],
    },
    { frame, imagesPerPost: 4 },
  );
  assert.deepEqual(codes(lintManifestCompleteness(bad, "m")).sort(), [
    "manifest/frame-size",
    "manifest/post-order",
  ]);
});

test("a band split across three parts with contiguous rows is clean", () => {
  const dir = "episodes/ep-001/exports/webtoon";
  const part = (name: string, items: ManifestFile["items"], height: number) =>
    file(`${dir}/${name}`, "jpeg", 90, 1000, { role: "slice", height, items });
  const m = manifest(
    {
      kind: "strip",
      output: "webtoon",
      files: [
        part(
          "001.jpg",
          [
            { type: "cut", id: "cut-001", index: 0 },
            { type: "cut", id: "cut-002", index: 2, top: 0, height: 280 },
          ],
          1280,
        ),
        part("002.jpg", [{ type: "cut", id: "cut-002", index: 2, top: 280, height: 1280 }], 1280),
        part(
          "003.jpg",
          [
            { type: "cut", id: "cut-002", index: 2, top: 1560, height: 40 },
            { type: "transition", id: "tr-001", index: 3 },
          ],
          100,
        ),
      ],
    },
    { format: "jpeg", quality: 90, sliceHeight: 1280 },
  );
  assert.deepEqual(lintManifestCompleteness(m, "m"), []);
});
