import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadProject, writeCuts, writeWebtoon } from "@toony/project-io";
import type { ArtDirection, Cut } from "@toony/schema";
import { pngWithText, startFakeComfy } from "../__fixtures__/comfyui-server.js";
import { injectCharacterLockstrings, runGenerate } from "../commands/generate.js";
import { runInit } from "../commands/init.js";
import { EXIT_OK, EXIT_VALIDATION } from "../exit.js";
import { canvasFinding, promptFindings } from "../generation-preflight.js";

const cast = [
  { id: "a", name: "A", lockstring: "1girl, grey hair, green coat" },
  { id: "b", name: "B", lockstring: "1girl, dark hair, blue coat" },
];

test("multi-person composition separates identities without repeated global count tags", () => {
  const before = structuredClone(cast);
  const prompt = injectCharacterLockstrings("2girls, waiting by a gate", ["a", "b"], cast);
  assert.equal(
    prompt,
    "Character 1: grey hair, green coat. Character 2: dark hair, blue coat. Scene: 2girls, waiting by a gate",
  );
  assert.deepEqual(cast, before);
  assert.equal(
    injectCharacterLockstrings("waiting", ["a"], cast),
    "1girl, grey hair, green coat, waiting",
  );
});

test("preflight distinguishes a body-part insert from a portrait and refuses clear cast contradictions", () => {
  const cut = { id: "cut-001", characters: ["a", "b"] } as Cut;
  assert.equal(promptFindings(cut, "solo, in a hall", "scene")[0]?.code, "subject-count-conflict");
  assert.equal(
    promptFindings(cut, "no humans, an empty hall", "scene")[0]?.code,
    "empty-scene-cast",
  );
  const detail = "close-up, gloved hands on a desk";
  assert.equal(promptFindings(cut, detail, "scene")[0]?.code, "detail-character-context");
  assert.deepEqual(promptFindings(cut, detail, "detail"), []);
  assert.deepEqual(promptFindings(cut, "close-up, a woman smiles", "scene"), []);
});

