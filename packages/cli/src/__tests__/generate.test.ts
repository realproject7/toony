// `toony generate` end-to-end through the CLI. A throwaway local HTTP server
// stands in for the operator's ComfyUI install (it is a test fixture, not a
// runtime stub): it answers /prompt, /history, and /view exactly as ComfyUI's
// documented API does, so the command exercises the real provider + ingest path.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { writeConfig } from "@toony/project-io";
import { runGenerate } from "../commands/generate.js";
import { runInit } from "../commands/init.js";
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

function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}
function pngChunk(type: string, data: number[]): number[] {
  return [...u32be(data.length), ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
}
function pngWithText(): Uint8Array {
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...pngChunk("IHDR", [...u32be(1), ...u32be(1), 8, 2, 0, 0, 0]),
    ...pngChunk("tEXt", [...[..."owner serial 99"].map((c) => c.charCodeAt(0))]),
    ...pngChunk("IDAT", [0x08, 0x1d, 0x01]),
    ...pngChunk("IEND", []),
  ]);
}

const PROMPT_ID = "abcd-1234";

// A minimal ComfyUI-compatible server.
//
// `prompts()` reports every positive prompt Toony injected into the graph, in
// submission order, so prompt composition is asserted on what left the process
// rather than on the command's own report of it. A run now submits once per cut
// (#204), so the list is per cut. `rejectCall` is the 1-based index of the
// /prompt submission it refuses, which is how a mid-run failure is reproduced:
// the real one fails per request, not per process.
//
// `latents()` reports the EmptyLatentImage size of every submission for the same
// reason: a declared panel shape (#237) is only wired up if the size it implies
// is what actually left the process, and the command's own report of it would
// not show a shape that was dropped between the plan and the request.
//
// `bodies()` reports every POST /prompt body VERBATIM, as the bytes arrived, for
// the back-compat criterion of #261: the only way to show a valid project still
// generates exactly as it did is to compare the request that left the process,
// not to read the diff.
async function startFakeComfy(
  image: Uint8Array,
  rejectCall?: number,
): Promise<{
  url: string;
  close: () => void;
  prompts: () => string[];
  latents: () => { width: unknown; height: unknown }[];
  bodies: () => string[];
  calls: () => number;
}> {
  const prompts: string[] = [];
  const latents: { width: unknown; height: unknown }[] = [];
  const bodies: string[] = [];
  let calls = 0;
  const server: Server = createServer((req, res) => {
    const url = req.url ?? "";
    if (req.method === "POST" && url === "/prompt") {
      calls++;
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        bodies.push(raw);
        const body = JSON.parse(raw) as {
          prompt?: Record<string, { inputs?: Record<string, unknown> }>;
        };
        const text = body.prompt?.["6"]?.inputs?.text;
        if (typeof text === "string") prompts.push(text);
        const latent = body.prompt?.["5"]?.inputs ?? {};
        latents.push({ width: latent.width, height: latent.height });
        res.setHeader("content-type", "application/json");
        res.end(
          calls === rejectCall
            ? JSON.stringify({ error: { message: "out of memory" } })
            : JSON.stringify({ prompt_id: PROMPT_ID, node_errors: {} }),
        );
      });
      return;
    }
    if (req.method === "GET" && url.startsWith(`/history/`)) {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          [PROMPT_ID]: {
            outputs: { "9": { images: [{ filename: "out.png", subfolder: "", type: "output" }] } },
            status: { status_str: "success", completed: true },
          },
        }),
      );
      return;
    }
    if (req.method === "GET" && url.startsWith("/view")) {
      res.setHeader("content-type", "image/png");
      res.end(Buffer.from(image));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => server.close(),
    prompts: () => [...prompts],
    latents: () => [...latents],
    bodies: () => [...bodies],
    calls: () => calls,
  };
}

async function scaffold(): Promise<string> {
  assert.equal(await runInit(["demo"], capture().io), EXIT_OK);
  return join(workdir, "demo");
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), "toony-gen-"));
});
afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

test("generate produces a cut asset; metadata stripped; project still validates", async () => {
  const projectDir = await scaffold();
  const comfy = await startFakeComfy(pngWithText());
  try {
    const c = capture({ TOONY_COMFYUI_URL: comfy.url });
    const code = await runGenerate(
      [
        projectDir,
        "--episode",
        "ep-001",
        "--cut",
        "cut-001",
        "--slot",
        "clean",
        "--prompt",
        "a hero on a rooftop, webtoon style",
        "--negative",
        "lowres",
        "--width",
        "832",
        "--height",
        "1216",
        "--seed",
        "7",
        "--allow-remote",
      ],
      c.io,
    );
    assert.equal(code, EXIT_OK, c.err.join("\n"));
    assert.match(c.out.join("\n"), /generated episodes\/ep-001\/assets\/clean\/cut-001\.png/);

    const written = await readFile(
      join(projectDir, "episodes", "ep-001", "assets", "clean", "cut-001.png"),
    );
    assert.ok(!Buffer.from(written).toString("latin1").includes("tEXt"));

    const validate = capture();
    assert.equal(await runValidate([projectDir], validate.io), EXIT_OK);
  } finally {
    comfy.close();
  }
});

