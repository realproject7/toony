// `toony produce inspect|run`, the controlled execution loop (#313).
//
// What is proven: the disclosure resolves the same set generate would and
// makes no provider call; a run without an accepted target set stops; a
// revision without a reason stops; a repeat is reported as a repeat; the
// controller writes no review state and no cut field of its own, so a controlled
// run and a plain generate leave identical records; the repeat refusal is
// surfaced and never re-issued; the three uncertainty cases stop with a
// non-zero exit; and a generated-but-unrecorded cut is its own outcome.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { decodeYaml, encodeYaml, loadProject, writeCuts, writeWebtoon } from "@toony/project-io";
import type { Cut } from "@toony/schema";
import { pngWithText, startFakeComfy } from "../__fixtures__/comfyui-server.js";
import { runGenerate } from "../commands/generate.js";
import { runInit } from "../commands/init.js";
import { PRODUCE_LOG_FILE, runProduce } from "../commands/produce.js";
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
  workdir = await mkdtemp(join(tmpdir(), "toony-produce-"));
});
afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

async function scaffold(name = "demo"): Promise<string> {
  assert.equal(await runInit([name], capture().io), EXIT_OK);
  return join(workdir, name);
}

async function cuts(dir: string): Promise<Cut[]> {
  const loaded = await loadProject(dir);
  return loaded.project.episodes.find((e) => e.episode.id === "ep-001")?.cuts ?? [];
}

async function setCuts(dir: string, update: (cut: Cut) => Cut): Promise<void> {
  await writeCuts(dir, "ep-001", (await cuts(dir)).map(update));
}

async function produceLog(dir: string): Promise<Array<Record<string, unknown>>> {
  return JSON.parse(
    await readFile(join(dir, "episodes", "ep-001", "logs", PRODUCE_LOG_FILE), "utf8"),
  );
}

function targetSetOf(out: string[]): string {
  const line = out.find((l) => l.includes("target set "));
  assert.ok(line, out.join("\n"));
  return line.trim().split("target set ")[1]?.split(/\s/)[0] ?? "";
}

for (const cancelSupported of [true, false]) {
  test(`a timeout ${cancelSupported ? "continues only after confirmed cancellation" : "stops before the next cut when cancellation is unavailable"}`, async () => {
    const dir = await scaffold();
    await setCuts(dir, (cut) => ({ ...cut, imagePrompt: "an original fixture scene" }));
    const comfy = await startFakeComfy(pngWithText(), undefined, undefined, {
      call: 1,
      cancelSupported,
    });
    try {
      const env = { TOONY_COMFYUI_URL: comfy.url, TOONY_COMFYUI_TIMEOUT_MS: "100" };
      const inspect = capture(env);
      const targets = [dir, "--episode", "ep-001", "--cut", "cut-001", "--cut", "cut-002"];
      assert.equal(await runProduce(["inspect", ...targets], inspect.io), EXIT_OK);
      const run = capture(env);
      assert.equal(
        await runProduce(["run", ...targets, "--accept", targetSetOf(inspect.out)], run.io),
        EXIT_VALIDATION,
      );
      assert.equal(comfy.calls(), cancelSupported ? 2 : 1);
      assert.match(run.err.join("\n"), /TOONY_COMFYUI_TIMEOUT_MS/);
      const log = await produceLog(dir);
      assert.deepEqual(log[0]?.outcomes, {
        "cut-001": "failed",
        "cut-002": cancelSupported ? "generated" : "not-reached",
      });
      const currentCuts = await cuts(dir);
      assert.equal(currentCuts[0]?.image?.clean ?? null, null);
      if (!cancelSupported) {
        assert.equal(currentCuts[1]?.image?.clean ?? null, null);
        assert.match(run.out.join("\n"), /1 not-reached/);
      }
    } finally {
      comfy.close();
    }
  });
}

