// `toony generate` end-to-end through the CLI. A throwaway local HTTP server
// stands in for the operator's ComfyUI install (it is a test fixture, not a
// runtime stub): it answers /prompt, /history, and /view exactly as ComfyUI's
// documented API does, so the command exercises the real provider + ingest path.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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

// A minimal ComfyUI-compatible server for one generation.
async function startFakeComfy(image: Uint8Array): Promise<{ url: string; close: () => void }> {
  const server: Server = createServer((req, res) => {
    const url = req.url ?? "";
    if (req.method === "POST" && url === "/prompt") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ prompt_id: PROMPT_ID, node_errors: {} }));
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
  const c = capture({ TOONY_COMFYUI_URL: "http://127.0.0.1:8188" });
  const code = await runGenerate(
    [projectDir, "--episode", "ep-001", "--cut", "cut-001", "--prompt", "x"],
    c.io,
  );
  assert.equal(code, EXIT_USAGE);
  assert.match(c.err.join("\n"), /--allow-remote/);
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