test("automatic canvas reduction is blocked; an explicit size is disclosed without a quality claim", () => {
  const baseline = { width: 832, height: 1216 };
  for (const height of [248, 416, 480]) {
    assert.equal(
      canvasFinding("fixture", { width: 832, height }, baseline, false)?.severity,
      "error",
    );
  }
  assert.equal(
    canvasFinding("fixture", { width: 832, height: 416 }, baseline, true)?.severity,
    "warning",
  );
  assert.equal(canvasFinding("fixture", baseline, baseline, false), undefined);
});

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp(join(tmpdir(), "toony-preflight-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const out: string[] = [],
    err: string[] = [];
  const server = await startFakeComfy(pngWithText());
  t.after(async () => server.close());
  const io = {
    cwd: dir,
    out: (line: string) => out.push(line),
    err: (line: string) => err.push(line),
    env: { TOONY_COMFYUI_URL: server.url },
  };
  assert.equal(await runInit(["fixture"], io), EXIT_OK);
  const root = join(dir, "fixture");
  const loaded = await loadProject(root);
  const bundle = loaded.project.episodes[0];
  assert.ok(bundle);
  await writeWebtoon(root, { ...loaded.project.webtoon, characters: cast });
  out.length = 0;
  err.length = 0;
  return { root, bundle, io, out, err, server };
}

test("authored composition reaches dry-run, submitted prompts and durable provenance", async (t) => {
  const f = await fixture(t);
  const artDirection: ArtDirection = {
    version: 1,
    purpose: "Establish the empty location",
    framing: "establishing",
    camera: "High view across water",
    subjects: [],
    environment: {
      setting: "Harbor",
      depth: "Near railing, water, distant sheds",
      lighting: "Soft dusk",
    },
    style: { linework: "Sparse contours", color: "Blue and warm window", shading: "Large masses" },
    focalPoints: ["Lit window"],
    lettering: { mode: "none" },
  };
  await writeCuts(
    f.root,
    "ep-001",
    f.bundle.cuts.map((cut) => ({ ...cut, imagePrompt: "An empty harbor", artDirection })),
  );
  const args = [f.root, "--episode", "ep-001", "--cut", "cut-001"];
  assert.equal(
    await runGenerate([...args, "--dry-run", "--json"], f.io),
    EXIT_OK,
    f.err.join("\n"),
  );
  const report = JSON.parse(f.out.join("\n"));
  assert.equal(f.server.calls(), 0);
  assert.equal(report.targets[0].capabilities.subjectPositions, "prompt-only");
  assert.match(report.targets[0].inputs.workflowDigest, /^[a-f0-9]{64}$/);
  assert.equal(await runGenerate(args, f.io), EXIT_OK, f.err.join("\n"));
  assert.equal(f.server.prompts()[0], report.targets[0].inputs.prompt);
  assert.match(f.server.prompts()[0] ?? "", /Visible character count: 0/);
  const entries = JSON.parse(
    await readFile(join(f.root, "episodes/ep-001/logs/ingest.json"), "utf8"),
  );
  assert.deepEqual(entries[0].renderInputs.artDirection, artDirection);
  assert.equal(entries[0].renderInputs.workflowDigest, report.targets[0].inputs.workflowDigest);
  assert.match(entries[0].submittedGraphDigest, /^[a-f0-9]{64}$/);
});

test("dry-run reports actual composed inputs and dimensions with no submission, upload or project write", async (t) => {
  const f = await fixture(t);
  await writeCuts(
    f.root,
    "ep-001",
    f.bundle.cuts.map((cut) => ({
      ...cut,
      imagePrompt: "2girls, waiting",
      characters: ["a", "b"],
      panelAspect: 0.5,
    })),
  );
  const path = join(f.root, "episodes/ep-001/cuts.yaml"),
    before = await readFile(path);
  const code = await runGenerate(
    [f.root, "--episode", "ep-001", "--cut", "cut-001", "--dry-run", "--json"],
    f.io,
  );
  assert.equal(code, EXIT_VALIDATION, f.err.join("\n"));
  const report = JSON.parse(f.out.join("\n"));
  assert.equal(report.willGenerate, false);
  assert.equal(report.blocked, true);
  assert.match(report.targets[0].inputs.prompt, /Character 1: grey hair/);
  assert.deepEqual(report.targets[0].canvas, { width: 832, height: 416 });
  assert.equal(f.server.calls(), 0);
  assert.equal(f.server.uploads().length, 0);
  assert.deepEqual(await readFile(path), before);
});

test("a reduced automatic canvas on the later cut refuses the entire batch before any provider request", async (t) => {
  const f = await fixture(t);
  await writeCuts(
    f.root,
    "ep-001",
    f.bundle.cuts.map((cut, index) => ({
      ...cut,
      imagePrompt: "An empty harbor",
      panelAspect: index === 0 ? 1.5 : 0.3,
    })),
  );
  assert.equal(
    await runGenerate(
      [f.root, "--episode", "ep-001", "--cut", "cut-001", "--cut", "cut-002"],
      f.io,
    ),
    EXIT_VALIDATION,
  );
  assert.equal(f.server.calls(), 0);
  assert.match(f.err.join("\n"), /cut-002.*reduced-generation-canvas/);
});

test("detail framing excludes portrait attributes, persists provenance and repeats without widening", async (t) => {
  const f = await fixture(t);
  await writeCuts(
    f.root,
    "ep-001",
    f.bundle.cuts.map((cut) => ({
      ...cut,
      imagePrompt: "close-up, gloved hands on a desk",
      characters: ["a"],
      imageFraming: "detail",
    })),
  );
  const args = [f.root, "--episode", "ep-001", "--cut", "cut-001"];
  assert.equal(await runGenerate(args, f.io), EXIT_OK, f.err.join("\n"));
  assert.doesNotMatch(f.server.prompts()[0] ?? "", /grey hair|green coat|1girl/);
  assert.match(f.server.prompts()[0] ?? "", /Detail framing/);
  const entries = JSON.parse(
    await readFile(join(f.root, "episodes/ep-001/logs/ingest.json"), "utf8"),
  );
  assert.equal(entries[0].renderInputs.framing, "detail");
  assert.equal((await loadProject(f.root)).project.episodes[0]?.cuts[0]?.imageFraming, "detail");
  assert.equal(await runGenerate(args, f.io), EXIT_OK, f.err.join("\n"));
  assert.equal(f.server.prompts()[0], f.server.prompts()[1]);
});

test("a stored framing change is refused as a silent repeat; an explicit framing revision is allowed", async (t) => {
  const f = await fixture(t);
  await writeCuts(
    f.root,
    "ep-001",
    f.bundle.cuts.map((cut) => ({ ...cut, imagePrompt: "A watch on a desk" })),
  );
  const args = [f.root, "--episode", "ep-001", "--cut", "cut-001"];
  assert.equal(await runGenerate(args, f.io), EXIT_OK, f.err.join("\n"));
  const current = (await loadProject(f.root)).project.episodes[0];
  assert.ok(current);
  await writeCuts(
    f.root,
    "ep-001",
    current.cuts.map((cut) => ({ ...cut, imageFraming: "detail" })),
  );
  const calls = f.server.calls();
  assert.notEqual(await runGenerate(args, f.io), EXIT_OK);
  assert.equal(f.server.calls(), calls);
  assert.match(f.err.join("\n"), /framing detail instead of scene/);
  assert.equal(
    await runGenerate([...args, "--framing", "detail"], f.io),
    EXIT_OK,
    f.err.join("\n"),
  );
});