test("inspect resolves the set generate would, discloses counts, and calls no provider", async () => {
  const dir = await scaffold();
  // No endpoint configured anywhere: a provider call would be a usage error.
  await setCuts(dir, (cut) =>
    cut.id === "cut-001" ? { ...cut, imagePrompt: "a rooftop", reviewStatus: "final" } : cut,
  );
  const c = capture({});
  const code = await runProduce(
    ["inspect", dir, "--episode", "ep-001", "--cut", "cut-001", "--cut", "cut-002", "--json"],
    c.io,
  );
  const report = JSON.parse(c.out.join("\n"));
  assert.deepEqual(report.targets, ["cut-001", "cut-002"]);
  assert.equal(report.withImage, 0);
  assert.equal(report.withRecordedInputs, 0);
  assert.deepEqual(report.willResetReview, ["cut-001 (final)"]);
  assert.equal(report.valid, true);
  // cut-002 has no prompt, so the run would stop there; inspect says so and exits 1.
  assert.deepEqual(
    report.stops.map((s: { reason: string; target: string }) => [s.reason, s.target]),
    [["no-prompt", "cut-002"]],
  );
  assert.equal(code, EXIT_VALIDATION);

  const clean = capture({});
  assert.equal(
    await runProduce(["inspect", dir, "--episode", "ep-001", "--cut", "cut-001"], clean.io),
    EXIT_OK,
  );
  const text = clean.out.join("\n");
  assert.match(text, /1 target\(s\) in ep-001: cut-001/);
  assert.match(text, /non-draft review the run resets: 1 \(cut-001 \(final\)\)/);
  assert.match(text, /next: toony produce run .*--accept [0-9a-f]{16}/);
});

test("selectors behave as generate's: unknown id refused, empty match succeeds, status narrows", async () => {
  const dir = await scaffold();
  assert.equal(
    await runProduce(["inspect", dir, "--episode", "ep-001", "--cut", "ghost"], capture().io),
    EXIT_USAGE,
  );
  const empty = capture();
  assert.equal(
    await runProduce(["inspect", dir, "--episode", "ep-001", "--review-status", "final"], empty.io),
    EXIT_OK,
  );
  assert.match(empty.out.join("\n"), /No cuts with review status "final"/);
  await setCuts(dir, (cut) =>
    cut.id === "cut-002" ? { ...cut, imagePrompt: "x", reviewStatus: "human-edited" } : cut,
  );
  const narrowed = capture();
  assert.equal(
    await runProduce(
      ["inspect", dir, "--episode", "ep-001", "--review-status", "human-edited", "--json"],
      narrowed.io,
    ),
    EXIT_OK,
  );
  assert.deepEqual(JSON.parse(narrowed.out.join("\n")).targets, ["cut-002"]);
  assert.equal(await runProduce(["inspect", dir, "--episode", "ep-001"], capture().io), EXIT_USAGE);
  assert.equal(await runProduce(["bogus"], capture().io), EXIT_USAGE);
});

test("run without an accepted target set stops, names the set, and calls no provider", async () => {
  const dir = await scaffold();
  await setCuts(dir, (cut) => ({ ...cut, imagePrompt: `prompt ${cut.id}` }));
  const comfy = await startFakeComfy(pngWithText());
  try {
    const c = capture({ TOONY_COMFYUI_URL: comfy.url });
    const code = await runProduce(
      ["run", dir, "--episode", "ep-001", "--cut", "cut-001", "--allow-remote"],
      c.io,
    );
    assert.equal(code, EXIT_VALIDATION);
    assert.match(
      c.err.join("\n"),
      /stop \[not-accepted\] cut-001: target set [0-9a-f]{16} is not named/,
    );
    assert.equal(comfy.calls(), 0);

    const wrong = capture({ TOONY_COMFYUI_URL: comfy.url });
    assert.equal(
      await runProduce(
        [
          "run",
          dir,
          "--episode",
          "ep-001",
          "--cut",
          "cut-001",
          "--accept",
          "0000000000000000",
          "--allow-remote",
        ],
        wrong.io,
      ),
      EXIT_VALIDATION,
    );
    assert.match(wrong.err.join("\n"), /resolves differently now|not the accepted/);
    assert.equal(comfy.calls(), 0);
    // Nothing was planned either: no log is written for a run that never started.
    await assert.rejects(produceLog(dir));
  } finally {
    comfy.close();
  }
});

