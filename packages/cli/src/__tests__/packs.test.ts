// The pack seam, end to end through the CLI (#192), and the regression bar that
// guards it: with no packs installed, `toony init`, `toony generate`, and
// `toony export` must behave exactly as they did before the seam existed.
//
// "Exactly" is pinned, not asserted. INIT_TREE_DIGESTS below hash every byte of
// every file `toony init` writes. If a change to the seam perturbs a single byte
// of a scaffolded project, these fail. A deliberate future change to a genre or
// to the on-disk format is expected to update them; an accidental one is not.
//
// They were first computed on `main` at af8bd07, the commit the seam branched
// from. #208 retired `LetteringOverlay.font`, which the genre scaffolds seeded,
// so the five genre digests moved with it; the neutral scaffold has no lettering
// and its digest is unchanged from af8bd07, which is the evidence that only the
// retired field moved.
//
// #217 added `webtoon.referenceWidth`, the column a project's px are authored on,
// so all six moved. `diff -r` over the six scaffolds written before and after
// reports exactly one changed line in each: the added field in webtoon.json.
// Nothing else in any tree moved.
//
// #273 re-authored the romance `palette_shift`'s fill, so ONE digest moved.
// `diff -r` over the six scaffolds written before and after reports a single
// changed line in the whole set — `color:` in romance's transitions.yaml — and
// the other five trees byte-identical. Only `romance` is re-pinned below; the
// other five keep the values #217 left, which is what makes them the control
// rather than a second edit.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { decodeYaml, encodeYaml, loadProject } from "@toony/project-io";
import { recordedShellCommand } from "../__fixtures__/shell.js";
import { runExport } from "../commands/export.js";
import { runGenerate } from "../commands/generate.js";
import { runInit } from "../commands/init.js";
import { runLint } from "../commands/lint.js";
import { runValidate } from "../commands/validate.js";
import { EXIT_OK, EXIT_USAGE, EXIT_VALIDATION } from "../exit.js";

/** Tree digest of `toony init` output, per `--genre`; all six as of #217. */
const INIT_TREE_DIGESTS: Record<string, string> = {
  "": "24fc0c0dcca40332df8f5852840dcb5cd49ae2e6dee1c53a5f6e2f6f36cef2cc",
  romance: "609109f9611c48a90349123dfa0e642c76ba3de33438aeea2a412a6e9688fa5d",
  comedy: "fe0e38f3cedc69f213eac5bfde797ceba4af9964cf6fa2189f98a363a86824ed",
  action: "60ad151ec3552e9b115387b72b446099d29bd902771ca37329514f0494be8163",
  thriller: "4ee63ea73e971968f20357cd7e07d9efced09f527d49e779e731d69b71da32b5",
  "slice-of-life": "107a77fc4618aa3aa0d9c4af88fd68d2d54795f7000781455854ebbc3fb30741",
};

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

/** Every file under `dir`, hashed, in a stable order: one digest for the tree. */
async function treeDigest(dir: string): Promise<string> {
  const lines: string[] = [];
  const walk = async (current: string): Promise<void> => {
    for (const name of (await readdir(current)).sort()) {
      const full = join(current, name);
      if ((await stat(full)).isDirectory()) await walk(full);
      else {
        const hash = createHash("sha256")
          .update(await readFile(full))
          .digest("hex");
        lines.push(`${relative(dir, full)} ${hash}`);
      }
    }
  };
  await walk(dir);
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

const GRAPH = {
  "3": { class_type: "KSampler", inputs: { seed: 0, steps: 40, sampler_name: "dpmpp_2m" } },
  "5": { class_type: "EmptyLatentImage", inputs: { width: 832, height: 1216 } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "" } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "" } },
};

const NOIR = {
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
    {
      id: "cut-001",
      image: null,
      imagePrompt: "Rain on an empty street at night.",
      negativePrompt: "",
      shotType: "establishing_wide",
      palette: "#1a1d24",
    },
    {
      id: "cut-002",
      image: null,
      imagePrompt: "A hat brim, most of the face in shadow.",
      negativePrompt: "",
      shotType: "close_up",
      palette: "#22262e",
    },
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
  lettering: [
    {
      id: "ov-001",
      cutId: "cut-001",
      speaker: "",
      kind: "narration",
      text: "The city keeps its own hours.",
      font: "sans-serif",
      fill: "#ffffff",
      opacity: 1,
      border: null,
      tail: null,
      geometry: { x: 0.08, y: 0.07, width: 0.84, height: 0.16 },
      overflow: false,
      reviewStatus: "draft",
    },
  ],
};

