// Cross-command validation contract (#270), including the real import write path.
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import {
  type AssetTarget,
  buildGenreEpisodeBundle,
  buildInitialProject,
  encodeYaml,
  ingestImageAsset,
  loadProject,
  writeProject,
} from "@toony/project-io";
import { ComfyUIProvider, ManualImportProvider } from "@toony/providers";
import type { EpisodeBundle, Project } from "@toony/schema";
import { runExport } from "../commands/export.js";
import { runGenerate } from "../commands/generate.js";
import { runImportImage } from "../commands/import-image.js";
import { runMeasure } from "../commands/measure.js";
import { runValidate } from "../commands/validate.js";
import { EXIT_OK, EXIT_USAGE, EXIT_VALIDATION } from "../exit.js";

let workdir: string;
let source: string;

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      cwd: workdir,
      out: (line: string) => out.push(line),
      err: (line: string) => err.push(line),
    },
    out,
    err,
  };
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), "toony-authoring-validation-"));
  source = join(workdir, "fixture.png");
  const canvas = createCanvas(3, 2);
  canvas.getContext("2d").fillRect(0, 0, 3, 2);
  await writeFile(source, canvas.toBuffer("image/png"));
});

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

async function scaffold(name: string) {
  const root = join(workdir, name);
  const project = buildInitialProject("validation-fixture");
  await writeProject(root, project);
  return { root, project };
}

// Direct authoring deliberately bypasses writeProject's valid-project guard.
async function author(root: string, project: Project) {
  const bundle = project.episodes[0];
  assert.ok(bundle);
  const dir = join(root, "episodes", "ep-001");
  await writeFile(join(dir, "cuts.yaml"), encodeYaml(bundle.cuts));
  await writeFile(join(dir, "episode.yaml"), encodeYaml(bundle.episode));
  await writeFile(join(dir, "transitions.yaml"), encodeYaml(bundle.transitions));
  await writeFile(join(dir, "lettering.json"), JSON.stringify(bundle.lettering));
}

/** All directory entries and exact file bytes, including assets and provenance. */
async function tree(root: string, relative = ""): Promise<Record<string, string>> {
  const entries: Record<string, string> = {};
  for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      entries[`${path}/`] = "directory";
      Object.assign(entries, await tree(root, path));
    } else {
      entries[path] = (await readFile(join(root, path))).toString("hex");
    }
  }
  return entries;
}

function importArgs(root: string, target: string[] = ["--cut", "cut-001"]) {
  return [root, "--episode", "ep-001", ...target, "--from", source];
}

test("all five commands refuse malformed records with exit 1, without provider calls or writes", async (t) => {
  const { root } = await scaffold("invalid");
  const file = join(root, "episodes", "ep-001", "cuts.yaml");
  await writeFile(
    file,
    (await readFile(file, "utf8")).replace("- id: cut-001", "- id: cut-001\n  shotType: invalid"),
  );
  const before = await tree(root);
  const manual = t.mock.method(ManualImportProvider.prototype, "produce", async () => {
    throw new Error("invalid project reached manual provider");
  });
  const generated = t.mock.method(ComfyUIProvider.prototype, "produce", async () => {
    throw new Error("invalid project reached generation provider");
  });
  const commands = [
    () => runValidate([root], capture().io),
    () =>
      runGenerate(
        [root, "--episode", "ep-001", "--cut", "cut-001", "--prompt", "fixture scene"],
        capture().io,
      ),
    () => runExport(["stitched", root, "--episode", "ep-001"], capture().io),
    () => runMeasure([root, "--episode", "ep-001"], capture().io),
  ];
  for (const run of commands) assert.equal(await run(), EXIT_VALIDATION);
  for (const target of [
    ["--cut", "cut-001"],
    ["--cut", "cut-001", "--slot", "final"],
    ["--transition", "tr-001"],
  ]) {
    const c = capture();
    assert.equal(await runImportImage(importArgs(root, target), c.io), EXIT_VALIDATION);
    assert.match(c.err.join("\n"), /cut\.shot-type/);
    assert.match(c.err.join("\n"), /shotType \(cut-001\) is "invalid"/);
    assert.match(c.err.join("\n"), /nothing was imported/);
  }
  assert.equal(manual.mock.callCount(), 0);
  assert.equal(generated.mock.callCount(), 0);
  assert.deepEqual(await tree(root), before);
});