test("missing endpoint config is a usage error with an actionable message", async () => {
  const projectDir = await scaffold();
  const c = capture({});
  const code = await runGenerate(
    [projectDir, "--episode", "ep-001", "--cut", "cut-001", "--prompt", "x", "--allow-remote"],
    c.io,
  );
  assert.equal(code, EXIT_USAGE);
  assert.match(c.err.join("\n"), /TOONY_COMFYUI_URL/);
});

test("generate reads the endpoint from .toony/config.json when env is unset", async () => {
  const projectDir = await scaffold();
  const comfy = await startFakeComfy(pngWithText());
  try {
    // The Studio settings page writes this file; here we write it directly.
    await writeConfig(projectDir, {
      comfyui: { endpoint: comfy.url, checkpoint: null, workflow: null },
    });
    // No TOONY_COMFYUI_* env at all: resolution must come from the file.
    const c = capture({});
    const code = await runGenerate(
      [
        projectDir,
        "--episode",
        "ep-001",
        "--cut",
        "cut-001",
        "--prompt",
        "a hero on a rooftop",
        "--allow-remote",
      ],
      c.io,
    );
    assert.equal(code, EXIT_OK, c.err.join("\n"));
    assert.match(c.out.join("\n"), /generated episodes\/ep-001\/assets\/clean\/cut-001\.png/);
  } finally {
    comfy.close();
  }
});

test("generate reads .toony/config.json from the workspace root (parent of the work)", async () => {
  const projectDir = await scaffold();
  const comfy = await startFakeComfy(pngWithText());
  try {
    // Studio writes config at the WORKSPACE root, which is the parent of a work.
    await writeConfig(workdir, {
      comfyui: { endpoint: comfy.url, checkpoint: null, workflow: null },
    });
    const c = capture({});
    const code = await runGenerate(
      [projectDir, "--episode", "ep-001", "--cut", "cut-001", "--prompt", "x", "--allow-remote"],
      c.io,
    );
    assert.equal(code, EXIT_OK, c.err.join("\n"));
  } finally {
    comfy.close();
  }
});

test("env endpoint overrides the .toony/config.json endpoint", async () => {
  const projectDir = await scaffold();
  const live = await startFakeComfy(pngWithText());
  try {
    // The file points at a dead port; env points at the live fake server. The
    // command must use the env endpoint (env precedence over the file).
    await writeConfig(projectDir, {
      comfyui: { endpoint: "http://127.0.0.1:1", checkpoint: null, workflow: null },
    });
    const c = capture({ TOONY_COMFYUI_URL: live.url });
    const code = await runGenerate(
      [projectDir, "--episode", "ep-001", "--cut", "cut-001", "--prompt", "x", "--allow-remote"],
      c.io,
    );
    assert.equal(code, EXIT_OK, c.err.join("\n"));
  } finally {
    live.close();
  }
});

test("a remote provider requires --allow-remote", async () => {
  const projectDir = await scaffold();
  // Must be a genuinely non-local endpoint. This test used to point at
  // 127.0.0.1 and still expect the gate to fire, which pinned the #180 defect
  // instead of the rule it names.
  const c = capture({ TOONY_COMFYUI_URL: "https://comfy.example.com" });
  const code = await runGenerate(
    [projectDir, "--episode", "ep-001", "--cut", "cut-001", "--prompt", "x"],
    c.io,
  );
  assert.equal(code, EXIT_USAGE);
  assert.match(c.err.join("\n"), /--allow-remote/);
});

test("a loopback endpoint does not require --allow-remote (#180)", async () => {
  const projectDir = await scaffold();
  const c = capture({ TOONY_COMFYUI_URL: "http://127.0.0.1:8188" });
  const code = await runGenerate(
    [projectDir, "--episode", "ep-001", "--cut", "cut-001", "--prompt", "x"],
    c.io,
  );
  // Nothing is listening in the test environment, so this fails at connect
  // time — which is the point: it got PAST the opt-in gate rather than being
  // refused as a usage error before any request was attempted.
  assert.notEqual(code, EXIT_USAGE);
  assert.doesNotMatch(c.err.join("\n"), /--allow-remote/);
});

test("missing --prompt is a usage error", async () => {
  const projectDir = await scaffold();
  const c = capture({ TOONY_COMFYUI_URL: "http://127.0.0.1:8188" });
  const code = await runGenerate(
    [projectDir, "--episode", "ep-001", "--cut", "cut-001", "--allow-remote"],
    c.io,
  );
  assert.equal(code, EXIT_USAGE);
  assert.match(c.err.join("\n"), /--prompt/);
});

test("an unreachable endpoint is a domain error (exit 1)", async () => {
  const projectDir = await scaffold();
  // Port 1 is reserved and refuses connections.
  const c = capture({ TOONY_COMFYUI_URL: "http://127.0.0.1:1" });
  const code = await runGenerate(
    [projectDir, "--episode", "ep-001", "--cut", "cut-001", "--prompt", "x", "--allow-remote"],
    c.io,
  );
  assert.equal(code, EXIT_VALIDATION);
  assert.match(c.err.join("\n"), /generation failed/);
});

