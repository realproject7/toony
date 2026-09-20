// `toony generate` end-to-end through the CLI. A throwaway local HTTP server
// stands in for the operator's ComfyUI install (it is a test fixture, not a
// runtime stub): it answers /prompt, /history, and /view exactly as ComfyUI's
// documented API does, so the command exercises the real provider + ingest path.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import { locateIssue } from "../generate-gate.js";

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

/** Append a well-formed cut that the episode sequence does not name yet. */
async function authorUnsequencedCut(projectDir: string): Promise<void> {
  const cutsPath = join(projectDir, "episodes", "ep-001", "cuts.yaml");
  const existing = await readFile(cutsPath, "utf8");
  await writeFile(
    cutsPath,
    `${existing.trimEnd()}\n- id: cut-003\n  image: null\n  imagePrompt: a new scene\n  negativePrompt: ""\n`,
  );
}

test("a cut written but not yet sequenced WARNS and generates (#261)", async () => {
  // The state the refusal must not block. Appending a finished cut and not yet
  // wiring it into the sequence is one ordinary authoring step, and refusing on
  // it made the whole project unreachable: the new cut, the long-finished
  // cut-001, and every transition, all refused at once.
  const projectDir = await scaffold();
  await authorUnsequencedCut(projectDir);
  const comfy = await startFakeComfy(pngWithText());
  try {
    // `toony validate` does reject it — that is the whole point of the case.
    const validate = capture();
    assert.equal(await runValidate([projectDir], validate.io), EXIT_VALIDATION);
    assert.match(validate.out.join("\n"), /\[cut\.orphan\]/);

    for (const [what, args] of [
      ["the new cut", ["--cut", "cut-003"]],
      ["a wired cut", ["--cut", "cut-001", "--prompt", "x"]],
      ["a transition", ["--transition", "tr-001", "--prompt", "x"]],
    ] as const) {
      const before = comfy.calls();
      const c = capture({ TOONY_COMFYUI_URL: comfy.url });
      const code = await runGenerate(
        [projectDir, "--episode", "ep-001", ...args, "--allow-remote"],
        c.io,
      );
      assert.equal(code, EXIT_OK, `${what}: ${c.err.join("\n")}`);
      assert.equal(comfy.calls() - before, 1, `${what} did not reach the generator`);
      // Loud, not silent: the run names what is unwired on stderr.
      assert.match(c.err.join("\n"), /warning: 1 unwired reference\(s\)/, what);
      assert.match(c.err.join("\n"), /\[cut\.orphan\] episodes\[0\]\.cuts/, what);
    }
  } finally {
    comfy.close();
  }
});