test("an accepted first render generates, logs planned then finished, and leaves review state to ingest", async () => {
  const dir = await scaffold();
  await setCuts(dir, (cut) => ({ ...cut, imagePrompt: `prompt ${cut.id}`, reviewStatus: "final" }));
  const comfy = await startFakeComfy(pngWithText());
  try {
    const inspect = capture({ TOONY_COMFYUI_URL: comfy.url });
    await runProduce(["inspect", dir, "--episode", "ep-001", "--cut", "cut-001"], inspect.io);
    const set = targetSetOf(inspect.out);

    const run = capture({ TOONY_COMFYUI_URL: comfy.url });
    const code = await runProduce(
      ["run", dir, "--episode", "ep-001", "--cut", "cut-001", "--accept", set, "--allow-remote"],
      run.io,
    );
    assert.equal(code, EXIT_OK, run.err.join("\n"));
    assert.equal(comfy.calls(), 1);
    const text = run.out.join("\n");
    assert.match(text, /run kind: render/);
    assert.match(text, /generated episodes\/ep-001\/assets\/clean\/cut-001\.png/);
    assert.match(text, /produce run 1 completed: 1 generated \(cut-001\)/);

    const log = await produceLog(dir);
    assert.deepEqual(
      log.map((e) => [e.run, e.state]),
      [[1, "finished"]],
      "the planned entry is replaced by the finished one for the same run",
    );
    assert.deepEqual(log[0]?.outcomes, { "cut-001": "generated" });
    assert.equal(log[0]?.kind, "render");
    assert.deepEqual(log[0]?.disclosure, {
      withImage: 0,
      withRecordedInputs: 0,
      willResetReview: ["cut-001 (final)"],
    });
    // Ingest reset the review; the controller wrote nothing of its own.
    const after = await cuts(dir);
    assert.equal(after.find((c) => c.id === "cut-001")?.reviewStatus, "draft");
    assert.equal(after.find((c) => c.id === "cut-002")?.reviewStatus, "final");
  } finally {
    comfy.close();
  }
});

test("a revision needs a reason and is logged with its changed inputs; a repeat is a repeat", async () => {
  const dir = await scaffold();
  await setCuts(dir, (cut) => ({ ...cut, imagePrompt: `prompt ${cut.id}` }));
  const comfy = await startFakeComfy(pngWithText());
  try {
    const env = { TOONY_COMFYUI_URL: comfy.url };
    const inspect = capture(env);
    await runProduce(["inspect", dir, "--episode", "ep-001", "--cut", "cut-001"], inspect.io);
    const set = targetSetOf(inspect.out);
    const base = [
      "run",
      dir,
      "--episode",
      "ep-001",
      "--cut",
      "cut-001",
      "--accept",
      set,
      "--allow-remote",
    ];
    assert.equal(await runProduce(base, capture(env).io), EXIT_OK);

    // Changed input on a recorded cut, no reason: stop before any call.
    const calls = comfy.calls();
    const noReason = capture(env);
    assert.equal(await runProduce([...base, "--seed", "fresh"], noReason.io), EXIT_VALIDATION);
    assert.match(noReason.err.join("\n"), /stop \[no-reason\].*--seed fresh/);
    assert.equal(comfy.calls(), calls);

    const revised = capture(env);
    assert.equal(
      await runProduce(
        [...base, "--seed", "fresh", "--reason", "the first take cropped the face"],
        revised.io,
      ),
      EXIT_OK,
      revised.err.join("\n"),
    );
    assert.match(
      revised.out.join("\n"),
      /run kind: revision \(changes --seed fresh\); reason: "the first take cropped the face"/,
    );

    const repeat = capture(env);
    assert.equal(await runProduce(base, repeat.io), EXIT_OK, repeat.err.join("\n"));
    assert.match(repeat.out.join("\n"), /run kind: repeat/);

    const log = await produceLog(dir);
    assert.deepEqual(
      log.map((e) => [e.run, e.kind, e.changed, e.reason]),
      [
        [1, "render", [], null],
        [2, "revision", ["--seed fresh"], "the first take cropped the face"],
        [3, "repeat", [], null],
      ],
    );
  } finally {
    comfy.close();
  }
});