/**
 * A gutter line that wraps to four lines in a 0.32 strip and to six in the
 * default 0.18 one: the craft wrap check therefore reports it only when the
 * project has not declared the wider strip its genre letters in (#215).
 */
const GUTTER_LINE = {
  id: "g1",
  cutId: "cut-001",
  speaker: "Mina",
  kind: "speech",
  text: "He is not coming back tonight.",
  font: "sans-serif",
  fill: "#ffffff",
  opacity: 1,
  border: null,
  tail: null,
  placement: "gutter",
  placementSide: "right",
  geometry: { x: 0.04, y: 0.1, width: 0.92, height: 0.2 },
  overflow: false,
  reviewStatus: "human-edited",
};

/** Install a pack contributing all three kinds under `<workdir>/.toony/packs`. */
async function installPack(manifestOverrides: Record<string, unknown> = {}): Promise<string> {
  const dir = join(workdir, ".toony", "packs", "example-pack");
  await mkdir(join(dir, "workflows"), { recursive: true });
  await mkdir(join(dir, "genres"), { recursive: true });
  await writeFile(
    join(dir, "toony-pack.json"),
    JSON.stringify({
      packFormat: 1,
      id: "example-pack",
      name: "Example Pack",
      workflows: [{ name: "high-detail", file: "workflows/high-detail.json" }],
      genres: [{ id: "noir", title: "Noir", file: "genres/noir.json" }],
      exportPresets: [
        {
          id: "webtoon-tall",
          target: "platform",
          options: { width: 640, format: "jpeg", quality: 88 },
        },
      ],
      ...manifestOverrides,
    }),
  );
  await writeFile(join(dir, "workflows", "high-detail.json"), JSON.stringify(GRAPH));
  await writeFile(join(dir, "genres", "noir.json"), JSON.stringify(NOIR));
  return dir;
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), "toony-packs-cli-"));
});
afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

// --- The zero-pack regression bar -------------------------------------------

test("with no packs installed, init writes byte-for-byte what it wrote before the seam", async () => {
  for (const [genre, expected] of Object.entries(INIT_TREE_DIGESTS)) {
    const c = capture();
    const args = genre === "" ? ["demo"] : ["demo", "--genre", genre];
    assert.equal(await runInit(args, c.io), EXIT_OK, c.err.join("\n"));
    assert.deepEqual(c.err, [], "a zero-pack run must not warn about packs");
    assert.equal(
      await treeDigest(join(workdir, "demo")),
      expected,
      `init${genre ? ` --genre ${genre}` : ""} output changed from the pinned tree`,
    );
    await rm(join(workdir, "demo"), { recursive: true, force: true });
  }
});

test("init reports each resolved starter fragment's shape and plans before mass generation", async () => {
  const assertFragmentSummary = async (name: string, output: string[]): Promise<void> => {
    const { project } = await loadProject(join(workdir, name));
    const cuts = project.episodes.reduce((count, bundle) => count + bundle.cuts.length, 0);
    const transitions = project.episodes.reduce(
      (count, bundle) => count + bundle.transitions.length,
      0,
    );
    const cutLabel = `${cuts} cut${cuts === 1 ? "" : "s"}`;
    const transitionLabel = `${transitions} transition${transitions === 1 ? "" : "s"}`;
    assert.ok(
      output.includes(`starter fragment: ${cutLabel}, ${transitionLabel}`),
      `init summary must describe the resolved project: ${output.join("\n")}`,
    );
    assert.ok(
      output.some((line) => /before mass generation: .*toony plan --episode ep-001$/.test(line)),
      `init must direct the author to plan before generating: ${output.join("\n")}`,
    );
  };

  const bare = capture();
  assert.equal(await runInit(["bare"], bare.io), EXIT_OK, bare.err.join("\n"));
  await assertFragmentSummary("bare", bare.out);

  const core = capture();
  assert.equal(
    await runInit(["core", "--genre", "romance"], core.io),
    EXIT_OK,
    core.err.join("\n"),
  );
  await assertFragmentSummary("core", core.out);

  await installPack();
  const pack = capture();
  assert.equal(await runInit(["pack", "--genre", "noir"], pack.io), EXIT_OK, pack.err.join("\n"));
  await assertFragmentSummary("pack", pack.out);
});