test("every wiring code warns, and an off-list code still refuses (#261)", async () => {
  // The allowlist is by exact code and FAILS CLOSED, so both halves need pinning
  // on the same suite: each wiring state proceeds, and one data defect alongside
  // it refuses the whole run.
  const projectDir = await scaffold();
  const episodeDir = join(projectDir, "episodes", "ep-001");
  const pristine = {
    cuts: await readFile(join(episodeDir, "cuts.yaml"), "utf8"),
    episode: await readFile(join(episodeDir, "episode.yaml"), "utf8"),
    transitions: await readFile(join(episodeDir, "transitions.yaml"), "utf8"),
    lettering: await readFile(join(episodeDir, "lettering.json"), "utf8"),
  };
  const restore = async () => {
    await writeFile(join(episodeDir, "cuts.yaml"), pristine.cuts);
    await writeFile(join(episodeDir, "episode.yaml"), pristine.episode);
    await writeFile(join(episodeDir, "transitions.yaml"), pristine.transitions);
    await writeFile(join(episodeDir, "lettering.json"), pristine.lettering);
  };
  /** Insert sequence entries just above the `title:` line. */
  const sequence = async (lines: string[]) => {
    const rows = pristine.episode.split("\n");
    const at = rows.findIndex((row) => row.startsWith("title:"));
    rows.splice(at, 0, ...lines);
    await writeFile(join(episodeDir, "episode.yaml"), rows.join("\n"));
  };
  const WIRING: [string, string, () => Promise<void>][] = [
    ["cut.orphan", "cut.orphan", () => authorUnsequencedCut(projectDir)],
    [
      "transition.orphan",
      "transition.orphan",
      async () =>
        writeFile(
          join(episodeDir, "transitions.yaml"),
          `${pristine.transitions.trimEnd()}\n- agentNote: null\n  gutterHeight: 48\n  humanNote: null\n  id: tr-002\n  image: null\n  reviewStatus: draft\n  sfx: null\n  text: null\n  type: gutter\n`,
        ),
    ],
    [
      "sequence.missing-cut",
      "sequence.missing-cut",
      () => sequence(["  - id: cut-009", "    type: cut"]),
    ],
    [
      "sequence.missing-transition",
      "sequence.missing-transition",
      // Swapping the sequenced id leaves tr-001 unreferenced too, so this row
      // covers a missing transition AND an orphaned one in one project.
      async () =>
        writeFile(
          join(episodeDir, "episode.yaml"),
          pristine.episode.replace("id: tr-001", "id: tr-009"),
        ),
    ],
    [
      "overlay.missing-cut",
      "overlay.missing-cut",
      async () =>
        writeFile(
          join(episodeDir, "lettering.json"),
          JSON.stringify([
            {
              id: "ov-9",
              cutId: "cut-404",
              speaker: "Mina",
              kind: "speech",
              text: "hi",
              font: "Nanum Gothic",
              fill: "#ffffff",
              opacity: 1,
              border: { width: 2, color: "#101010" },
              tail: { x: 0.4, y: 0.7 },
              geometry: { x: 0.1, y: 0.1, width: 0.3, height: 0.1 },
              overflow: false,
              reviewStatus: "draft",
            },
          ]),
        ),
    ],
  ];

  const comfy = await startFakeComfy(pngWithText());
  try {
    for (const [name, code, author] of WIRING) {
      await restore();
      await author();
      // The state really is invalid, and really does carry this code — without
      // this the run below could be passing because the project is simply valid.
      const validate = capture();
      assert.equal(await runValidate([projectDir], validate.io), EXIT_VALIDATION, name);
      assert.match(validate.out.join("\n"), new RegExp(`\\[${code.replace(".", "\\.")}\\]`), name);

      const before = comfy.calls();
      const c = capture({ TOONY_COMFYUI_URL: comfy.url });
      const exit = await runGenerate(
        [projectDir, "--episode", "ep-001", "--cut", "cut-001", "--prompt", "x", "--allow-remote"],
        c.io,
      );
      assert.equal(exit, EXIT_OK, `${name} refused: ${c.err.join("\n")}`);
      assert.equal(comfy.calls() - before, 1, `${name} did not reach the generator`);
      assert.match(c.err.join("\n"), /warning: \d+ unwired reference\(s\)/, name);

      // Now add ONE data defect on top. The allowlist must not rescue it.
      const cuts = await readFile(join(episodeDir, "cuts.yaml"), "utf8");
      await writeFile(
        join(episodeDir, "cuts.yaml"),
        cuts.replace("- id: cut-001", "- id: cut-001\n  shotType: not_a_shot_type"),
      );
      const stillBefore = comfy.calls();
      const blocked = capture({ TOONY_COMFYUI_URL: comfy.url });
      const blockedExit = await runGenerate(
        [projectDir, "--episode", "ep-001", "--cut", "cut-001", "--prompt", "x", "--allow-remote"],
        blocked.io,
      );
      assert.equal(blockedExit, EXIT_VALIDATION, `${name} + a data defect was not refused`);
      assert.equal(comfy.calls() - stillBefore, 0, `${name} + a data defect reached the generator`);
      assert.match(blocked.err.join("\n"), /nothing was generated/, name);
      // The wiring issue is still reported — refusing does not hide it.
      assert.match(blocked.err.join("\n"), new RegExp(`\\[${code.replace(".", "\\.")}\\]`), name);
    }
  } finally {
    comfy.close();
  }
});