test("a controlled run leaves the same cut record and ingest entry as a plain generate", async () => {
  const a = await scaffold("plain");
  const b = await scaffold("controlled");
  for (const dir of [a, b]) {
    await setCuts(dir, (cut) => ({ ...cut, imagePrompt: "a rooftop at dusk" }));
  }
  const comfy = await startFakeComfy(pngWithText());
  try {
    const env = { TOONY_COMFYUI_URL: comfy.url };
    assert.equal(
      await runGenerate(
        [a, "--episode", "ep-001", "--cut", "cut-001", "--seed", "4242", "--allow-remote"],
        capture(env).io,
      ),
      EXIT_OK,
    );
    const inspect = capture(env);
    await runProduce(["inspect", b, "--episode", "ep-001", "--cut", "cut-001"], inspect.io);
    assert.equal(
      await runProduce(
        [
          "run",
          b,
          "--episode",
          "ep-001",
          "--cut",
          "cut-001",
          "--accept",
          targetSetOf(inspect.out),
          "--seed",
          "4242",
          "--allow-remote",
        ],
        capture(env).io,
      ),
      EXIT_OK,
    );
    const cutA = (await cuts(a)).find((c) => c.id === "cut-001");
    const cutB = (await cuts(b)).find((c) => c.id === "cut-001");
    assert.deepEqual(cutB, cutA);
    const strip = (raw: string) =>
      (JSON.parse(raw) as Array<Record<string, unknown>>).map((entry) => {
        const { recordedAt: _a, at: _b, ...rest } = entry;
        return rest;
      });
    const ingestA = strip(
      await readFile(join(a, "episodes", "ep-001", "logs", "ingest.json"), "utf8"),
    );
    const ingestB = strip(
      await readFile(join(b, "episodes", "ep-001", "logs", "ingest.json"), "utf8"),
    );
    assert.deepEqual(ingestB, ingestA);
  } finally {
    comfy.close();
  }
});

test("the repeat refusal is surfaced as printed, stops the run, and is never re-issued", async () => {
  const dir = await scaffold();
  await setCuts(dir, (cut) => ({ ...cut, imagePrompt: `prompt ${cut.id}` }));
  const comfy = await startFakeComfy(pngWithText());
  try {
    const env = { TOONY_COMFYUI_URL: comfy.url };
    assert.equal(
      await runGenerate(
        [
          dir,
          "--episode",
          "ep-001",
          "--cut",
          "cut-001",
          "--seed",
          "7",
          "--width",
          "640",
          "--height",
          "960",
          "--allow-remote",
        ],
        capture(env).io,
      ),
      EXIT_OK,
    );
    const inspect = capture(env);
    await runProduce(["inspect", dir, "--episode", "ep-001", "--cut", "cut-001"], inspect.io);
    const run = capture(env);
    const code = await runProduce(
      [
        "run",
        dir,
        "--episode",
        "ep-001",
        "--cut",
        "cut-001",
        "--accept",
        targetSetOf(inspect.out),
        "--allow-remote",
      ],
      run.io,
    );
    assert.notEqual(code, EXIT_OK);
    assert.equal(
      comfy.calls(),
      1,
      "the refused run must not reach the provider, and must not be re-issued",
    );
    const err = run.err.join("\n");
    assert.match(err, /width 832 instead of 640/);
    assert.match(err, /--width 640 --height 960/);
    assert.match(run.out.join("\n"), /produce run 1 stopped: 1 not-reached \(cut-001\)/);
    const log = await produceLog(dir);
    assert.equal(log[0]?.state, "finished");
    assert.deepEqual(log[0]?.outcomes, { "cut-001": "not-reached" });
    assert.match(String(log[0]?.stopped), /width 832 instead of 640/);
  } finally {
    comfy.close();
  }
});