test("a pack that is installed but not selected changes nothing init writes", async () => {
  await installPack();
  for (const [genre, expected] of Object.entries(INIT_TREE_DIGESTS)) {
    const c = capture();
    const args = genre === "" ? ["demo"] : ["demo", "--genre", genre];
    assert.equal(await runInit(args, c.io), EXIT_OK, c.err.join("\n"));
    assert.equal(await treeDigest(join(workdir, "demo")), expected);
    await rm(join(workdir, "demo"), { recursive: true, force: true });
  }
});

test("a pack that is installed but not selected changes nothing export writes", async () => {
  // Export once with no packs, once with a pack installed but a built-in target
  // selected, and compare the manifest — every output file's bytes are hashed in
  // it, so an identical manifest is an identical export.
  const init = capture();
  assert.equal(await runInit(["demo"], init.io), EXIT_OK);
  const dir = join(workdir, "demo");
  const withoutPack = capture();
  assert.equal(
    await runExport(["platform", dir, "--episode", "ep-001", "--width", "400"], withoutPack.io),
    EXIT_OK,
    withoutPack.err.join("\n"),
  );
  const before = await readFile(
    join(dir, "episodes", "ep-001", "exports", "platform", "manifest.json"),
    "utf8",
  );

  await installPack();
  const withPack = capture();
  assert.equal(
    await runExport(["platform", dir, "--episode", "ep-001", "--width", "400"], withPack.io),
    EXIT_OK,
    withPack.err.join("\n"),
  );
  const after = await readFile(
    join(dir, "episodes", "ep-001", "exports", "platform", "manifest.json"),
    "utf8",
  );
  assert.equal(after, before);
  assert.deepEqual(withoutPack.out, withPack.out);
});

test("with no packs installed the export targets and genres are the pre-seam vocabulary", async () => {
  const genre = capture();
  assert.equal(await runInit(["demo", "--genre", "horror"], genre.io), EXIT_USAGE);
  assert.match(
    genre.err.join("\n"),
    /unknown genre "horror"; expected one of: romance, comedy, action, thriller, slice-of-life$/m,
  );

  const init = capture();
  assert.equal(await runInit(["demo"], init.io), EXIT_OK);
  const target = capture();
  assert.equal(
    await runExport(["gif", join(workdir, "demo"), "--episode", "ep-001"], target.io),
    EXIT_USAGE,
  );
  assert.match(
    target.err.join("\n"),
    /first argument must be one of: platform, stitched, plotlink$/m,
  );
});

// --- All three contribution kinds, through the CLI --------------------------

test("a pack genre scaffold seeds a project that validates and lints clean", async () => {
  await installPack();
  const c = capture();
  assert.equal(await runInit(["my-story", "--genre", "noir"], c.io), EXIT_OK, c.err.join("\n"));
  assert.match(c.out.join("\n"), /noir template/);

  const dir = join(workdir, "my-story");
  const validate = capture();
  assert.equal(await runValidate([dir], validate.io), EXIT_OK, validate.err.join("\n"));
  const lint = capture();
  assert.equal(await runLint([dir], lint.io), EXIT_OK, lint.out.join("\n"));

  // The scaffold that landed on disk is the pack's, not a built-in.
  const cuts = await readFile(join(dir, "episodes", "ep-001", "cuts.yaml"), "utf8");
  assert.match(cuts, /Rain on an empty street at night\./);
});

test("a pack export preset selects an engine and pins its render options", async () => {
  await installPack();
  const init = capture();
  assert.equal(await runInit(["my-story", "--genre", "noir"], init.io), EXIT_OK);
  const dir = join(workdir, "my-story");

  const c = capture();
  assert.equal(
    await runExport(["webtoon-tall", dir, "--episode", "ep-001"], c.io),
    EXIT_OK,
    c.err.join("\n"),
  );
  assert.match(c.out.join("\n"), /exported webtoon-tall/);

  const manifest = JSON.parse(
    await readFile(join(dir, "episodes", "ep-001", "exports", "platform", "manifest.json"), "utf8"),
  );
  assert.equal(manifest.target, "platform");
  assert.equal(manifest.width, 640);
  assert.equal(manifest.files[0].format, "jpeg");
  assert.equal(manifest.files[0].quality, 88);
});

