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
): ManifestFile {
  return { path, format, width: 100, height: 100, byteSize, quality, sha256: SHA };
}

function manifest(over: Partial<ExportManifest>): ExportManifest {
  return {
    manifestVersion: 1,
    target: "platform",
    projectId: "p",
    episodeId: "ep-001",
    width: 800,
    files: [file("episodes/ep-001/exports/platform/001.png", "png", null)],
    markdown: null,
    ...over,
  };
}

function codes(findings: { code: string }[]): string[] {
  return findings.map((f) => f.code);
}

test("a valid platform manifest has no findings", () => {
  assert.deepEqual(lintManifestCompleteness(manifest({}), "m"), []);
});

test("a structurally invalid manifest yields manifest/invalid errors only", () => {
  const findings = lintManifestCompleteness({ target: "platform" }, "m");
  assert.ok(findings.length > 0);
  assert.ok(findings.every((f) => f.code === "manifest/invalid" && f.severity === "error"));
});

test("plotlink with more than 20 images is an error", () => {
  const files = Array.from({ length: 21 }, (_, i) =>
    file(`episodes/ep-001/exports/plotlink/${String(i + 1).padStart(3, "0")}.webp`, "webp", 80),
  );
  const md = { path: "episodes/ep-001/exports/plotlink/episode.md", characters: 600, sha256: SHA };
  const findings = lintManifestCompleteness(
    manifest({ target: "plotlink", files, markdown: md }),
    "m",
  );
  assert.ok(codes(findings).includes("manifest/plotlink-too-many-images"));
});

test("plotlink rejects non-webp files and oversized files", () => {
  const md = { path: "episodes/ep-001/exports/plotlink/episode.md", characters: 600, sha256: SHA };
  const findings = lintManifestCompleteness(
    manifest({
      target: "plotlink",
      files: [
        file("episodes/ep-001/exports/plotlink/001.jpg", "jpeg", 80),
        file("episodes/ep-001/exports/plotlink/002.webp", "webp", 80, 2_000_000),
      ],
      markdown: md,
    }),
    "m",
  );
  assert.ok(codes(findings).includes("manifest/plotlink-format"));
  assert.ok(codes(findings).includes("manifest/plotlink-too-large"));
});

test("plotlink without markdown is an error", () => {
  const findings = lintManifestCompleteness(
    manifest({
      target: "plotlink",
      files: [file("episodes/ep-001/exports/plotlink/001.webp", "webp", 80)],
      markdown: null,
    }),
    "m",
  );
  assert.ok(codes(findings).includes("manifest/plotlink-markdown-missing"));
});

test("a disturbed reading order is a warning", () => {
  const findings = lintManifestCompleteness(
    manifest({
      files: [
        file("episodes/ep-001/exports/platform/002.png", "png", null),
        file("episodes/ep-001/exports/platform/001.png", "png", null),
      ],
    }),
    "m",
  );
  assert.ok(codes(findings).includes("manifest/reading-order"));
});

test("resolveFile flags missing files and size mismatches", () => {
  const m = manifest({
    files: [
      file("episodes/ep-001/exports/platform/001.png", "png", null, 1000),
      file("episodes/ep-001/exports/platform/002.png", "png", null, 1000),
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