test("a brand-new episode does not make the finished one unreachable (#261)", async () => {
  // `sequence.empty` is not a rule about a finished episode: it is an episode
  // nobody has written into yet, the purest "incomplete, not invalid" state the
  // schema has. Creating ep-002 correctly — all four files, right shapes, an
  // empty sequence — used to refuse generation in ep-001 as well, and there is
  // no edit that fixes it without writing the episode.
  const projectDir = await scaffold();
  const newEpisode = join(projectDir, "episodes", "ep-002");
  await mkdir(newEpisode, { recursive: true });
  await writeFile(
    join(newEpisode, "episode.yaml"),
    "id: ep-002\nschemaVersion: 1\nsequence: []\ntitle: Episode 2\n",
  );
  await writeFile(join(newEpisode, "cuts.yaml"), "[]\n");
  await writeFile(join(newEpisode, "transitions.yaml"), "[]\n");
  await writeFile(join(newEpisode, "lettering.json"), "[]\n");

  const comfy = await startFakeComfy(pngWithText());
  try {
    const validate = capture();
    assert.equal(await runValidate([projectDir], validate.io), EXIT_VALIDATION);
    assert.match(validate.out.join("\n"), /\[sequence\.empty\] episodes\[1\]\.sequence/);

    // The FINISHED episode still generates. This is the blast radius that
    // defined the original finding.
    const c = capture({ TOONY_COMFYUI_URL: comfy.url });
    const code = await runGenerate(
      [projectDir, "--episode", "ep-001", "--cut", "cut-001", "--prompt", "x", "--allow-remote"],
      c.io,
    );
    assert.equal(code, EXIT_OK, c.err.join("\n"));
    assert.equal(comfy.calls(), 1, "the finished episode did not reach the generator");
    assert.match(c.err.join("\n"), /\[sequence\.empty\]/);
  } finally {
    comfy.close();
  }
});

test("the excluded reading-order rules still REFUSE (#261)", async () => {
  // The allowlist can only shrink safely. Removing a code breaks a row above;
  // ADDING one broke nothing, so the list could quietly grow to swallow the
  // exclusions the module documents as deliberate. These rows are the cost that
  // was chosen, and they are what notices if someone widens the list.
  const projectDir = await scaffold();
  const episodePath = join(projectDir, "episodes", "ep-001", "episode.yaml");
  const pristine = await readFile(episodePath, "utf8");
  const comfy = await startFakeComfy(pngWithText());
  try {
    for (const [code, rows] of [
      // ...cut-002, tr-002 — an episode that ends on a transition.
      ["sequence.trailing-transition", ["  - id: tr-002", "    type: transition"]],
      // tr-002 first — an episode that begins with one.
      ["sequence.leading-transition", ["  - id: tr-002", "    type: transition"]],
    ] as const) {
      const lines = pristine.split("\n");
      const at =
        code === "sequence.trailing-transition"
          ? lines.findIndex((l) => l.startsWith("title:"))
          : lines.findIndex((l) => l.trim() === "sequence:") + 1;
      lines.splice(at, 0, ...rows);
      await writeFile(episodePath, lines.join("\n"));
      // tr-002 needs a record, or `sequence.missing-transition` (which IS
      // allowlisted) would be doing the refusing instead of the rule under test.
      const transitionsPath = join(projectDir, "episodes", "ep-001", "transitions.yaml");
      const transitions = await readFile(transitionsPath, "utf8");
      await writeFile(
        transitionsPath,
        `${transitions.trimEnd()}\n- agentNote: null\n  gutterHeight: 48\n  humanNote: null\n  id: tr-002\n  image: null\n  reviewStatus: draft\n  sfx: null\n  text: null\n  type: gutter\n`,
      );

      const validate = capture();
      assert.equal(await runValidate([projectDir], validate.io), EXIT_VALIDATION, code);
      const report = validate.out.join("\n");
      assert.match(report, new RegExp(`\\[${code.replace(/\./g, "\\.")}\\]`), code);

      const before = comfy.calls();
      const c = capture({ TOONY_COMFYUI_URL: comfy.url });
      const exit = await runGenerate(
        [projectDir, "--episode", "ep-001", "--cut", "cut-001", "--prompt", "x", "--allow-remote"],
        c.io,
      );
      assert.equal(exit, EXIT_VALIDATION, `${code} was not refused: ${c.err.join("\n")}`);
      assert.equal(comfy.calls() - before, 0, `${code} reached the generator`);

      await writeFile(episodePath, pristine);
      await writeFile(transitionsPath, transitions);
    }
  } finally {
    comfy.close();
  }
});