test("an unknown provider is a usage error", async () => {
  const projectDir = await scaffold();
  const c = capture({ TOONY_COMFYUI_URL: "http://127.0.0.1:8188" });
  const code = await runGenerate(
    [
      projectDir,
      "--episode",
      "ep-001",
      "--cut",
      "cut-001",
      "--prompt",
      "x",
      "--provider",
      "ghost",
      "--allow-remote",
    ],
    c.io,
  );
  assert.equal(code, EXIT_USAGE);
  assert.match(c.err.join("\n"), /unknown provider/);
});

/** Give the scaffold's cut-001 a character ref and a palette, and register the
 *  character. The default scaffold declares neither, which is what makes it the
 *  control for "a cut with no palette is unchanged". */
async function authorCraftFields(projectDir: string): Promise<void> {
  await writeFile(
    join(projectDir, "webtoon.json"),
    JSON.stringify({
      ...JSON.parse(await readFile(join(projectDir, "webtoon.json"), "utf8")),
      characters: [{ id: "mina", name: "Mina", lockstring: "short black bob, amber eyes" }],
    }),
  );
  await writeFile(
    join(projectDir, "episodes", "ep-001", "cuts.yaml"),
    [
      "- id: cut-001",
      "  image: null",
      "  imagePrompt: a stored scene",
      '  negativePrompt: ""',
      "  characters:",
      "    - mina",
      '  palette: "#191d28"',
      "- id: cut-002",
      "  image: null",
      '  imagePrompt: ""',
      '  negativePrompt: ""',
      "",
    ].join("\n"),
  );
}

test("a cut's palette reaches the provider as WORDS, appended last (#207)", async () => {
  const projectDir = await scaffold();
  await authorCraftFields(projectDir);
  const comfy = await startFakeComfy(pngWithText());
  try {
    const c = capture({ TOONY_COMFYUI_URL: comfy.url });
    const code = await runGenerate(
      [
        projectDir,
        "--episode",
        "ep-001",
        "--cut",
        "cut-001",
        "--prompt",
        "an explicit scene",
        "--allow-remote",
      ],
      c.io,
    );
    assert.equal(code, EXIT_OK, c.err.join("\n"));
    // One assertion pins the whole composition order: --prompt still beats the
    // stored imagePrompt, the lockstring is still prepended (#92), and the
    // palette clause is appended after both.
    assert.deepEqual(comfy.prompts(), [
      "short black bob, amber eyes, an explicit scene, very dark desaturated azure blue color palette",
    ]);
  } finally {
    comfy.close();
  }
});

// --- The validation gate (#261) ---------------------------------------------
//
// `toony generate` used to throw `loadProject`'s validation report away, so a
// project `toony validate` rejects generated anyway: art written from records
// nobody had checked, and a run that exited 0.

/** Author two problems `toony validate` reports, in two different cuts. */
async function authorInvalidProject(projectDir: string): Promise<void> {
  await writeFile(
    join(projectDir, "episodes", "ep-001", "cuts.yaml"),
    [
      "- id: cut-001",
      "  image: null",
      "  imagePrompt: a stored scene",
      '  negativePrompt: ""',
      "  shotType: not_a_shot_type",
      "- id: cut-002",
      "  image: null",
      '  imagePrompt: ""',
      '  negativePrompt: ""',
      "  characters: 7",
      "",
    ].join("\n"),
  );
}

test("an invalid project is refused and NOTHING is sent to the provider (#261)", async () => {
  const projectDir = await scaffold();
  await authorInvalidProject(projectDir);
  const comfy = await startFakeComfy(pngWithText());
  try {
    // A live, reachable endpoint, so the refusal is the gate and not a
    // misconfiguration the run would have failed on anyway.
    const c = capture({ TOONY_COMFYUI_URL: comfy.url });
    const code = await runGenerate(
      [projectDir, "--episode", "ep-001", "--cut", "cut-001", "--allow-remote"],
      c.io,
    );
    assert.equal(code, EXIT_VALIDATION, c.err.join("\n"));
    // Refused BEFORE the GPU. `calls()` counts submissions, so this is the
    // claim that matters: the run cost nothing.
    assert.equal(comfy.calls(), 0, "an invalid project reached the generator");
    assert.match(c.err.join("\n"), /nothing was generated/);
    // ...and nothing was written into the project either.
    const cuts = await readFile(join(projectDir, "episodes", "ep-001", "cuts.yaml"), "utf8");
    assert.doesNotMatch(cuts, /assets\/clean/);
  } finally {
    comfy.close();
  }
});

