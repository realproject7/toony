// The two #286 decisions on `toony generate`: `--seed fresh` asks for a new roll
// without inventing a number, and a run that replaces authored prompts through
// the write-back says so on one line with the cut ids.

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { loadProject, writeCuts } from "@toony/project-io";
import type { Cut } from "@toony/schema";
import { pngWithText, startFakeComfy } from "../__fixtures__/comfyui-server.js";
import { runGenerate } from "../commands/generate.js";
import { runInit } from "../commands/init.js";
import { EXIT_OK, EXIT_USAGE } from "../exit.js";

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
  workdir = await mkdtemp(join(tmpdir(), "toony-fresh-"));
});
afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

async function scaffold(): Promise<string> {
  assert.equal(await runInit(["demo"], capture().io), EXIT_OK);
  const dir = join(workdir, "demo");
  const loaded = await loadProject(dir);
  const bundle = loaded.project.episodes[0];
  assert.ok(bundle);
  await writeCuts(
    dir,
    bundle.episode.id,
    bundle.cuts.map((cut) => ({ ...cut, imagePrompt: `authored ${cut.id}` })),
  );
  return dir;
}

async function cut(dir: string, id: string): Promise<Cut> {
  const loaded = await loadProject(dir);
  const found = loaded.project.episodes[0]?.cuts.find((c) => c.id === id);
  assert.ok(found);
  return found;
}

test("--seed fresh rolls a new seed per cut and records it; a bare re-run then repeats it", async () => {
  const dir = await scaffold();
  const comfy = await startFakeComfy(pngWithText());
  try {
    const env = { TOONY_COMFYUI_URL: comfy.url };
    const args = [
      dir,
      "--episode",
      "ep-001",
      "--cut",
      "cut-001",
      "--cut",
      "cut-002",
      "--allow-remote",
    ];
    assert.equal(await runGenerate([...args, "--seed", "11"], capture(env).io), EXIT_OK);
    assert.equal((await cut(dir, "cut-001")).imageSeed, 11);
    assert.equal((await cut(dir, "cut-002")).imageSeed, 11);

    const fresh = capture(env);
    assert.equal(
      await runGenerate([...args, "--seed", "fresh"], fresh.io),
      EXIT_OK,
      fresh.err.join("\n"),
    );
    const a = (await cut(dir, "cut-001")).imageSeed;
    const b = (await cut(dir, "cut-002")).imageSeed;
    assert.ok(a !== undefined && a !== 11, "cut-001 kept the old seed");
    assert.ok(b !== undefined && b !== 11, "cut-002 kept the old seed");
    assert.notEqual(a, b, "fresh rolls per cut, not one seed for the whole run");
    // No authored prompt changed, so no rewrite line.
    assert.doesNotMatch(fresh.out.join("\n"), /rewrote the authored prompt/);

    const repeat = capture(env);
    assert.equal(await runGenerate(args, repeat.io), EXIT_OK);
    assert.equal((await cut(dir, "cut-001")).imageSeed, a);
    assert.equal((await cut(dir, "cut-002")).imageSeed, b);
  } finally {
    comfy.close();
  }
});

test("an invalid --seed names the fresh sentinel in its message", async () => {
  const dir = await scaffold();
  const c = capture({});
  assert.equal(
    await runGenerate([dir, "--episode", "ep-001", "--cut", "cut-001", "--seed", "later"], c.io),
    EXIT_USAGE,
  );
  assert.match(c.err.join("\n"), /non-negative integer, or "fresh"/);
});

test("a run that replaces authored prompts says so once, with the ids", async () => {
  const dir = await scaffold();
  const comfy = await startFakeComfy(pngWithText());
  try {
    const env = { TOONY_COMFYUI_URL: comfy.url };
    const c = capture(env);
    assert.equal(
      await runGenerate(
        [
          dir,
          "--episode",
          "ep-001",
          "--cut",
          "cut-001",
          "--cut",
          "cut-002",
          "--prompt",
          "one prompt for both",
          "--allow-remote",
        ],
        c.io,
      ),
      EXIT_OK,
      c.err.join("\n"),
    );
    const lines = c.out.filter((l) => l.startsWith("rewrote the authored prompt"));
    assert.deepEqual(lines, ["rewrote the authored prompt on 2 cut(s): cut-001, cut-002"]);
    assert.equal((await cut(dir, "cut-001")).imagePrompt, "one prompt for both");

    // The same prompt again is not a rewrite.
    const again = capture(env);
    assert.equal(
      await runGenerate(
        [
          dir,
          "--episode",
          "ep-001",
          "--cut",
          "cut-001",
          "--prompt",
          "one prompt for both",
          "--allow-remote",
        ],
        again.io,
      ),
      EXIT_OK,
    );
    assert.doesNotMatch(again.out.join("\n"), /rewrote the authored prompt/);
  } finally {
    comfy.close();
  }
});

test("a first render onto an empty prompt is a write, not a rewrite", async () => {
  const dir = await scaffold();
  const loaded = await loadProject(dir);
  const bundle = loaded.project.episodes[0];
  assert.ok(bundle);
  await writeCuts(
    dir,
    bundle.episode.id,
    bundle.cuts.map((c) => (c.id === "cut-001" ? { ...c, imagePrompt: "" } : c)),
  );
  const comfy = await startFakeComfy(pngWithText());
  try {
    const c = capture({ TOONY_COMFYUI_URL: comfy.url });
    assert.equal(
      await runGenerate(
        [
          dir,
          "--episode",
          "ep-001",
          "--cut",
          "cut-001",
          "--prompt",
          "first words",
          "--allow-remote",
        ],
        c.io,
      ),
      EXIT_OK,
    );
    assert.doesNotMatch(c.out.join("\n"), /rewrote the authored prompt/);
    assert.equal((await cut(dir, "cut-001")).imagePrompt, "first words");
  } finally {
    comfy.close();
  }
});