test("a bundle-shaped path never claims an existing sequence is absent (#261)", async () => {
  // `validateSequenceIntegrity` builds `episodes[i].sequence` from the BUNDLE
  // path, but the loaded project keeps it at `episodes[i].episode.sequence`.
  // Read naively, `"sequence" in bundle` is false and the run printed
  // "episodes[1].sequence is absent" — which is false; it is []. A wrong line is
  // worse than no line, and for `sequence.empty` "absent" and "empty" are
  // different fixes.
  const project = {
    webtoon: { characters: [{ id: "mina", name: "Mina" }] },
    episodes: [
      { episode: { id: "ep-001", sequence: [{ id: "tr-001", type: "transition" }] }, cuts: [] },
      { episode: { id: "ep-002", sequence: [] }, cuts: [] },
    ],
  } as unknown as Parameters<typeof locateIssue>[0];

  for (const path of [
    "episodes[1].sequence", // sequence.empty
    "episodes[0].sequence", // sequence.leading-transition / trailing-transition
  ]) {
    const located = locateIssue(project, { path, code: "sequence.empty", message: "" });
    // The hop resolves these to the ARRAY they really are, and an array
    // declines — so the outcome is "no line". `notEqual` alone would pass for a
    // walker that had simply stopped working, so pin the exact outcome.
    assert.equal(located, null, `${path} resolved to ${JSON.stringify(located)}`);
  }
  // The hop is scoped to `sequence`, so a genuinely missing field still reads as
  // absent — the misspelled-key affordance must survive the fix. This is also
  // what proves the walker still resolves at all.
  const missing = locateIssue(project, {
    path: "webtoon.characters[0].lockstring",
    code: "field.required",
    message: "",
  });
  assert.equal(missing?.value, "absent");
  assert.equal(missing?.recordId, "mina");
});

test("a refusal alongside a sequence rule prints no false absence (#261)", async () => {
  // The end-to-end half: `sequence.trailing-transition` refuses, so its path
  // reaches `authoredValueLines` for real. Before the bundle hop this printed
  // "episodes[0].sequence is absent" — false, and pointing at a different edit
  // than the one an author needs.
  const projectDir = await scaffold();
  const episodePath = join(projectDir, "episodes", "ep-001", "episode.yaml");
  const lines = (await readFile(episodePath, "utf8")).split("\n");
  lines.splice(
    lines.findIndex((l) => l.startsWith("title:")),
    0,
    "  - id: tr-002",
    "    type: transition",
  );
  await writeFile(episodePath, lines.join("\n"));
  const transitionsPath = join(projectDir, "episodes", "ep-001", "transitions.yaml");
  await writeFile(
    transitionsPath,
    `${(await readFile(transitionsPath, "utf8")).trimEnd()}\n- agentNote: null\n  gutterHeight: 48\n  humanNote: null\n  id: tr-002\n  image: null\n  reviewStatus: draft\n  sfx: null\n  text: null\n  type: gutter\n`,
  );
  // A second, ordinary defect, so the "as authored" block is definitely being
  // produced — without this the absence check below could pass vacuously.
  const cutsPath = join(projectDir, "episodes", "ep-001", "cuts.yaml");
  await writeFile(
    cutsPath,
    (await readFile(cutsPath, "utf8")).replace(
      "- id: cut-001",
      "- id: cut-001\n  shotType: not_a_shot_type",
    ),
  );

  const comfy = await startFakeComfy(pngWithText());
  try {
    const c = capture({ TOONY_COMFYUI_URL: comfy.url });
    const code = await runGenerate(
      [projectDir, "--episode", "ep-001", "--cut", "cut-001", "--prompt", "x", "--allow-remote"],
      c.io,
    );
    assert.equal(code, EXIT_VALIDATION, c.err.join("\n"));
    const err = c.err.join("\n");
    // The rule fired and is reported...
    assert.match(err, /\[sequence\.trailing-transition\] episodes\[0\]\.sequence/);
    // ...the "as authored" block is present and correct for the other issue...
    assert.ok(
      err.includes('episodes[0].cuts[0].shotType (cut-001) is "not_a_shot_type"'),
      `no as-authored block to check against:\n${err}`,
    );
    // ...and nothing claims the sequence is missing, because it is not.
    assert.doesNotMatch(err, /episodes\[0\]\.sequence.* is absent/, err);
  } finally {
    comfy.close();
  }
});