test("the uncertainty cases stop with a non-zero exit and name the target", async () => {
  const dir = await scaffold();
  const loaded = await loadProject(dir);
  await writeWebtoon(dir, {
    ...loaded.project.webtoon,
    characters: [{ id: "mina", name: "Mina", lockstring: "red scarf" }],
  });
  await setCuts(dir, (cut) =>
    cut.id === "cut-001"
      ? { ...cut, imagePrompt: "a pier", characters: ["ghost"] }
      : { ...cut, imagePrompt: "" },
  );
  const comfy = await startFakeComfy(pngWithText());
  try {
    const env = { TOONY_COMFYUI_URL: comfy.url };
    const inspect = capture(env);
    const code = await runProduce(
      ["inspect", dir, "--episode", "ep-001", "--cut", "cut-001", "--cut", "cut-002", "--json"],
      inspect.io,
    );
    assert.equal(code, EXIT_VALIDATION);
    const stops = JSON.parse(inspect.out.join("\n")).stops as Array<{
      reason: string;
      target: string;
    }>;
    assert.deepEqual(stops.map((s) => [s.reason, s.target]).sort(), [
      ["no-prompt", "cut-002"],
      ["unknown-character", "cut-001"],
    ]);
    const set = JSON.parse(inspect.out.join("\n")).targetSet;
    const run = capture(env);
    assert.equal(
      await runProduce(
        [
          "run",
          dir,
          "--episode",
          "ep-001",
          "--cut",
          "cut-001",
          "--cut",
          "cut-002",
          "--accept",
          set,
          "--allow-remote",
        ],
        run.io,
      ),
      EXIT_VALIDATION,
    );
    assert.equal(comfy.calls(), 0);
    assert.match(run.err.join("\n"), /stop \[unknown-character\] cut-001/);
    assert.match(run.err.join("\n"), /stop \[no-prompt\] cut-002/);
  } finally {
    comfy.close();
  }
});

test("a generated-but-unrecorded cut is its own outcome, never a failure", async () => {
  const dir = await scaffold();
  await setCuts(dir, (cut) => ({ ...cut, imagePrompt: `prompt ${cut.id}` }));
  const cutsPath = join(dir, "episodes", "ep-001", "cuts.yaml");
  let corrupted = false;
  const corruptSiblingCut = async (): Promise<void> => {
    if (corrupted) return;
    corrupted = true;
    const current = decodeYaml(await readFile(cutsPath, "utf8")) as Record<string, unknown>[];
    await writeFile(
      cutsPath,
      encodeYaml(current.map((cut) => (cut.id === "cut-002" ? { ...cut, panelAspect: 99 } : cut))),
    );
  };
  const comfy = await startFakeComfy(pngWithText(), undefined, corruptSiblingCut);
  try {
    const env = { TOONY_COMFYUI_URL: comfy.url };
    const inspect = capture(env);
    await runProduce(["inspect", dir, "--episode", "ep-001", "--cut", "cut-001"], inspect.io);
    const run = capture(env);
    const code = await runProduce(
      [
        "run",
        dir,
        "--episode",
        "ep-001",
        "--cut",
        "cut-001",
        "--accept",
        targetSetOf(inspect.out),
        "--allow-remote",
      ],
      run.io,
    );
    assert.notEqual(code, EXIT_OK);
    assert.match(run.out.join("\n"), /1 unrecorded \(cut-001\)/);
    assert.doesNotMatch(run.out.join("\n"), /failed \(cut-001\)/);
    const log = await produceLog(dir);
    assert.deepEqual(log[0]?.outcomes, { "cut-001": "unrecorded" });
  } finally {
    comfy.close();
  }
});

test("run --from imports one image through the shipped import path", async () => {
  const dir = await scaffold();
  await setCuts(dir, (cut) => ({ ...cut, imagePrompt: `prompt ${cut.id}` }));
  const source = join(workdir, "art.png");
  await writeFile(source, pngWithText());
  const inspect = capture();
  await runProduce(["inspect", dir, "--episode", "ep-001", "--cut", "cut-002"], inspect.io);
  const run = capture();
  const code = await runProduce(
    [
      "run",
      dir,
      "--episode",
      "ep-001",
      "--cut",
      "cut-002",
      "--accept",
      targetSetOf(inspect.out),
      "--from",
      source,
    ],
    run.io,
  );
  assert.equal(code, EXIT_OK, run.err.join("\n"));
  assert.match(run.out.join("\n"), /run kind: import/);
  assert.match(run.out.join("\n"), /1 imported \(cut-002\)/);
  const cut = (await cuts(dir)).find((c) => c.id === "cut-002");
  assert.equal(cut?.image?.clean, "episodes/ep-001/assets/clean/cut-002.png");
  assert.equal(
    await runProduce(
      [
        "run",
        dir,
        "--episode",
        "ep-001",
        "--cut",
        "cut-001",
        "--cut",
        "cut-002",
        "--accept",
        "x",
        "--from",
        source,
      ],
      capture().io,
    ),
    EXIT_USAGE,
  );
});
