// `toony lint` / `toony lint-episode` run the headless lints against a project.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { deflateSync } from "node:zlib";
import { GENRES, loadProject, writeCuts, writeTransitions } from "@toony/project-io";
import type { Cut } from "@toony/schema";
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

test("a transition whose fill contradicts its kind reports but does not block (#267)", async () => {
  const dir = await scaffold();
  const loaded = await loadProject(dir);
  const bundle = loaded.project.episodes[0];
  assert.ok(bundle);
  // A `void` filled with the page's own reading white: legal authoring, and an
  // exact render of what it asks for, so it is a note to whoever grades the pack
  // rather than a build failure. `toony lint` blocks on error AND warning, so
  // anything above `info` would fail this project's build.
  const contradicting = bundle.transitions.map((t, i) =>
    i === 0 ? { ...t, type: "void" as const, color: "#ffffff" } : t,
  );
  assert.ok(contradicting.length > 0, "the scaffold must author a transition to alter");
  await writeTransitions(dir, bundle.episode.id, bundle.episode, contradicting, bundle.cuts);

  const c = capture();
  assert.equal(await runLint([dir, "--json"], c.io), EXIT_OK, c.err.join("\n"));
  const report = JSON.parse(c.out.join("\n"));
  assert.equal(report.clean, true, "an info finding leaves the project clean");
  const found = report.findings.filter(
    (f: { code: string }) => f.code === "craft/transition-appearance",
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "info");
});