test("the refusal prints the report `toony validate` prints, verbatim (#261)", async () => {
  // Not "a message that mentions the issues": the SAME string, from the same
  // function, so an author does not run two commands to learn what is wrong.
  const projectDir = await scaffold();
  await authorInvalidProject(projectDir);
  const comfy = await startFakeComfy(pngWithText());
  try {
    const validate = capture();
    assert.equal(await runValidate([projectDir], validate.io), EXIT_VALIDATION);
    const report = validate.out.join("\n");
    // Guard the guard: a report that named no issues would make the assertion
    // below pass for the wrong reason.
    assert.match(report, /\[cut\.shot-type\] episodes\[0\]\.cuts\[0\]\.shotType/);
    assert.match(report, /\[cut\.characters\] episodes\[0\]\.cuts\[1\]\.characters/);

    const c = capture({ TOONY_COMFYUI_URL: comfy.url });
    await runGenerate(
      [projectDir, "--episode", "ep-001", "--cut", "cut-001", "--allow-remote"],
      c.io,
    );
    assert.ok(
      c.err.includes(report),
      `generate did not print validate's report.\n--- validate ---\n${report}\n--- generate ---\n${c.err.join("\n")}`,
    );
  } finally {
    comfy.close();
  }
});

test("a transition run is refused by the same gate (#261)", async () => {
  // A transition needs no cut data, so this path never loaded the project at
  // all. It still writes into the project through the same ingest path.
  const projectDir = await scaffold();
  await authorInvalidProject(projectDir);
  const comfy = await startFakeComfy(pngWithText());
  try {
    const c = capture({ TOONY_COMFYUI_URL: comfy.url });
    const code = await runGenerate(
      [
        projectDir,
        "--episode",
        "ep-001",
        "--transition",
        "tr-001",
        "--prompt",
        "x",
        "--allow-remote",
      ],
      c.io,
    );
    assert.equal(code, EXIT_VALIDATION, c.err.join("\n"));
    assert.equal(comfy.calls(), 0, "an invalid project reached the generator");
    assert.match(c.err.join("\n"), /\[cut\.shot-type\]/);
  } finally {
    comfy.close();
  }
});

test("an unreadable project is still a usage error, not a validation one (#261)", async () => {
  // The gate must not swallow the load failure `loadProject` throws: a folder
  // that is not a project is a caller mistake (exit 2), not an invalid project.
  const c = capture({ TOONY_COMFYUI_URL: "http://127.0.0.1:8188" });
  const code = await runGenerate(
    [join(workdir, "not-a-project"), "--episode", "ep-001", "--cut", "cut-001", "--prompt", "x"],
    c.io,
  );
  assert.equal(code, EXIT_USAGE, c.err.join("\n"));
});

// The request bodies `origin/main` sent for the VALID project built below, at
// commit 3de40da — the tree BEFORE this ticket's gate existed. Recorded through
// this same fake server and compared byte for byte, because the back-compat
// criterion is about what leaves the process, not about what the diff looks
// like.
//
// Two fields are normalised, and both are random by construction rather than
// derived from the project: `client_id` is a per-request correlation UUID
// (`randomUUID()` in the provider), and the sampler seed is randomised when
// `--seed` is absent, so both runs below pin one.
const MAIN_CLIENT_ID = "<uuid>";
const MAIN_REQUEST_BODIES = [
  '{"prompt":{"3":{"class_type":"KSampler","inputs":{"seed":7,"steps":25,"cfg":7,"sampler_name":"euler","scheduler":"normal","denoise":1,"model":["4",0],"positive":["6",0],"negative":["7",0],"latent_image":["5",0]}},"4":{"class_type":"CheckpointLoaderSimple","inputs":{"ckpt_name":"model.safetensors"}},"5":{"class_type":"EmptyLatentImage","inputs":{"width":832,"height":1248,"batch_size":1}},"6":{"class_type":"CLIPTextEncode","inputs":{"text":"short black bob, amber eyes, a stored scene on a rooftop, very dark desaturated azure blue color palette","clip":["4",1]}},"7":{"class_type":"CLIPTextEncode","inputs":{"text":"lowres","clip":["4",1]}},"8":{"class_type":"VAEDecode","inputs":{"samples":["3",0],"vae":["4",2]}},"9":{"class_type":"SaveImage","inputs":{"filename_prefix":"toony","images":["8",0]}}},"client_id":"<uuid>"}',
  '{"prompt":{"3":{"class_type":"KSampler","inputs":{"seed":11,"steps":25,"cfg":7,"sampler_name":"euler","scheduler":"normal","denoise":1,"model":["4",0],"positive":["6",0],"negative":["7",0],"latent_image":["5",0]}},"4":{"class_type":"CheckpointLoaderSimple","inputs":{"ckpt_name":"model.safetensors"}},"5":{"class_type":"EmptyLatentImage","inputs":{"width":800,"height":1216,"batch_size":1}},"6":{"class_type":"CLIPTextEncode","inputs":{"text":"an explicit scene","clip":["4",1]}},"7":{"class_type":"CLIPTextEncode","inputs":{"text":"","clip":["4",1]}},"8":{"class_type":"VAEDecode","inputs":{"samples":["3",0],"vae":["4",2]}},"9":{"class_type":"SaveImage","inputs":{"filename_prefix":"toony","images":["8",0]}}},"client_id":"<uuid>"}',
];

/** Replace the one genuinely random field so the rest can be compared as bytes. */
function normalizeClientId(body: string): string {
  const parsed = JSON.parse(body) as { client_id?: unknown };
  assert.equal(typeof parsed.client_id, "string", "the request carried no client_id");
  parsed.client_id = MAIN_CLIENT_ID;
  return JSON.stringify(parsed);
}

