// A character's reference sheet through `toony generate` (#327). With a pack
// workflow that declares a reference input, the first sheet of the first
// character a cut names is uploaded and named in the graph, and the ingest log
// records its digest. With a workflow that declares none, the request is byte
// for byte what it was before references existed, and the run says so once.
// A sheet that cannot be read refuses the run before any request. The lint
// names an unreadable sheet, and validate --json counts the registry.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { loadProject, writeCuts, writeWebtoon } from "@toony/project-io";
import { pngWithText, startFakeComfy } from "../__fixtures__/comfyui-server.js";
import { runGenerate } from "../commands/generate.js";
import { runInit } from "../commands/init.js";
import { runLint } from "../commands/lint.js";
import { runValidate } from "../commands/validate.js";
import { EXIT_OK, EXIT_USAGE, EXIT_VALIDATION } from "../exit.js";

let workdir: string;

function capture(env?: Record<string, string | undefined>) {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { cwd: workdir, out: (l: string) => out.push(l), err: (l: string) => err.push(l), env },
    out,
    err,
  };
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), "toony-ref-"));
});
afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

const SHEET = pngWithText();

/** A project whose first cut names Mira, who has a reference sheet on disk. */
async function scaffold(name = "demo", withSheet = true): Promise<string> {
  assert.equal(await runInit([name], capture().io), EXIT_OK);
  const dir = join(workdir, name);
  const loaded = await loadProject(dir);
  await writeWebtoon(dir, {
    ...loaded.project.webtoon,
    characters: [
      {
        id: "mira",
        name: "Mira",
        lockstring: "teal coat",
        ...(withSheet ? { references: ["characters/mira/sheet.png"] } : {}),
      },
      { id: "sol", name: "Sol", lockstring: "grey scarf" },
    ],
  });
  if (withSheet) {
    await mkdir(join(dir, "characters", "mira"), { recursive: true });
    await writeFile(join(dir, "characters", "mira", "sheet.png"), SHEET);
  }
  const bundle = loaded.project.episodes[0];
  assert.ok(bundle);
  await writeCuts(
    dir,
    bundle.episode.id,
    bundle.cuts.map((cut, i) =>
      i === 0
        ? { ...cut, imagePrompt: "a pier at dawn", characters: ["sol", "mira"] }
        : { ...cut, imagePrompt: "a ledger" },
    ),
  );
  return dir;
}

/** Install a pack with one workflow that declares a reference input at node 10. */
async function installReferencePack(dir: string): Promise<void> {
  const defaults = JSON.parse(
    await readFile(
      new URL("../../../providers/src/assets/default-txt2img.workflow.json", import.meta.url),
      "utf8",
    ),
  ) as Record<string, unknown>;
  const graph = {
    ...defaults,
    "10": { class_type: "LoadImage", inputs: { image: "placeholder.png", upload: "image" } },
  };
  const pack = join(dir, ".toony", "packs", "refpack");
  await mkdir(join(pack, "workflows"), { recursive: true });
  await writeFile(join(pack, "workflows", "ref.workflow.json"), JSON.stringify(graph));
  await writeFile(join(pack, "workflows", "plain.workflow.json"), JSON.stringify(defaults));
  await writeFile(
    join(pack, "toony-pack.json"),
    JSON.stringify({
      packFormat: 1,
      id: "refpack",
      name: "Reference pack",
      workflows: [
        {
          name: "ref",
          file: "workflows/ref.workflow.json",
          reference: { node: "10", input: "image" },
        },
        { name: "plain", file: "workflows/plain.workflow.json" },
      ],
    }),
  );
}

function normalizeClientId(body: string): string {
  return body.replace(/"client_id":"[^"]+"/, '"client_id":"x"');
}

test("a workflow with a reference input receives the sheet, and the log records its digest", async () => {
  const dir = await scaffold();
  await installReferencePack(dir);
  const comfy = await startFakeComfy(pngWithText());
  try {
    const c = capture({ TOONY_COMFYUI_URL: comfy.url });
    const code = await runGenerate(
      [
        dir,
        "--episode",
        "ep-001",
        "--cut",
        "cut-001",
        "--workflow",
        "ref",
        "--seed",
        "9",
        "--allow-remote",
      ],
      c.io,
    );
    assert.equal(code, EXIT_OK, c.err.join("\n"));
    assert.equal(comfy.uploads().length, 1, "one sheet uploaded");
    assert.ok(
      comfy.uploads()[0]?.includes(Buffer.from(SHEET)),
      "the uploaded body carries the sheet bytes",
    );
    assert.deepEqual(comfy.references(), ["ref-1.png"], "the graph names the uploaded file");
    assert.doesNotMatch(c.err.join("\n"), /declares no reference input/);

    const log = JSON.parse(
      await readFile(join(dir, "episodes", "ep-001", "logs", "ingest.json"), "utf8"),
    ) as Array<{ renderInputs?: { reference?: { characterId: string; sha256: string } } }>;
    assert.deepEqual(log[0]?.renderInputs?.reference, {
      characterId: "mira",
      sha256: createHash("sha256").update(SHEET).digest("hex"),
    });
    // The cut record is unchanged in shape: the sheet is in the log, not on the cut.
    const cut = (await loadProject(dir)).project.episodes[0]?.cuts[0];
    assert.equal(cut?.imageSeed, 9);
    assert.equal(Object.hasOwn(cut ?? {}, "reference"), false);
  } finally {
    comfy.close();
  }
});