test("an explicit flag still overrides what a preset pins", async () => {
  await installPack();
  const init = capture();
  assert.equal(await runInit(["my-story", "--genre", "noir"], init.io), EXIT_OK);
  const dir = join(workdir, "my-story");

  const c = capture();
  assert.equal(
    await runExport(["webtoon-tall", dir, "--episode", "ep-001", "--width", "320"], c.io),
    EXIT_OK,
    c.err.join("\n"),
  );
  const manifest = JSON.parse(
    await readFile(join(dir, "episodes", "ep-001", "exports", "platform", "manifest.json"), "utf8"),
  );
  assert.equal(manifest.width, 320);
  assert.equal(manifest.files[0].format, "jpeg", "the preset's format is still applied");
});

test("a pack workflow is selected by name and sent to the provider", async () => {
  await installPack();
  const init = capture();
  assert.equal(await runInit(["my-story"], init.io), EXIT_OK);
  const dir = join(workdir, "my-story");

  const comfy = await startFakeComfy();
  try {
    const c = capture({ TOONY_COMFYUI_URL: comfy.url });
    const code = await runGenerate(
      [
        dir,
        "--episode",
        "ep-001",
        "--cut",
        "cut-001",
        "--prompt",
        "a rainy alley",
        "--workflow",
        "high-detail",
        "--allow-remote",
      ],
      c.io,
    );
    assert.equal(code, EXIT_OK, c.err.join("\n"));
    // The graph that reached ComfyUI is the PACK's, not the bundled default
    // (which is steps 25 / euler), and Toony still injected the prompt into it.
    const graph = comfy.lastPrompt()?.prompt as Record<string, { inputs: Record<string, unknown> }>;
    assert.equal(graph["3"]?.inputs.steps, 40);
    assert.equal(graph["3"]?.inputs.sampler_name, "dpmpp_2m");
    assert.equal(graph["6"]?.inputs.text, "a rainy alley");
  } finally {
    comfy.close();
  }
});

/** The cut records on disk, unnormalized. */
async function cutsOnDisk(dir: string): Promise<Record<string, unknown>[]> {
  const text = await readFile(join(dir, "episodes", "ep-001", "cuts.yaml"), "utf8");
  return decodeYaml(text) as Record<string, unknown>[];
}

test("a cut re-generates with the workflow it recorded, with no --workflow (#240)", async () => {
  await installPack();
  const init = capture();
  assert.equal(await runInit(["my-story"], init.io), EXIT_OK);
  const dir = join(workdir, "my-story");

  const comfy = await startFakeComfy();
  try {
    const first = capture({ TOONY_COMFYUI_URL: comfy.url });
    assert.equal(
      await runGenerate(
        [
          dir,
          "--episode",
          "ep-001",
          "--cut",
          "cut-001",
          "--prompt",
          "a rainy alley",
          "--workflow",
          "high-detail",
          "--allow-remote",
        ],
        first.io,
      ),
      EXIT_OK,
      first.err.join("\n"),
    );
    const recorded = await cutsOnDisk(dir);
    assert.equal(recorded.find((cut) => cut.id === "cut-001")?.imageWorkflow, "high-detail");

    // The re-run names no workflow. The test above this one pins what that
    // means for a cut with nothing recorded: the BUNDLED default graph, which
    // is steps 25 / euler. Reading the pack's 40 / dpmpp_2m back is therefore
    // the recorded name being resolved, not a default that happens to match.
    const again = capture({ TOONY_COMFYUI_URL: comfy.url });
    assert.equal(
      await runGenerate(
        [dir, "--episode", "ep-001", "--cut", "cut-001", "--allow-remote"],
        again.io,
      ),
      EXIT_OK,
      again.err.join("\n"),
    );
    const graph = comfy.lastPrompt()?.prompt as Record<string, { inputs: Record<string, unknown> }>;
    assert.equal(graph["3"]?.inputs.steps, 40);
    assert.equal(graph["3"]?.inputs.sampler_name, "dpmpp_2m");

    // A cut nobody generated records no workflow, so nothing is project-wide.
    const after = await cutsOnDisk(dir);
    assert.equal(after.find((cut) => cut.id === "cut-002")?.imageWorkflow, undefined);
  } finally {
    comfy.close();
  }
});