test("a valid project sends the SAME request bytes as before the gate (#261)", async () => {
  // Every generation input at once, so the comparison covers all of them: a
  // stored prompt (#38), a character lockstring (#92), a palette clause (#207),
  // a declared panel shape (#237), and the explicit-prompt path with --width.
  const projectDir = await scaffold();
  await writeFile(
    join(projectDir, "webtoon.json"),
    JSON.stringify({
      ...JSON.parse(await readFile(join(projectDir, "webtoon.json"), "utf8")),
      characters: [{ id: "mina", name: "Mina", lockstring: "short black bob, amber eyes" }],
    }),
  );
  await writeFile(
    join(projectDir, "episodes", "ep-001", "cuts.yaml"),
    [
      "- id: cut-001",
      "  image: null",
      "  imagePrompt: a stored scene on a rooftop",
      "  negativePrompt: lowres",
      "  characters:",
      "    - mina",
      '  palette: "#191d28"',
      "  panelAspect: 1.5",
      "- id: cut-002",
      "  image: null",
      '  imagePrompt: ""',
      '  negativePrompt: ""',
      "",
    ].join("\n"),
  );
  // The comparison is only worth anything if this project passes the gate.
  const validate = capture();
  assert.equal(await runValidate([projectDir], validate.io), EXIT_OK, validate.out.join("\n"));

  const comfy = await startFakeComfy(pngWithText());
  try {
    const stored = capture({ TOONY_COMFYUI_URL: comfy.url });
    assert.equal(
      await runGenerate(
        [projectDir, "--episode", "ep-001", "--cut", "cut-001", "--seed", "7", "--allow-remote"],
        stored.io,
      ),
      EXIT_OK,
      stored.err.join("\n"),
    );
    const explicit = capture({ TOONY_COMFYUI_URL: comfy.url });
    assert.equal(
      await runGenerate(
        [
          projectDir,
          "--episode",
          "ep-001",
          "--cut",
          "cut-002",
          "--prompt",
          "an explicit scene",
          "--seed",
          "11",
          "--width",
          "800",
          "--allow-remote",
        ],
        explicit.io,
      ),
      EXIT_OK,
      explicit.err.join("\n"),
    );
    assert.deepEqual(comfy.bodies().map(normalizeClientId), MAIN_REQUEST_BODIES);
  } finally {
    comfy.close();
  }
});

// --- Panel shape per cut (#237) ---------------------------------------------
//
// The bundled default workflow's EmptyLatentImage is 832x1216, and these tests
// assert against that pair on purpose: it is the "workflow latent" the ticket's
// back-compat criterion names, and the only way to tell a shape that reached
// generation from one that was dropped is what the latent node received.
const DEFAULT_LATENT = { width: 832, height: 1216 };

/** Rewrite the scaffold's two cuts, giving each the panel shape in `aspects`. */
async function authorPanelShapes(
  projectDir: string,
  aspects: (number | undefined)[],
): Promise<void> {
  const lines = aspects.flatMap((aspect, i) => [
    `- id: cut-00${i + 1}`,
    "  image: null",
    "  imagePrompt: a stored scene",
    '  negativePrompt: ""',
    ...(aspect === undefined ? [] : [`  panelAspect: ${aspect}`]),
  ]);
  await writeFile(join(projectDir, "episodes", "ep-001", "cuts.yaml"), `${lines.join("\n")}\n`);
}

test("a cut that declares no panel shape has NO size injected (#237)", async () => {
  const projectDir = await scaffold();
  const comfy = await startFakeComfy(pngWithText());
  try {
    const c = capture({ TOONY_COMFYUI_URL: comfy.url });
    const code = await runGenerate(
      [projectDir, "--episode", "ep-001", "--cut", "cut-001", "--prompt", "x", "--allow-remote"],
      c.io,
    );
    assert.equal(code, EXIT_OK, c.err.join("\n"));
    // Not "some plausible size": the workflow's own latent, untouched. This is
    // the control the back-compat criterion is about.
    assert.deepEqual(comfy.latents(), [DEFAULT_LATENT]);
  } finally {
    comfy.close();
  }
});

test("a declared panel shape becomes the cut's latent height (#237)", async () => {
  const projectDir = await scaffold();
  await authorPanelShapes(projectDir, [0.62, undefined]);
  const comfy = await startFakeComfy(pngWithText());
  try {
    const c = capture({ TOONY_COMFYUI_URL: comfy.url });
    const code = await runGenerate(
      [projectDir, "--episode", "ep-001", "--cut", "cut-001", "--allow-remote"],
      c.io,
    );
    assert.equal(code, EXIT_OK, c.err.join("\n"));
    // 832 * 0.62 = 515.84, snapped to the 8px latent grid. The column is the
    // workflow's own width, so only the height moved.
    assert.deepEqual(comfy.latents(), [{ width: 832, height: 512 }]);
    // The resolved size is reported, so an operator can see the shape took.
    assert.match(c.out.join("\n"), /cut cut-001 \(clean\) at 832x512/);
  } finally {
    comfy.close();
  }
});