test("valid imports match the previous provider-to-ingest path byte for byte for every target", async () => {
  const targets: AssetTarget[] = [
    { kind: "cut", episodeId: "ep-001", cutId: "cut-001", slot: "clean" },
    { kind: "cut", episodeId: "ep-001", cutId: "cut-001", slot: "final" },
    { kind: "transition", episodeId: "ep-001", transitionId: "tr-001" },
  ];
  for (const [index, target] of targets.entries()) {
    const { root: expected } = await scaffold(`before-${index}`);
    const { root: actual } = await scaffold(`after-${index}`);
    const produced = await new ManualImportProvider().produce({ sourcePath: source });
    await ingestImageAsset(expected, target, produced);
    const flags =
      target.kind === "cut"
        ? ["--cut", target.cutId, "--slot", target.slot]
        : ["--transition", target.transitionId];
    const c = capture();
    assert.equal(await runImportImage(importArgs(actual, flags), c.io), EXIT_OK, c.err.join("\n"));
    assert.deepEqual(await tree(actual), await tree(expected));
    assert.equal((await loadProject(actual)).validation.valid, true);
  }
});

test("all six authoring wiring states warn and import; strict consumers still refuse them", async () => {
  const states: [string, (bundle: EpisodeBundle) => void][] = [
    [
      "cut.orphan",
      (bundle) => {
        const cuts = bundle.cuts;
        assert.ok(cuts[0]);
        cuts.push({ ...cuts[0], id: "cut-003" });
      },
    ],
    [
      "transition.orphan",
      (bundle) => {
        const transitions = bundle.transitions;
        assert.ok(transitions[0]);
        transitions.push({ ...transitions[0], id: "tr-002" });
      },
    ],
    [
      "sequence.missing-cut",
      (bundle) => {
        bundle.episode.sequence.push({ type: "cut", id: "cut-missing" });
      },
    ],
    [
      "sequence.missing-transition",
      (bundle) => {
        bundle.episode.sequence[1] = { type: "transition", id: "tr-missing" };
      },
    ],
    [
      "overlay.missing-cut",
      (bundle) => {
        const overlay = buildGenreEpisodeBundle("romance").lettering[0];
        assert.ok(overlay);
        bundle.lettering = [{ ...overlay, cutId: "cut-missing" }];
      },
    ],
    [
      "sequence.empty",
      (bundle) => {
        bundle.episode.sequence = [];
      },
    ],
  ];
  for (const [code, edit] of states) {
    const { root, project } = await scaffold(code);
    const bundle = project.episodes[0];
    assert.ok(bundle);
    edit(bundle);
    await author(root, project);
    const validation = (await loadProject(root)).validation;
    assert.equal(validation.valid, false);
    assert.ok(
      validation.issues.some((issue) => issue.code === code),
      code,
    );
    const c = capture();
    assert.equal(await runImportImage(importArgs(root), c.io), EXIT_OK, c.err.join("\n"));
    assert.ok(c.err.join("\n").includes(`[${code}]`));
    assert.match(c.err.join("\n"), /importing anyway/);
    assert.equal(
      await runExport(["stitched", root, "--episode", "ep-001"], capture().io),
      EXIT_VALIDATION,
    );
    assert.equal(await runMeasure([root, "--episode", "ep-001"], capture().io), EXIT_VALIDATION);

    // One malformed field alongside any permitted wiring issue still refuses.
    const file = join(root, "episodes", "ep-001", "cuts.yaml");
    await writeFile(
      file,
      (await readFile(file, "utf8")).replace("- id: cut-001", "- id: cut-001\n  shotType: invalid"),
    );
    const before = await tree(root);
    assert.equal(await runImportImage(importArgs(root), capture().io), EXIT_VALIDATION);
    assert.deepEqual(await tree(root), before);
  }
});

test("IO and usage errors remain exit 2", async () => {
  const root = join(workdir, "not-a-project");
  assert.equal(await runValidate([root], capture().io), EXIT_USAGE);
  assert.equal(
    await runGenerate(
      [root, "--episode", "ep-001", "--cut", "cut-001", "--prompt", "fixture scene"],
      capture().io,
    ),
    EXIT_USAGE,
  );
  assert.equal(
    await runExport(["stitched", root, "--episode", "ep-001"], capture().io),
    EXIT_USAGE,
  );
  assert.equal(await runMeasure([root, "--episode", "ep-001"], capture().io), EXIT_USAGE);
  assert.equal(await runImportImage(importArgs(root), capture().io), EXIT_USAGE);
  const { root: valid } = await scaffold("valid");
  assert.equal(
    await runImportImage(
      importArgs(valid, ["--cut", "cut-001", "--slot", "unknown"]),
      capture().io,
    ),
    EXIT_USAGE,
  );
});