test("one batch runs each cut with the workflow that cut recorded (#240)", async () => {
  // Re-rendering a batch is the case the recorded workflow exists for, and the
  // cuts in a batch need not agree: a run resolves one provider per distinct
  // workflow rather than making the first cut's choice the run's.
  const packDir = await installPack({
    workflows: [
      { name: "high-detail", file: "workflows/high-detail.json" },
      { name: "soft-focus", file: "workflows/soft-focus.json" },
    ],
  });
  await writeFile(
    join(packDir, "workflows", "soft-focus.json"),
    JSON.stringify({
      ...GRAPH,
      "3": { class_type: "KSampler", inputs: { seed: 0, steps: 12, sampler_name: "ddim" } },
    }),
  );
  const init = capture();
  assert.equal(await runInit(["my-story"], init.io), EXIT_OK);
  const dir = join(workdir, "my-story");

  const comfy = await startFakeComfy();
  try {
    for (const [cutId, workflow] of [
      ["cut-001", "high-detail"],
      ["cut-002", "soft-focus"],
    ] as const) {
      const c = capture({ TOONY_COMFYUI_URL: comfy.url });
      assert.equal(
        await runGenerate(
          [
            dir,
            "--episode",
            "ep-001",
            "--cut",
            cutId,
            "--prompt",
            `a ${cutId} scene`,
            "--workflow",
            workflow,
            "--allow-remote",
          ],
          c.io,
        ),
        EXIT_OK,
        c.err.join("\n"),
      );
    }

    const batch = capture({ TOONY_COMFYUI_URL: comfy.url });
    assert.equal(
      await runGenerate(
        [dir, "--episode", "ep-001", "--cut", "cut-001", "--cut", "cut-002", "--allow-remote"],
        batch.io,
      ),
      EXIT_OK,
      batch.err.join("\n"),
    );
    // Submissions 3 and 4 are the batch, in --cut order: each cut's own graph.
    const [, , one, two] = comfy.graphs();
    assert.equal(one?.["3"]?.inputs.steps, 40);
    assert.equal(two?.["3"]?.inputs.steps, 12);
    assert.equal(two?.["3"]?.inputs.sampler_name, "ddim");
  } finally {
    comfy.close();
  }
});

test("the escape a refusal names carries the workflow the plate was rendered with (#240)", async () => {
  // A final plate rendered through a named workflow has nothing to replay it
  // from — the cut's record describes the clean slot. An instruction naming only
  // the size and the seed re-renders it at the right size, from the right seed,
  // through the WRONG graph, and the operator gets there by obeying the tool.
  await installPack();
  const init = capture();
  assert.equal(await runInit(["my-story"], init.io), EXIT_OK);
  const dir = join(workdir, "my-story");
  // An authored prompt: a final render writes no record to fall back on.
  const cutsPath = join(dir, "episodes", "ep-001", "cuts.yaml");
  const cuts = (await cutsOnDisk(dir)).map((cut) =>
    cut.id === "cut-001" ? { ...cut, imagePrompt: "the lettered final pass" } : cut,
  );
  await writeFile(cutsPath, encodeYaml(cuts));

  const comfy = await startFakeComfy();
  try {
    const first = capture({ TOONY_COMFYUI_URL: comfy.url });
    assert.equal(
      await runGenerate(
        [
          dir,
          "--episode",
          "ep-001",
          "--cut",
          "cut-001",
          "--slot",
          "final",
          "--workflow",
          "high-detail",
          "--seed",
          "7",
          "--width",
          "640",
          "--height",
          "960",
          "--allow-remote",
        ],
        first.io,
      ),
      EXIT_OK,
      first.err.join("\n"),
    );

    const blind = capture({ TOONY_COMFYUI_URL: comfy.url });
    assert.equal(
      await runGenerate(
        [dir, "--episode", "ep-001", "--cut", "cut-001", "--slot", "final", "--allow-remote"],
        blind.io,
      ),
      EXIT_USAGE,
      blind.out.join("\n"),
    );
    const err = blind.err.join("\n");
    const line = err.split("\n").find((l) => l.trim().startsWith("--"));
    assert.ok(line, `no repeat instruction in:\n${err}`);
    const flags = recordedShellCommand(`toony ${line.trim()}`, workdir).args;
    assert.ok(flags.includes("--workflow"), flags.join(" "));

    // The instruction, verbatim: the pack's graph (steps 40 / dpmpp_2m), not the
    // bundled default (steps 25 / euler) the config would otherwise resolve.
    const obey = capture({ TOONY_COMFYUI_URL: comfy.url });
    assert.equal(
      await runGenerate(
        [
          dir,
          "--episode",
          "ep-001",
          "--cut",
          "cut-001",
          "--slot",
          "final",
          ...flags,
          "--allow-remote",
        ],
        obey.io,
      ),
      EXIT_OK,
      obey.err.join("\n"),
    );
    const [original, repeated] = comfy.graphs();
    assert.equal(repeated?.["3"]?.inputs.steps, 40, "the repeat used another graph");
    assert.deepEqual(repeated?.["3"]?.inputs, original?.["3"]?.inputs);
    assert.deepEqual(repeated?.["5"]?.inputs, original?.["5"]?.inputs);
    assert.deepEqual(repeated?.["6"]?.inputs, original?.["6"]?.inputs);
  } finally {
    comfy.close();
  }
});