test("each cut in one run is generated at its OWN declared shape (#237)", async () => {
  const projectDir = await scaffold();
  await authorPanelShapes(projectDir, [1.5, 0.5]);
  const comfy = await startFakeComfy(pngWithText());
  try {
    const c = capture({ TOONY_COMFYUI_URL: comfy.url });
    const code = await runGenerate(
      [projectDir, "--episode", "ep-001", "--cut", "cut-001", "--cut", "cut-002", "--allow-remote"],
      c.io,
    );
    assert.equal(code, EXIT_OK, c.err.join("\n"));
    assert.deepEqual(comfy.latents(), [
      { width: 832, height: 1248 },
      { width: 832, height: 416 },
    ]);
  } finally {
    comfy.close();
  }
});

test("--width pins the column a declared shape is a multiple of (#237)", async () => {
  const projectDir = await scaffold();
  await authorPanelShapes(projectDir, [1.5, undefined]);
  const comfy = await startFakeComfy(pngWithText());
  try {
    const c = capture({ TOONY_COMFYUI_URL: comfy.url });
    const code = await runGenerate(
      [projectDir, "--episode", "ep-001", "--cut", "cut-001", "--width", "800", "--allow-remote"],
      c.io,
    );
    assert.equal(code, EXIT_OK, c.err.join("\n"));
    assert.deepEqual(comfy.latents(), [{ width: 800, height: 1200 }]);
  } finally {
    comfy.close();
  }
});

test("--height overrides a declared shape, and the run says so (#237)", async () => {
  const projectDir = await scaffold();
  await authorPanelShapes(projectDir, [1.5, undefined]);
  const comfy = await startFakeComfy(pngWithText());
  try {
    const c = capture({ TOONY_COMFYUI_URL: comfy.url });
    const code = await runGenerate(
      [projectDir, "--episode", "ep-001", "--cut", "cut-001", "--height", "600", "--allow-remote"],
      c.io,
    );
    assert.equal(code, EXIT_OK, c.err.join("\n"));
    assert.deepEqual(comfy.latents(), [{ width: 832, height: 600 }]);
    // A dropped shape that nothing mentions is how `palette` stayed inert for
    // four releases (#207); the override is stated.
    assert.match(c.err.join("\n"), /--height 600 overrides the declared panel shape on 1 cut/);
  } finally {
    comfy.close();
  }
});

test("an out-of-range or non-numeric panel shape is refused, and nothing is generated (#237)", async () => {
  // #237 re-applied the field's bounds inside `applyPanelShapes`, because this
  // command threw `loadProject`'s validation report away and a `panelAspect` the
  // schema rejects still reached the shape resolver. The run's validation gate
  // (#261) is what refuses these now, so that second copy of the bounds is gone
  // — but the OUTCOME this test names must not move: refused before the GPU,
  // exit 1, and a message that says which cut and which field.
  const projectDir = await scaffold();
  const comfy = await startFakeComfy(pngWithText());
  try {
    for (const authored of ["0", "-1", "0.099", "10.001", ".nan", ".inf", '"tall"', '"1.4"']) {
      await authorPanelShapes(projectDir, [authored as unknown as number, undefined]);
      const c = capture({ TOONY_COMFYUI_URL: comfy.url });
      const code = await runGenerate(
        [projectDir, "--episode", "ep-001", "--cut", "cut-001", "--allow-remote"],
        c.io,
      );
      assert.equal(code, EXIT_VALIDATION, `${authored} was not refused: ${c.err.join("\n")}`);
      // Refused BEFORE the GPU, not after: an invalid shape costs nothing.
      assert.deepEqual(comfy.latents(), [], `${authored} reached the generator`);
      assert.match(
        c.err.join("\n"),
        /\[cut\.panel-aspect\] episodes\[0\]\.cuts\[0\]\.panelAspect/,
        `${authored} was refused without naming the field: ${c.err.join("\n")}`,
      );
    }
    // The bounds themselves are INCLUSIVE. They now live in ONE place — the
    // schema — and these two rows are what proves the CLI reads them from there
    // rather than carrying a copy that could drift to exclusive and refuse a
    // project `toony validate` calls valid.
    for (const [authored, height] of [
      ["0.1", 80],
      ["10", 8320],
    ] as const) {
      await authorPanelShapes(projectDir, [authored as unknown as number, undefined]);
      const c = capture({ TOONY_COMFYUI_URL: comfy.url });
      const before = comfy.latents().length;
      const code = await runGenerate(
        [projectDir, "--episode", "ep-001", "--cut", "cut-001", "--allow-remote"],
        c.io,
      );
      assert.equal(code, EXIT_OK, `${authored} was refused: ${c.err.join("\n")}`);
      assert.deepEqual(comfy.latents().slice(before), [{ width: 832, height }]);
    }
    // The refusal runs BEFORE the --height branch, so a bad declaration fails a
    // run that would not have used it. Nothing else pins that placement.
    await authorPanelShapes(projectDir, [".nan" as unknown as number, undefined]);
    {
      const c = capture({ TOONY_COMFYUI_URL: comfy.url });
      const before = comfy.latents().length;
      const code = await runGenerate(
        [
          projectDir,
          "--episode",
          "ep-001",
          "--cut",
          "cut-001",
          "--height",
          "600",
          "--allow-remote",
        ],
        c.io,
      );
      assert.equal(code, EXIT_VALIDATION, c.err.join("\n"));
      assert.deepEqual(comfy.latents().slice(before), []);
    }
    // A bad shape on a cut the run does not even name still refuses it: the gate
    // is project-wide, where #237's guard only saw the jobs in the run.
    await authorPanelShapes(projectDir, [1.5, "0" as unknown as number]);
    {
      const c = capture({ TOONY_COMFYUI_URL: comfy.url });
      const before = comfy.latents().length;
      const code = await runGenerate(
        [projectDir, "--episode", "ep-001", "--cut", "cut-001", "--allow-remote"],
        c.io,
      );
      assert.equal(code, EXIT_VALIDATION, c.err.join("\n"));
      assert.deepEqual(comfy.latents().slice(before), []);
      assert.match(c.err.join("\n"), /\[cut\.panel-aspect\] episodes\[0\]\.cuts\[1\]\.panelAspect/);
    }
  } finally {
    comfy.close();
  }
});

