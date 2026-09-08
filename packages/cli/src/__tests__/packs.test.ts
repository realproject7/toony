// The pack seam, end to end through the CLI (#192), and the regression bar that
// guards it: with no packs installed, `toony init`, `toony generate`, and
// `toony export` must behave exactly as they did before the seam existed.
//
// "Exactly" is pinned, not asserted. INIT_TREE_DIGESTS below were computed by
// running the CLI on `main` at af8bd07 — the commit this work branched from,
// before any of this existed — hashing every byte of every file `toony init`
// writes. If a change to the seam perturbs a single byte of a scaffolded
// project, these fail. A deliberate future change to a genre or to the on-disk
// format is expected to update them; an accidental one is not.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { runExport } from "../commands/export.js";
import { runGenerate } from "../commands/generate.js";
import { runInit } from "../commands/init.js";
import { runLint } from "../commands/lint.js";
import { runValidate } from "../commands/validate.js";
import { EXIT_OK, EXIT_USAGE } from "../exit.js";

/** Tree digest of `toony init` output, per `--genre`, as of main@af8bd07. */
const INIT_TREE_DIGESTS: Record<string, string> = {
  "": "ffc46179e61e1bc9011d4a944dedf058224f6bf6999fa6c257eee53f26165a45",
  romance: "2530ba07b1827371406f998de7978b825d9b4f4bb456af987df55ff451fce906",
  comedy: "2c958b5a4ad155766f846e0175266172d04c91cdda227cab5b70f967677ca97b",
  action: "7b80a85d9f52baee4dff851bfaff41261384431cfc71e518a1d4d3c3b6084660",
  thriller: "b9e165d93b2401554aa15309a30127caeef208b758969a01738b655e8c06fb58",
  "slice-of-life": "c5e63237b5af157677373735e02263f097cbe5830b8bf7ed09c788545f4ae9d7",
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
      `init${genre ? ` --genre ${genre}` : ""} output changed from main@af8bd07`,
    );
    await rm(join(workdir, "demo"), { recursive: true, force: true });
  }
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
const ONE_PIXEL_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108020000009077" +
    "3dfa0000000c4944415408d763f8cfc0000003010100b7b8b7bf0000000049454e44ae426082",
  "hex",
);

async function startFakeComfy(): Promise<{
  url: string;
  close: () => void;
  lastPrompt: () => Record<string, unknown> | null;
}> {
  let lastPrompt: Record<string, unknown> | null = null;
  const server: Server = createServer((req, res) => {
    const url = req.url ?? "";
    if (req.method === "POST" && url === "/prompt") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        lastPrompt = JSON.parse(Buffer.concat(chunks).toString("utf8"));
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
  };
}