test("a plate rendered with no named workflow is repeated with no named workflow (#240)", async () => {
  // The first render of anything names no workflow, so the record holds none —
  // and that absence is an ANSWER: the local config resolved the graph. Read as
  // silence, a later run with `--workflow` was told only the size, rendered the
  // plate through the other graph at the right size, and wrote that graph onto
  // the cut as what produced it.
  await installPack();
  const init = capture();
  assert.equal(await runInit(["my-story"], init.io), EXIT_OK);
  const dir = join(workdir, "my-story");

  const comfy = await startFakeComfy();
  try {
    const first = capture({ TOONY_COMFYUI_URL: comfy.url });
    assert.equal(
      await runGenerate(
        [
          dir,
          "--episode",
          "ep-001",
          "--cut",
          "cut-001",
          "--prompt",
          "a rainy alley",
          "--seed",
          "7",
          "--width",
          "640",
          "--height",
          "960",
          "--allow-remote",
        ],
        first.io,
      ),
      EXIT_OK,
      first.err.join("\n"),
    );
    // The bundled default graph, and no workflow name recorded on the cut.
    assert.equal(comfy.graphs()[0]?.["3"]?.inputs.steps, 25);
    assert.equal(
      (await cutsOnDisk(dir)).find((cut) => cut.id === "cut-001")?.imageWorkflow,
      undefined,
    );

    const named = capture({ TOONY_COMFYUI_URL: comfy.url });
    assert.equal(
      await runGenerate(
        [
          dir,
          "--episode",
          "ep-001",
          "--cut",
          "cut-001",
          "--workflow",
          "high-detail",
          "--allow-remote",
        ],
        named.io,
      ),
      EXIT_USAGE,
      named.out.join("\n"),
    );
    const err = named.err.join("\n");
    const line = err.split("\n").find((l) => l.trim().startsWith("--"));
    assert.ok(line, `no repeat instruction in:\n${err}`);
    const flags = recordedShellCommand(`toony ${line.trim()}`, workdir).args;
    // The instruction says to name no workflow, which is a thing a run can say.
    assert.deepEqual(flags, ["--width", "640", "--height", "960", "--workflow", ""]);

    const obey = capture({ TOONY_COMFYUI_URL: comfy.url });
    assert.equal(
      await runGenerate(
        [
          dir,
          "--episode",
          "ep-001",
          "--cut",
          "cut-001",
          "--workflow",
          "high-detail",
          ...flags,
          "--allow-remote",
        ],
        obey.io,
      ),
      EXIT_OK,
      obey.err.join("\n"),
    );
    // Back through the bundled default, byte for byte what the first run sent.
    const [original, repeated] = comfy.graphs();
    assert.deepEqual(repeated, original, "obeying the instruction did not repeat the render");
    // And the cut still records no workflow, rather than the one that lost.
    assert.equal(
      (await cutsOnDisk(dir)).find((cut) => cut.id === "cut-001")?.imageWorkflow,
      undefined,
    );
  } finally {
    comfy.close();
  }
});