test("a declared shape with no column to resolve against refuses the run (#237)", async () => {
  // The column comes from the workflow's own latent, read through the injection
  // map. Point the map at a node the graph does not have and there is no column:
  // the alternative, falling back to the workflow's latent, would render the
  // page with the pack's pacing quietly removed and cost GPU minutes to find.
  const projectDir = await scaffold();
  await authorPanelShapes(projectDir, [1.5, undefined]);
  const workflowPath = join(projectDir, "no-latent.workflow.json");
  await writeFile(
    workflowPath,
    JSON.stringify({
      "1": { class_type: "CLIPTextEncode", inputs: { text: "" } },
      "9": { class_type: "SaveImage", inputs: { filename_prefix: "toony", images: ["1", 0] } },
    }),
  );
  const comfy = await startFakeComfy(pngWithText());
  try {
    const c = capture({ TOONY_COMFYUI_URL: comfy.url, TOONY_COMFYUI_WORKFLOW: workflowPath });
    const code = await runGenerate(
      [projectDir, "--episode", "ep-001", "--cut", "cut-001", "--allow-remote"],
      c.io,
    );
    assert.equal(code, EXIT_USAGE, c.err.join("\n"));
    assert.deepEqual(comfy.latents(), []);
    assert.match(c.err.join("\n"), /the column to size it against is unknown/);
  } finally {
    comfy.close();
  }
});

/** Arguments for a run over `cutIds`, with a prompt supplied for all of them. */
function multiCutArgs(projectDir: string, cutIds: string[]): string[] {
  return [
    projectDir,
    "--episode",
    "ep-001",
    ...cutIds.flatMap((id) => ["--cut", id]),
    "--prompt",
    "a hero on a rooftop",
    "--allow-remote",
  ];
}

test("a multi-cut run generates every cut and reports a summary (#204)", async () => {
  const projectDir = await scaffold();
  const comfy = await startFakeComfy(pngWithText());
  try {
    const c = capture({ TOONY_COMFYUI_URL: comfy.url });
    const code = await runGenerate(multiCutArgs(projectDir, ["cut-001", "cut-002"]), c.io);
    assert.equal(code, EXIT_OK, c.err.join("\n"));
    const out = c.out.join("\n");
    assert.match(out, /generated episodes\/ep-001\/assets\/clean\/cut-001\.png/);
    assert.match(out, /generated episodes\/ep-001\/assets\/clean\/cut-002\.png/);
    assert.match(out, /^2 generated, 0 failed$/m);
    assert.equal(comfy.calls(), 2);
  } finally {
    comfy.close();
  }
});

test("a cut with no palette sends the prompt unchanged (#207)", async () => {
  const projectDir = await scaffold();
  const comfy = await startFakeComfy(pngWithText());
  try {
    const c = capture({ TOONY_COMFYUI_URL: comfy.url });
    const code = await runGenerate(
      [
        projectDir,
        "--episode",
        "ep-001",
        "--cut",
        "cut-001",
        "--prompt",
        "an explicit scene",
        "--allow-remote",
      ],
      c.io,
    );
    assert.equal(code, EXIT_OK, c.err.join("\n"));
    assert.deepEqual(comfy.prompts(), ["an explicit scene"]);
  } finally {
    comfy.close();
  }
});

test("each cut in a multi-cut run gets its OWN palette clause (#204 + #207)", async () => {
  // The two features meet here: one run, one shared --prompt, and a different
  // colour per cut. A clause built once for the run instead of once per job
  // would send the same prompt twice and this is what would catch it.
  const projectDir = await scaffold();
  await writeFile(
    join(projectDir, "episodes", "ep-001", "cuts.yaml"),
    [
      "- id: cut-001",
      "  image: null",
      '  imagePrompt: ""',
      '  negativePrompt: ""',
      '  palette: "#191d28"',
      "- id: cut-002",
      "  image: null",
      '  imagePrompt: ""',
      '  negativePrompt: ""',
      '  palette: "#f6e3ea"',
      "",
    ].join("\n"),
  );
  const comfy = await startFakeComfy(pngWithText());
  try {
    const c = capture({ TOONY_COMFYUI_URL: comfy.url });
    const code = await runGenerate(multiCutArgs(projectDir, ["cut-001", "cut-002"]), c.io);
    assert.equal(code, EXIT_OK, c.err.join("\n"));
    assert.deepEqual(comfy.prompts(), [
      "a hero on a rooftop, very dark desaturated azure blue color palette",
      "a hero on a rooftop, very light pink color palette",
    ]);
  } finally {
    comfy.close();
  }
});

