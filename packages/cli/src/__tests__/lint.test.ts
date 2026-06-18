// `toony lint` / `toony lint-episode` run the headless lints against a project.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { runExport } from "../commands/export.js";
import { runInit } from "../commands/init.js";
import { runLint, runLintEpisode } from "../commands/lint.js";
import { EXIT_OK, EXIT_USAGE, EXIT_VALIDATION } from "../exit.js";

let workdir: string;

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { cwd: workdir, out: (l: string) => out.push(l), err: (l: string) => err.push(l) },
    out,
    err,
  };
}

async function scaffold(): Promise<string> {
  assert.equal(await runInit(["demo"], capture().io), EXIT_OK);
  return join(workdir, "demo");
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), "toony-cli-"));
});

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

test("lint on a fresh project is clean", async () => {
  const dir = await scaffold();
  const c = capture();
  const code = await runLint([dir], c.io);
  assert.equal(code, EXIT_OK, c.err.join("\n"));
  assert.match(c.out.join("\n"), /clean:/);
});

test("lint --json reports a clean project", async () => {
  const dir = await scaffold();
  const c = capture();
  assert.equal(await runLint([dir, "--json"], c.io), EXIT_OK);
  const report = JSON.parse(c.out.join("\n"));
  assert.equal(report.clean, true);
  assert.equal(report.findingCount, 0);
  assert.equal(report.episodeId, null);
});

test("lint flags an export manifest whose declared file is missing", async () => {
  const dir = await scaffold();
  assert.equal(await runExport(["platform", dir, "--episode", "ep-001"], capture().io), EXIT_OK);

  const manifestPath = join(dir, "episodes/ep-001/exports/platform/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await unlink(join(dir, manifest.files[0].path));

  const c = capture();
  const code = await runLint([dir], c.io);
  assert.equal(code, EXIT_VALIDATION);
  assert.match(c.out.join("\n"), /manifest\/missing-file/);
});

test("lint flags an unparseable manifest", async () => {
  const dir = await scaffold();
  assert.equal(await runExport(["platform", dir, "--episode", "ep-001"], capture().io), EXIT_OK);
  await writeFile(join(dir, "episodes/ep-001/exports/platform/manifest.json"), "{ not json");

  const c = capture();
  assert.equal(await runLint([dir], c.io), EXIT_VALIDATION);
  assert.match(c.out.join("\n"), /manifest\/invalid/);
});

test("lint-episode scopes to one episode", async () => {
  const dir = await scaffold();
  const c = capture();
  assert.equal(await runLintEpisode(["ep-001", dir], c.io), EXIT_OK, c.err.join("\n"));
  assert.match(c.out.join("\n"), /episode ep-001/);
});

test("lint-episode without an id is a usage error", async () => {
  const c = capture();
  assert.equal(await runLintEpisode([], c.io), EXIT_USAGE);
  assert.match(c.err.join("\n"), /episode-id/);
});

test("lint-episode with an unknown id is a usage error", async () => {
  const dir = await scaffold();
  const c = capture();
  assert.equal(await runLintEpisode(["ep-999", dir], c.io), EXIT_USAGE);
  assert.match(c.err.join("\n"), /episode not found/);
});

test("an unknown option is a usage error", async () => {
  const dir = await scaffold();
  const c = capture();
  assert.equal(await runLint([dir, "--bogus"], c.io), EXIT_USAGE);
  assert.match(c.err.join("\n"), /unknown option/);
});

test("lint surfaces a craft finding (bubble density) via toony lint (#94)", async () => {
  const dir = await scaffold();
  // Three speech bubbles on one cut trips craft/bubble-density (max 2). Each is
  // schema-valid (speaker set, short text) so only the craft lint fires.
  const speech = (id: string) => ({
    id,
    cutId: "cut-001",
    speaker: "Mina",
    kind: "speech",
    text: "Hi.",
    font: "sans-serif",
    fill: "#ffffff",
    opacity: 1,
    border: null,
    tail: null,
    geometry: { x: 0.1, y: 0.1, width: 0.3, height: 0.15 },
    overflow: false,
    reviewStatus: "draft",
  });
  await writeFile(
    join(dir, "episodes/ep-001/lettering.json"),
    JSON.stringify([speech("o1"), speech("o2"), speech("o3")]),
  );
  const c = capture();
  const code = await runLint([dir, "--json"], c.io);
  const report = JSON.parse(c.out.join("\n"));
  assert.equal(code, EXIT_VALIDATION);
  assert.ok(
    report.findings.some((f: { code: string }) => f.code === "craft/bubble-density"),
    JSON.stringify(report.findings),
  );
});

test("lint surfaces craft/rhythm-monotony via toony lint (#100)", async () => {
  const dir = await scaffold();
  // Four cuts that all share shotType "medium", with only the scaffold's plain
  // gutter transition between them — a gutter does NOT break the run, so the run
  // reaches the threshold and trips craft/rhythm-monotony. cuts.yaml + episode.yaml
  // are written as JSON (valid YAML) so the loader parses them.
  const cuts = [1, 2, 3, 4].map((n) => ({
    id: `cut-00${n}`,
    image: null,
    imagePrompt: "",
    negativePrompt: "",
    shotType: "medium",
  }));
  await writeFile(join(dir, "episodes/ep-001/cuts.yaml"), JSON.stringify(cuts));
  await writeFile(
    join(dir, "episodes/ep-001/episode.yaml"),
    JSON.stringify({
      schemaVersion: 1,
      id: "ep-001",
      title: "Episode 1",
      sequence: [
        { type: "cut", id: "cut-001" },
        { type: "transition", id: "tr-001" },
        { type: "cut", id: "cut-002" },
        { type: "cut", id: "cut-003" },
        { type: "cut", id: "cut-004" },
      ],
    }),
  );
  const c = capture();
  const code = await runLint([dir, "--json"], c.io);
  const report = JSON.parse(c.out.join("\n"));
  assert.equal(code, EXIT_VALIDATION, c.err.join("\n"));
  assert.ok(
    report.findings.some((f: { code: string }) => f.code === "craft/rhythm-monotony"),
    JSON.stringify(report.findings),
  );
});