test("a recorded workflow that is no longer installed names the cut that holds it (#240)", async () => {
  const packDir = await installPack();
  const init = capture();
  assert.equal(await runInit(["my-story"], init.io), EXIT_OK);
  const dir = join(workdir, "my-story");

  const comfy = await startFakeComfy();
  try {
    const first = capture({ TOONY_COMFYUI_URL: comfy.url });
    assert.equal(
      await runGenerate(
        [
          dir,
          "--episode",
          "ep-001",
          "--cut",
          "cut-001",
          "--prompt",
          "a rainy alley",
          "--workflow",
          "high-detail",
          "--allow-remote",
        ],
        first.io,
      ),
      EXIT_OK,
      first.err.join("\n"),
    );
    await rm(packDir, { recursive: true, force: true });

    const again = capture({ TOONY_COMFYUI_URL: comfy.url });
    assert.equal(
      await runGenerate(
        [dir, "--episode", "ep-001", "--cut", "cut-001", "--allow-remote"],
        again.io,
      ),
      EXIT_USAGE,
    );
    // The name came off the cut, not the command line, so the message says so
    // rather than reading as a complaint about a flag nobody passed.
    assert.match(again.err.join("\n"), /no workflow named "high-detail"/);
    assert.match(again.err.join("\n"), /cut cut-001 records workflow "high-detail"/);
  } finally {
    comfy.close();
  }
});

test("with no --workflow the bundled default graph is used, packs installed or not", async () => {
  await installPack();
  const init = capture();
  assert.equal(await runInit(["my-story"], init.io), EXIT_OK);
  const dir = join(workdir, "my-story");

  const comfy = await startFakeComfy();
  try {
    const c = capture({ TOONY_COMFYUI_URL: comfy.url });
    const code = await runGenerate(
      [dir, "--episode", "ep-001", "--cut", "cut-001", "--prompt", "x", "--allow-remote"],
      c.io,
    );
    assert.equal(code, EXIT_OK, c.err.join("\n"));
    const graph = comfy.lastPrompt()?.prompt as Record<string, { inputs: Record<string, unknown> }>;
    assert.equal(graph["3"]?.inputs.steps, 25, "the shipped default graph");
    assert.equal(graph["3"]?.inputs.sampler_name, "euler");
  } finally {
    comfy.close();
  }
});

test("an unknown workflow name fails with the installed names, never a silent fallback", async () => {
  await installPack();
  const init = capture();
  assert.equal(await runInit(["my-story"], init.io), EXIT_OK);
  const c = capture({ TOONY_COMFYUI_URL: "http://127.0.0.1:1" });
  const code = await runGenerate(
    [
      join(workdir, "my-story"),
      "--episode",
      "ep-001",
      "--cut",
      "cut-001",
      "--prompt",
      "x",
      "--workflow",
      "nope",
      "--allow-remote",
    ],
    c.io,
  );
  assert.equal(code, EXIT_USAGE);
  assert.match(c.err.join("\n"), /no workflow named "nope"; available: high-detail/);
});

// --- A malformed pack degrades, it never crashes ----------------------------

test("a pack manifest that carries code is refused; the command still succeeds", async () => {
  await installPack({ main: "./evil.js" });
  const c = capture();
  assert.equal(await runInit(["demo"], c.io), EXIT_OK, c.err.join("\n"));
  const warnings = c.err.join("\n");
  assert.match(warnings, /pack warning \[pack\.unexpected-field\]/);
  assert.match(warnings, /can never declare code/);
  // The refused pack contributed nothing: its genre is not in the vocabulary…
  const genre = capture();
  assert.equal(await runInit(["other", "--genre", "noir"], genre.io), EXIT_USAGE);
  assert.match(genre.err.join("\n"), /unknown genre "noir"/);
  // …and the project it did write is byte-identical to the zero-pack one.
  assert.equal(await treeDigest(join(workdir, "demo")), INIT_TREE_DIGESTS[""]);
});

test("an unreadable pack file is reported and the rest of the pack still works", async () => {
  const dir = await installPack();
  await rm(join(dir, "genres", "noir.json"));
  const c = capture();
  assert.equal(await runInit(["demo"], c.io), EXIT_OK);
  assert.match(c.err.join("\n"), /pack warning \[pack\.genre\.file-missing\]/);

  // The preset from the same pack is unaffected.
  const exported = capture();
  assert.equal(
    await runExport(["webtoon-tall", join(workdir, "demo"), "--episode", "ep-001"], exported.io),
    EXIT_OK,
    exported.err.join("\n"),
  );
});

// --- A ComfyUI-shaped test server, so `generate` exercises the real path -----

const PROMPT_ID = "pack-test-1";
// A real encoded fixture: the old hand-built 69-byte PNG crashed native decode.
const ONE_PIXEL_PNG = createCanvas(1, 1).toBuffer("image/png");