test("a failed cut is named, exits non-zero, and the finished cuts stay (#204)", async () => {
  const projectDir = await scaffold();
  // The SECOND submission is refused: cut-001 is already on disk by then, which
  // is what "no rollback" has to survive.
  const comfy = await startFakeComfy(pngWithText(), 2);
  try {
    const c = capture({ TOONY_COMFYUI_URL: comfy.url });
    const code = await runGenerate(multiCutArgs(projectDir, ["cut-001", "cut-002"]), c.io);
    assert.equal(code, EXIT_VALIDATION);
    assert.match(c.err.join("\n"), /generation failed for cut-002: .*out of memory/);
    assert.match(c.out.join("\n"), /^1 generated, 1 failed: cut-002$/m);

    // The finished cut survives, in the project as well as on disk.
    const asset = join(projectDir, "episodes", "ep-001", "assets", "clean", "cut-001.png");
    assert.ok((await readFile(asset)).length > 0);
    const cuts = await readFile(join(projectDir, "episodes", "ep-001", "cuts.yaml"), "utf8");
    assert.match(cuts, /assets\/clean\/cut-001\.png/);
    assert.doesNotMatch(cuts, /cut-002\.png/);
  } finally {
    comfy.close();
  }
});

test("a run keeps going after a failure, so a later cut still generates (#204)", async () => {
  const projectDir = await scaffold();
  const comfy = await startFakeComfy(pngWithText(), 1);
  try {
    const c = capture({ TOONY_COMFYUI_URL: comfy.url });
    const code = await runGenerate(multiCutArgs(projectDir, ["cut-001", "cut-002"]), c.io);
    assert.equal(code, EXIT_VALIDATION);
    assert.match(c.out.join("\n"), /^1 generated, 1 failed: cut-001$/m);
    assert.match(c.out.join("\n"), /generated episodes\/ep-001\/assets\/clean\/cut-002\.png/);
  } finally {
    comfy.close();
  }
});

test("a repeated --cut id is generated once (#204)", async () => {
  const projectDir = await scaffold();
  const comfy = await startFakeComfy(pngWithText());
  try {
    const c = capture({ TOONY_COMFYUI_URL: comfy.url });
    const code = await runGenerate(multiCutArgs(projectDir, ["cut-001", "cut-001"]), c.io);
    assert.equal(code, EXIT_OK, c.err.join("\n"));
    assert.equal(comfy.calls(), 1);
    // One job left, so the run reports exactly as a single-cut run always has.
    assert.doesNotMatch(c.out.join("\n"), /generated, .* failed/);
  } finally {
    comfy.close();
  }
});

test("a single --cut prints no summary, exactly as before (#204)", async () => {
  const projectDir = await scaffold();
  const comfy = await startFakeComfy(pngWithText());
  try {
    const c = capture({ TOONY_COMFYUI_URL: comfy.url });
    const code = await runGenerate(multiCutArgs(projectDir, ["cut-001"]), c.io);
    assert.equal(code, EXIT_OK, c.err.join("\n"));
    assert.equal(c.out.length, 2, c.out.join("\n"));
    assert.equal(c.out[1], "next: toony validate");
  } finally {
    comfy.close();
  }
});

test("a cut with no usable prompt aborts before anything is generated (#204)", async () => {
  const projectDir = await scaffold();
  // The scaffold's imagePrompt is empty, so with no --prompt neither cut can
  // run. A usage problem must be found up front, not after minutes of GPU time.
  const comfy = await startFakeComfy(pngWithText());
  try {
    const c = capture({ TOONY_COMFYUI_URL: comfy.url });
    const code = await runGenerate(
      [projectDir, "--episode", "ep-001", "--cut", "cut-001", "--cut", "cut-002", "--allow-remote"],
      c.io,
    );
    assert.equal(code, EXIT_USAGE);
    assert.match(c.err.join("\n"), /--prompt <text>.*cut-001 has neither/);
    assert.equal(comfy.calls(), 0, "nothing may be submitted when the run cannot complete");
  } finally {
    comfy.close();
  }
});

test("generate rejects a flag used as another flag's value (#156)", async () => {
  const c = capture();
  // `--episode --cut ...`: the value guard must reject `--cut` as `--episode`'s
  // value (matching export/import-image), not silently set episode="--cut".
  const code = await runGenerate(["--episode", "--cut", "cut-001", "--prompt", "x"], c.io);
  assert.equal(code, EXIT_USAGE);
  assert.match([...c.out, ...c.err].join("\n"), /--episode requires a value/);
});