test("the refusal names the VALUE as authored, not just the rule (#261)", async () => {
  // A quoted number is the case that bites: the validator says "panelAspect must
  // be a number between 0.1 and 10", the author looks at `cuts.yaml`, sees
  // `panelAspect: "1.4"` — and it IS a number between 0.1 and 10. The quotes are
  // the entire defect. #237 had a hand-written affordance for exactly this and
  // it must not be lost to the generic report.
  const projectDir = await scaffold();
  const cutsPath = join(projectDir, "episodes", "ep-001", "cuts.yaml");
  const comfy = await startFakeComfy(pngWithText());
  try {
    for (const [authored, shown] of [
      ['"1.4"', '"1.4"'],
      [".nan", "NaN"],
      [".inf", "Infinity"],
      ['"tall"', '"tall"'],
      ["0", "0"],
    ] as const) {
      await writeFile(
        cutsPath,
        [
          "- id: cut-001",
          "  image: null",
          "  imagePrompt: a stored scene",
          '  negativePrompt: ""',
          "- id: cut-002",
          "  image: null",
          '  imagePrompt: ""',
          '  negativePrompt: ""',
          `  panelAspect: ${authored}`,
          "",
        ].join("\n"),
      );
      const c = capture({ TOONY_COMFYUI_URL: comfy.url });
      const code = await runGenerate(
        [projectDir, "--episode", "ep-001", "--cut", "cut-001", "--prompt", "x", "--allow-remote"],
        c.io,
      );
      assert.equal(code, EXIT_VALIDATION, `${authored}: ${c.err.join("\n")}`);
      assert.equal(comfy.calls(), 0, `${authored} reached the generator`);
      // The cut's id and the value exactly as written, quotes and all.
      assert.ok(
        c.err.join("\n").includes(`episodes[0].cuts[1].panelAspect (cut-002) is ${shown}`),
        `${authored} printed as: ${c.err.join("\n")}`,
      );
    }
    // A field whose key is misspelled reads as absent — the one thing its
    // "must be a non-empty string" message cannot say.
    await writeFile(
      cutsPath,
      [
        "- id: cut-001",
        "  image: null",
        "  imagePrompt: a stored scene",
        '  negativePrompt: ""',
        "  characters:",
        "    - mina",
        "- id: cut-002",
        "  image: null",
        '  imagePrompt: ""',
        '  negativePrompt: ""',
        "",
      ].join("\n"),
    );
    await writeFile(
      join(projectDir, "webtoon.json"),
      JSON.stringify({
        ...JSON.parse(await readFile(join(projectDir, "webtoon.json"), "utf8")),
        characters: [{ id: "mina", name: "Mina", lockstrng: "short black bob" }],
      }),
    );
    const c = capture({ TOONY_COMFYUI_URL: comfy.url });
    const code = await runGenerate(
      [projectDir, "--episode", "ep-001", "--cut", "cut-001", "--prompt", "x", "--allow-remote"],
      c.io,
    );
    assert.equal(code, EXIT_VALIDATION, c.err.join("\n"));
    assert.ok(
      c.err.join("\n").includes("webtoon.characters[0].lockstring (mina) is absent"),
      c.err.join("\n"),
    );
  } finally {
    comfy.close();
  }
});