// Every SHIPPED genre scaffold draws the bucket it declares (#273). The check is
// advisory, so a scaffold that contradicts itself blocks nothing and ships: the
// romance `palette_shift` was authored at `#f3d9e0`, saturation 0.107, under the
// colour-field line, and drew page background for as long as it took a lint to
// notice. A project handed that scaffold starts out failing the thing the
// scaffold exists to teach.
//
// The test above is this one's negative control and the reason a pass here means
// anything: it injects a `void` filled `#ffffff` into a scaffold and gets exactly
// one finding, so the code path is reachable and an empty result below is the
// scaffolds being clean rather than the check being dead.
test("every genre scaffold draws the transition bucket it declares (#273)", async () => {
  for (const genre of GENRES) {
    const init = capture();
    assert.equal(
      await runInit([`demo-${genre}`, "--genre", genre], init.io),
      EXIT_OK,
      init.err.join("\n"),
    );

    const c = capture();
    assert.equal(
      await runLint([join(workdir, `demo-${genre}`), "--json"], c.io),
      EXIT_OK,
      c.err.join("\n"),
    );
    const report = JSON.parse(c.out.join("\n"));
    const found = (report.findings as { code: string; message: string }[]).filter(
      (f) => f.code === "craft/transition-appearance",
    );
    assert.deepEqual(found, [], `${genre} scaffold contradicts itself`);
  }
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

// --- The gutter strip the command lints against (#215) -----------------------

/** A gutter line that needs more column than the default strip gives it. */
const WIDE_GUTTER_LINE = {
  id: "g1",
  cutId: "cut-001",
  speaker: "Mina",
  kind: "speech",
  text: "This line needs more column than the default strip allows.",
  font: "sans-serif",
  fill: "#ffffff",
  opacity: 1,
  border: null,
  tail: null,
  placement: "gutter",
  placementSide: "right",
  geometry: { x: 0.04, y: 0.1, width: 0.92, height: 0.03 },
  overflow: false,
  reviewStatus: "human-edited",
};

/** Every finding code `toony lint --json` reported for `dir`. */
async function lintCodes(dir: string): Promise<string[]> {
  const c = capture();
  await runLint([dir, "--json"], c.io);
  const report = JSON.parse(c.out.join("\n"));
  return (report.findings as { code: string }[]).map((f) => f.code);
}

test("lint measures a gutter bubble against the strip the PROJECT declares (#215)", async () => {
  // `@toony/lint` takes the strip as an option; this is the command's half of
  // that — reading `webtoon.json` and handing it over. Asserted on the finding
  // codes rather than the exit code, because the same long line also trips the
  // craft wrap check at the wider strip, and that check is not what is under
  // test here.
  const dir = await scaffold();
  await writeFile(
    join(dir, "episodes", "ep-001", "lettering.json"),
    JSON.stringify([WIDE_GUTTER_LINE], null, 2),
  );

  // With no declared strip the line does not fit at any size, which is the
  // warning the ticket was opened about.
  assert.ok(
    (await lintCodes(dir)).includes("lettering/overflow"),
    "the fixture must overflow on the default strip",
  );

  // Declaring the strip its genre letters in clears it — and only because the
  // command passed the project's value down; on the default it still overflows.
  const webtoonPath = join(dir, "webtoon.json");
  const webtoon = JSON.parse(await readFile(webtoonPath, "utf8"));
  webtoon.gutterBandWidth = 0.5;
  await writeFile(webtoonPath, JSON.stringify(webtoon, null, 2));
  assert.ok(
    !(await lintCodes(dir)).includes("lettering/overflow"),
    "toony lint still measured the bubble against the default strip",
  );
});

// --- A declared panel shape, read back through the command (#260) -----------

/** A real PNG of `width`x`height`; only its header is read back. */
function png(width: number, height: number): Uint8Array {
  const u32 = (v: number): number[] => [
    (v >>> 24) & 0xff,
    (v >>> 16) & 0xff,
    (v >>> 8) & 0xff,
    v & 0xff,
  ];
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: number[]): number => {
    let c = 0xffffffff;
    for (const b of bytes) c = (crcTable[(c ^ b) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: number[]): number[] => {
    const body = [...[...type].map((ch) => ch.charCodeAt(0)), ...data];
    return [...u32(data.length), ...body, ...u32(crc(body))];
  };
  const stride = width * 3;
  const raw = Buffer.alloc(height * (stride + 1)); // filter 0 + black rows
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk("IHDR", [...u32(width), ...u32(height), 8, 2, 0, 0, 0]),
    ...chunk("IDAT", [...deflateSync(raw)]),
    ...chunk("IEND", []),
  ]);
}

/** Give `cut-001` real art of a known shape, and optionally a declared one. */
async function cutWithArt(
  dir: string,
  size: [number, number],
  panelAspect?: number,
): Promise<void> {
  const rel = "episodes/ep-001/assets/clean/cut-001.png";
  await mkdir(join(dir, "episodes/ep-001/assets/clean"), { recursive: true });
  await writeFile(join(dir, rel), png(size[0], size[1]));
  const loaded = await loadProject(dir);
  const cuts = (loaded.project.episodes[0] as { cuts: Cut[] }).cuts.map((c) =>
    c.id === "cut-001"
      ? {
          ...c,
          image: { clean: rel, final: null },
          ...(panelAspect === undefined ? {} : { panelAspect }),
        }
      : c,
  );
  await writeCuts(dir, "ep-001", cuts);
}

test("lint reports art that does not match the shape its cut declares (#260)", async () => {
  const dir = await scaffold();
  await cutWithArt(dir, [200, 280], 0.3);
  const codes = await lintCodes(dir);
  assert.ok(
    codes.includes("cut/panel-aspect-mismatch"),
    `expected a panel-shape finding, got: ${codes.join(", ")}`,
  );
});

test("the same art on a cut that declares nothing is not reported (#260)", async () => {
  // The back-compat half, on the SAME fixture: it is the declaration that makes
  // this a finding, not the art. A project written before the field existed
  // cannot acquire one.
  const dir = await scaffold();
  await cutWithArt(dir, [200, 280]);
  assert.ok(!(await lintCodes(dir)).includes("cut/panel-aspect-mismatch"));
});

test("art generated AT the declared shape is not reported (#260)", async () => {
  const dir = await scaffold();
  await cutWithArt(dir, [200, 280], 1.4);
  assert.ok(!(await lintCodes(dir)).includes("cut/panel-aspect-mismatch"));
});