async function startFakeComfy(): Promise<{
  url: string;
  close: () => void;
  lastPrompt: () => Record<string, unknown> | null;
  graphs: () => Record<string, { inputs: Record<string, unknown> }>[];
}> {
  let lastPrompt: Record<string, unknown> | null = null;
  const graphs: Record<string, { inputs: Record<string, unknown> }>[] = [];
  const server: Server = createServer((req, res) => {
    const url = req.url ?? "";
    if (req.method === "POST" && url === "/prompt") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        lastPrompt = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        graphs.push(
          (lastPrompt as { prompt?: Record<string, { inputs: Record<string, unknown> }> })
            ?.prompt ?? {},
        );
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ prompt_id: PROMPT_ID, node_errors: {} }));
      });
      return;
    }
    if (req.method === "GET" && url.startsWith("/history/")) {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          [PROMPT_ID]: {
            outputs: { "9": { images: [{ filename: "o.png", subfolder: "", type: "output" }] } },
            status: { status_str: "success", completed: true },
          },
        }),
      );
      return;
    }
    if (req.method === "GET" && url.startsWith("/view")) {
      res.setHeader("content-type", "image/png");
      res.end(ONE_PIXEL_PNG);
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => server.close(),
    lastPrompt: () => lastPrompt,
    graphs: () => [...graphs],
  };
}

// --- The gutter strip a genre letters in (#215) -----------------------------

test("a pack genre's gutter strip lands in the project and the project renders on it", async () => {
  // The contract end to end: a pack declares a number, `toony init --genre`
  // writes it into `webtoon.json`, and from there the render core — the same
  // one the studio reads through — lays the strip out at that width. Nothing
  // reads the pack after init, so an exported episode does not depend on which
  // packs happen to be installed.
  await installPack({
    genres: [{ id: "noir", title: "Noir", file: "genres/noir.json", gutterBandWidth: 0.32 }],
  });
  const init = capture();
  assert.equal(
    await runInit(["my-story", "--genre", "noir"], init.io),
    EXIT_OK,
    init.err.join("\n"),
  );

  const dir = join(workdir, "my-story");
  const webtoon = JSON.parse(await readFile(join(dir, "webtoon.json"), "utf8"));
  assert.equal(webtoon.gutterBandWidth, 0.32);

  // The scaffolded project is still a valid one.
  const validate = capture();
  assert.equal(await runValidate([dir], validate.io), EXIT_OK, validate.err.join("\n"));

  // And what the project holds is what `toony lint` measures against. The line
  // below wraps to four lines in the strip this pack ships and to six in the
  // default one, so it lints clean here; taking the declared width back off the
  // SAME project makes the wrap warning appear. That is the lint reading the
  // project's strip rather than a constant — which is what let both authored
  // packs be rejected for text their own genre renders fine.
  await writeFile(
    join(dir, "episodes", "ep-001", "lettering.json"),
    JSON.stringify([GUTTER_LINE], null, 2),
  );
  const wide = capture();
  assert.equal(await runLint([dir], wide.io), EXIT_OK, wide.out.join("\n"));

  delete webtoon.gutterBandWidth;
  await writeFile(join(dir, "webtoon.json"), JSON.stringify(webtoon, null, 2));
  const narrow = capture();
  assert.equal(await runLint([dir], narrow.io), EXIT_VALIDATION);
  assert.match(narrow.out.join("\n"), /craft\/line-wrap/);
});

test("a pack that declares an unusable gutter strip is refused, and init still works", async () => {
  // A pack is data, and bad data is reported and skipped — never a crash, and
  // never a project carrying a width `toony validate` would reject.
  await installPack({
    genres: [{ id: "noir", title: "Noir", file: "genres/noir.json", gutterBandWidth: 4 }],
  });
  const c = capture();
  assert.equal(await runInit(["my-story", "--genre", "noir"], c.io), EXIT_USAGE);
  assert.match(c.err.join("\n"), /pack\.genre\.gutter-band-width/);
  assert.match(c.err.join("\n"), /unknown genre "noir"/);

  // The built-in genres are untouched by the bad pack.
  const ok = capture();
  assert.equal(await runInit(["plan-b", "--genre", "thriller"], ok.io), EXIT_OK, ok.err.join("\n"));
  const webtoon = JSON.parse(await readFile(join(workdir, "plan-b", "webtoon.json"), "utf8"));
  assert.equal("gutterBandWidth" in webtoon, false);
});