test("the gate sits below the flag checks and above planning (#261)", async () => {
  // Error PRECEDENCE, which nothing else pins: three placements of the gate all
  // refuse an invalid project and all send nothing, so only the message an
  // author actually gets tells them apart.
  const projectDir = await scaffold();
  await authorInvalidProject(projectDir);
  const comfy = await startFakeComfy(pngWithText());
  try {
    // BELOW the flag checks: a bad flag is still a usage error, not a
    // validation report about an unrelated field.
    const slot = capture({ TOONY_COMFYUI_URL: comfy.url });
    assert.equal(
      await runGenerate(
        [projectDir, "--episode", "ep-001", "--cut", "cut-001", "--slot", "bogus"],
        slot.io,
      ),
      EXIT_USAGE,
    );
    assert.match(slot.err.join("\n"), /--slot must be/);
    assert.doesNotMatch(slot.err.join("\n"), /\[cut\.shot-type\]/);

    // `--slot` is checked before the project path is even resolved, so it
    // cannot tell a gate placed just below that point from one placed just
    // above the size flags. `--seed` is parsed AFTER the path, and is what
    // separates them.
    const seed = capture({ TOONY_COMFYUI_URL: comfy.url });
    assert.equal(
      await runGenerate(
        // Not "-1": the value guard rejects a leading dash at parse time, which
        // is above the path resolution too. A non-integer reaches the check.
        [projectDir, "--episode", "ep-001", "--cut", "cut-001", "--seed", "1.5", "--allow-remote"],
        seed.io,
      ),
      EXIT_USAGE,
    );
    assert.match(seed.err.join("\n"), /--seed must be a non-negative integer/);
    assert.doesNotMatch(seed.err.join("\n"), /\[cut\.shot-type\]/);

    // ABOVE planJobs: an invalid project with no usable prompt is named as
    // invalid, not as a missing --prompt.
    const prompt = capture({ TOONY_COMFYUI_URL: comfy.url });
    assert.equal(
      await runGenerate(
        [projectDir, "--episode", "ep-001", "--cut", "cut-002", "--allow-remote"],
        prompt.io,
      ),
      EXIT_VALIDATION,
    );
    assert.match(prompt.err.join("\n"), /\[cut\.shot-type\]/);
    assert.doesNotMatch(prompt.err.join("\n"), /has neither/);

    // ABOVE applyPanelShapes: a workflow with no latent width would fail shape
    // resolution with exit 2; the invalid project is reported first, with 1.
    const workflowPath = join(projectDir, "no-latent.workflow.json");
    await writeFile(
      workflowPath,
      JSON.stringify({
        "1": { class_type: "CLIPTextEncode", inputs: { text: "" } },
        "9": { class_type: "SaveImage", inputs: { filename_prefix: "toony", images: ["1", 0] } },
      }),
    );
    const cutsPath = join(projectDir, "episodes", "ep-001", "cuts.yaml");
    const cuts = await readFile(cutsPath, "utf8");
    await writeFile(cutsPath, cuts.replace("- id: cut-001", "- id: cut-001\n  panelAspect: 1.5"));
    const shape = capture({
      TOONY_COMFYUI_URL: comfy.url,
      TOONY_COMFYUI_WORKFLOW: workflowPath,
    });
    assert.equal(
      await runGenerate(
        [projectDir, "--episode", "ep-001", "--cut", "cut-001", "--allow-remote"],
        shape.io,
      ),
      EXIT_VALIDATION,
    );
    assert.match(shape.err.join("\n"), /\[cut\.shot-type\]/);
    assert.doesNotMatch(shape.err.join("\n"), /column to size it against/);

    assert.equal(comfy.calls(), 0, "a placement probe reached the generator");
  } finally {
    comfy.close();
  }
});

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
// commit 3de40da, and re-recorded unchanged at 5785a4e after main moved on —
// the tree BEFORE this ticket's gate existed. Recorded through
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
      // ...and the value as authored, which the schema's message cannot give.
      // `.nan` and `.inf` must name themselves rather than print as `null`, and
      // a quoted number must keep its quotes — those are the rows #237 carried
      // and the report on its own does not replace.
      const shown = { ".nan": "NaN", ".inf": "Infinity" }[authored] ?? authored;
      assert.ok(
        c.err.join("\n").includes(`(cut-001) is ${shown}`),
        `${authored} printed as: ${c.err.join("\n")}`,
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
