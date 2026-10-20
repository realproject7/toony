import assert from "node:assert/strict";
import { test } from "node:test";

import { createCanvas } from "@napi-rs/canvas";
import { encodeCanvas } from "../encode.js";
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

/** A well-formed v2 manifest of one strip image; tests change one thing at a time. */
function manifest(file: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    manifestVersion: 2,
    kind: "strip",
    output: "strip",
    projectId: "p",
    episodeId: "ep-001",
    width: 800,
    options: { format: "png" },
    files: [
      {
        path: "episodes/ep-001/exports/strip/episode.png",
        format: "png",
        width: 800,
        height: 2400,
        byteSize: 1234,
        quality: null,
        sha256: "a".repeat(64),
        role: "strip",
        items: [{ type: "cut", id: "cut-001", index: 0 }],
        ...file,
      },
    ],
    warnings: [],
    inputs: { sha256: "b".repeat(64) },
    ...extra,
  };
}

test("validateManifest accepts a well-formed manifest", () => {
  assert.deepEqual(validateManifest(manifest()), []);
});

test("validateManifest rejects an absolute path", () => {
  const problems = validateManifest(manifest({ path: "/etc/evil.png", sha256: "x" }));
  assert.ok(problems.some((p) => p.includes("project-relative")));
});

test("validateManifest rejects lossy quality outside 0..100", () => {
  const problems = validateManifest(manifest({ format: "jpeg", quality: 999 }));
  assert.ok(problems.some((p) => p.includes("quality")));
});

test("validateManifest requires null quality for png", () => {
  const problems = validateManifest(manifest({ quality: 80 }));
  assert.ok(problems.some((p) => p.includes("quality must be null")));
});

test("validateManifest accepts only the current version, kinds and roles", () => {
  for (const [extra, expected] of [
    [{ manifestVersion: 1 }, "manifestVersion mismatch"],
    [{ kind: "gif" }, "kind must be one of: strip, cuts, social"],
    [{ output: "../escape" }, "output must be a path-safe id"],
    [{ inputs: { sha256: "short" } }, "inputs.sha256 must be a 64-char hex digest"],
    [{ warnings: [{ code: "x" }] }, "warnings[0] must have a code, a message and items"],
  ] as const) {
    assert.ok(validateManifest(manifest({}, extra)).includes(expected), expected);
  }
  assert.ok(
    validateManifest(manifest({ role: "markdown" })).some((p) => p.includes("role must be one of")),
  );
  assert.ok(
    validateManifest(manifest({ items: [{ type: "cut", id: "", index: -1 }] })).some((p) =>
      p.includes("items[0].index"),
    ),
  );
});
