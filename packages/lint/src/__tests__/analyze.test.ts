import assert from "node:assert/strict";
import { test } from "node:test";

import { encodePng, makeGradientRaster, makeSolidRaster } from "../__fixtures__/images.js";
import { analyzeImageBuffer, analyzeRaster, estimateCompressibleBytes } from "../image/analyze.js";
import type { Raster } from "../image/raster.js";

function codes(findings: { code: string }[]): string[] {
  return findings.map((f) => f.code);
}

test("a full-range gradient raises no warnings", () => {
  const findings = analyzeRaster(makeGradientRaster(32, 16, 3, 0, 255), "cut-001");
  assert.deepEqual(findings, []);
});

test("a uniform raster is flagged as blank", () => {
  const findings = analyzeRaster(makeSolidRaster(8, 8, 3, 128), "cut-001");
  assert.ok(codes(findings).includes("image/blank"));
});

test("a corrupt raster (wrong data length) is an error", () => {
  const bad: Raster = { width: 4, height: 4, channels: 3, data: new Uint8Array(10) };
  const findings = analyzeRaster(bad, "cut-001");
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.code, "image/corrupt-raster");
  assert.equal(findings[0]?.severity, "error");
});

test("a dark, non-blank image is flagged dark", () => {
  const findings = analyzeRaster(makeGradientRaster(40, 8, 3, 0, 24), "cut-001");
  assert.ok(codes(findings).includes("image/dark"));
  assert.ok(!codes(findings).includes("image/blank"));
});

test("a narrow-range image is flagged low-contrast", () => {
  const findings = analyzeRaster(makeGradientRaster(40, 8, 3, 120, 128), "cut-001");
  assert.ok(codes(findings).includes("image/low-contrast"));
  assert.ok(!codes(findings).includes("image/dark"));
});

test("dimension and aspect thresholds are honored", () => {
  const tall = makeGradientRaster(4, 200, 3, 0, 255);
  const findings = analyzeRaster(tall, "cut-001", { minWidth: 16, maxAspectRatio: 10 });
  assert.ok(codes(findings).includes("image/too-small"));
  assert.ok(codes(findings).includes("image/aspect-extreme"));
});

test("compression estimate is within budget for a small image", () => {
  const findings = analyzeRaster(makeGradientRaster(16, 16, 3, 0, 255), "cut-001", {
    compression: { targetBytes: 1_000_000 },
  });
  assert.ok(codes(findings).includes("image/compression-ok"));
});

test("compression estimate exceeds a tiny budget", () => {
  const findings = analyzeRaster(makeGradientRaster(64, 64, 3, 0, 255), "cut-001", {
    compression: { targetBytes: 8 },
  });
  assert.ok(codes(findings).includes("image/compression-uncertain"));
});

test("the compression estimate is deterministic", () => {
  const raster = makeGradientRaster(48, 48, 4, 0, 255);
  assert.equal(estimateCompressibleBytes(raster, 24), estimateCompressibleBytes(raster, 24));
});

test("analyzeImageBuffer decodes a PNG and analyzes pixels", () => {
  const png = encodePng(makeSolidRaster(8, 8, 4, 200));
  const findings = analyzeImageBuffer(png, "cut-001");
  assert.ok(codes(findings).includes("image/blank"));
});

test("analyzeImageBuffer reports an unreadable buffer as an error", () => {
  const findings = analyzeImageBuffer(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]), "cut-001");
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "error");
  assert.equal(findings[0]?.code, "image/undecodable");
});

test("a PNG-signature-like but corrupt buffer is reported undecodable", () => {
  const fake = new Uint8Array(24);
  fake[0] = 0x89;
  fake[1] = 0x50;
  const findings = analyzeImageBuffer(fake, "cut-001");
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.code, "image/undecodable");
  assert.equal(findings[0]?.severity, "error");
});

test("analyzeImageBuffer skips pixels for a non-PNG recognized format", () => {
  const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 40, 0, 60, 0, 0, 0]);
  const findings = analyzeImageBuffer(gif, "cut-001");
  assert.ok(codes(findings).includes("image/pixel-analysis-skipped"));
});

test("the header-only path also flags extreme aspect", () => {
  // GIF 4x200 → aspect 50, beyond the default max of 20.
  const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 4, 0, 200, 0, 0, 0]);
  const findings = analyzeImageBuffer(gif, "cut-001");
  assert.ok(codes(findings).includes("image/aspect-extreme"));
});