test("a workflow without a reference input sends the same bytes it always did, and the run says so once", async () => {
  const withSheet = await scaffold("with", true);
  const without = await scaffold("without", false);
  await installReferencePack(withSheet);
  await installReferencePack(without);
  const comfy = await startFakeComfy(pngWithText());
  try {
    const env = { TOONY_COMFYUI_URL: comfy.url };
    const a = capture(env);
    assert.equal(
      await runGenerate(
        [
          withSheet,
          "--episode",
          "ep-001",
          "--cut",
          "cut-001",
          "--cut",
          "cut-002",
          "--workflow",
          "plain",
          "--seed",
          "9",
          "--allow-remote",
        ],
        a.io,
      ),
      EXIT_OK,
      a.err.join("\n"),
    );
    const notes = a.err.filter((l) => l.includes("declares no reference input"));
    assert.equal(notes.length, 1, a.err.join("\n"));
    assert.match(notes[0] ?? "", /1 cut\(s\).*\(cut-001\).*workflow "plain"/);
    assert.equal(
      await runGenerate(
        [
          without,
          "--episode",
          "ep-001",
          "--cut",
          "cut-001",
          "--cut",
          "cut-002",
          "--workflow",
          "plain",
          "--seed",
          "9",
          "--allow-remote",
        ],
        capture(env).io,
      ),
      EXIT_OK,
    );
    assert.equal(comfy.uploads().length, 0);
    const bodies = comfy.bodies().map(normalizeClientId);
    assert.equal(
      bodies[0],
      bodies[2],
      "cut-001 request is byte-identical with and without a sheet",
    );
    assert.equal(bodies[1], bodies[3]);
    const log = JSON.parse(
      await readFile(join(withSheet, "episodes", "ep-001", "logs", "ingest.json"), "utf8"),
    ) as Array<{ renderInputs?: Record<string, unknown> }>;
    assert.equal(Object.hasOwn(log[0]?.renderInputs ?? {}, "reference"), false);
  } finally {
    comfy.close();
  }
});

test("a sheet that cannot be read refuses the run before any request", async () => {
  const dir = await scaffold();
  await installReferencePack(dir);
  await rm(join(dir, "characters", "mira", "sheet.png"));
  const comfy = await startFakeComfy(pngWithText());
  try {
    const c = capture({ TOONY_COMFYUI_URL: comfy.url });
    const code = await runGenerate(
      [dir, "--episode", "ep-001", "--cut", "cut-001", "--workflow", "ref", "--allow-remote"],
      c.io,
    );
    assert.equal(code, EXIT_USAGE);
    assert.match(c.err.join("\n"), /reference "characters\/mira\/sheet.png" could not be read/);
    assert.equal(comfy.calls(), 0);
    assert.equal(comfy.uploads().length, 0);
  } finally {
    comfy.close();
  }
});

test("a sheet that is a symlink out of the project is refused before any byte is read", async () => {
  const dir = await scaffold();
  await installReferencePack(dir);
  const outside = join(workdir, "outside.png");
  await writeFile(outside, SHEET);
  await rm(join(dir, "characters", "mira", "sheet.png"));
  await symlink(outside, join(dir, "characters", "mira", "sheet.png"));
  const comfy = await startFakeComfy(pngWithText());
  try {
    const c = capture({ TOONY_COMFYUI_URL: comfy.url });
    const code = await runGenerate(
      [dir, "--episode", "ep-001", "--cut", "cut-001", "--workflow", "ref", "--allow-remote"],
      c.io,
    );
    assert.equal(code, EXIT_USAGE);
    assert.match(c.err.join("\n"), /resolves outside the project and is not sent/);
    assert.doesNotMatch(
      c.err.join("\n"),
      /outside\.png/,
      "the message names no path outside the project",
    );
    assert.equal(comfy.calls(), 0);
    assert.equal(comfy.uploads().length, 0);
  } finally {
    comfy.close();
  }
});

test("lint names an unreadable sheet, and validate --json counts the registry", async () => {
  const dir = await scaffold();
  const clean = capture();
  assert.equal(await runLint([dir, "--json"], clean.io), EXIT_OK, clean.out.join("\n"));
  await writeFile(join(dir, "characters", "mira", "sheet.png"), "not an image");
  const c = capture();
  assert.equal(await runLint([dir, "--json"], c.io), EXIT_VALIDATION);
  const report = JSON.parse(c.out.join("\n")) as {
    findings: Array<{ code: string; targetId: string }>;
  };
  const finding = report.findings.find((f) => f.code === "character/reference-unreadable");
  assert.ok(finding, JSON.stringify(report.findings));
  assert.equal(finding.targetId, "mira");

  const v = capture();
  assert.equal(await runValidate([dir, "--json"], v.io), EXIT_OK);
  assert.deepEqual(JSON.parse(v.out.join("\n")).characters, { total: 2, withReferences: 1 });
});
