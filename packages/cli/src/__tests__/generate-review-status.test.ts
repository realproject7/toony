// Dedicated #239 integration fixtures. No live provider or GPU is used.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildInitialProject, loadProject, writeProject } from "@toony/project-io";
import type { ReviewStatus } from "@toony/schema";
import { runGenerate } from "../commands/generate.js";
import { EXIT_OK, EXIT_USAGE } from "../exit.js";

const PNG_FIXTURE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n5sAAAAASUVORK5CYII=",
  "base64",
);

async function comfyFixture(reject = false) {
  const prompts: string[] = [];
  const server = createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/prompt") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      prompts.push(body.prompt["6"].inputs.text);
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify(
          reject
            ? { error: { message: "fixture generation failed" } }
            : { prompt_id: "review-fixture", node_errors: {} },
        ),
      );
    } else if (req.url?.startsWith("/history/")) {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          "review-fixture": {
            outputs: {
              "9": { images: [{ filename: "fixture.png", subfolder: "", type: "output" }] },
            },
            status: { status_str: "success", completed: true },
          },
        }),
      );
    } else if (req.url?.startsWith("/view")) {
      res.setHeader("content-type", "image/png");
      res.end(PNG_FIXTURE);
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    prompts,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function projectFixture(root: string) {
  const project = buildInitialProject("Cut review generation fixture");
  const bundle = project.episodes[0];
  assert.ok(bundle);
  bundle.transitions = [];
  bundle.cuts = [undefined, "draft", "human-edited", "final"].map((reviewStatus, index) => ({
    id: `cut-${index + 1}`,
    image: null,
    imagePrompt: `fixture panel ${index + 1}`,
    negativePrompt: "",
    ...(reviewStatus === undefined ? {} : { reviewStatus: reviewStatus as ReviewStatus }),
  }));
  bundle.episode.sequence = bundle.cuts.map((cut) => ({ type: "cut", id: cut.id }));
  await writeProject(root, project);
}

for (const [status, expected] of [
  ["draft", ["fixture panel 1", "fixture panel 2"]],
  ["human-edited", ["fixture panel 3"]],
  ["final", ["fixture panel 4"]],
] as const) {
  test(`--review-status ${status} submits only matching cut prompts`, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "toony-review-cli-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const root = join(dir, "work");
    await projectFixture(root);
    const server = await comfyFixture();
    t.after(() => server.close());
    const out: string[] = [];
    const err: string[] = [];
    const code = await runGenerate([root, "--episode", "ep-001", "--review-status", status], {
      cwd: dir,
      out: (s) => out.push(s),
      err: (s) => err.push(s),
      env: { TOONY_COMFYUI_URL: server.url },
    });
    assert.equal(code, EXIT_OK, err.join("\n"));
    assert.deepEqual(server.prompts, [...expected]);
    const cuts = (await loadProject(root)).project.episodes[0]?.cuts;
    assert.ok(cuts);
    for (const cut of cuts) {
      if (expected.some((prompt) => prompt === cut.imagePrompt)) {
        assert.equal(cut.reviewStatus, "draft");
        assert.ok(cut.image?.clean);
      } else {
        assert.equal(cut.image, null);
      }
    }
  });
}

test("review filter intersects explicit cuts, deduplicates, and preserves unselected final cuts", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "toony-review-subset-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "work");
  await projectFixture(root);
  const server = await comfyFixture();
  t.after(() => server.close());
  const err: string[] = [];
  const code = await runGenerate(
    [
      root,
      "--episode",
      "ep-001",
      "--cut",
      "cut-2",
      "--cut",
      "cut-4",
      "--cut",
      "cut-2",
      "--review-status",
      "draft",
    ],
    { cwd: dir, out: () => {}, err: (s) => err.push(s), env: { TOONY_COMFYUI_URL: server.url } },
  );
  assert.equal(code, EXIT_OK, err.join("\n"));
  assert.deepEqual(server.prompts, ["fixture panel 2"]);
  assert.equal((await loadProject(root)).project.episodes[0]?.cuts[3]?.reviewStatus, "final");
});

test("failed generation preserves reviewed cut bytes", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "toony-review-cli-fail-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "work");
  await projectFixture(root);
  const cutsPath = join(root, "episodes/ep-001/cuts.yaml");
  const before = await readFile(cutsPath);
  const server = await comfyFixture(true);
  t.after(() => server.close());
  const code = await runGenerate([root, "--episode", "ep-001", "--review-status", "final"], {
    cwd: dir,
    out: () => {},
    err: () => {},
    env: { TOONY_COMFYUI_URL: server.url },
  });
  assert.notEqual(code, EXIT_OK);
  assert.deepEqual(server.prompts, ["fixture panel 4"]);
  assert.deepEqual(await readFile(cutsPath), before);
});

test("empty review selection does not require a provider; invalid selection is a usage error", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "toony-review-cli-empty-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "work");
  await projectFixture(root);
  const out: string[] = [];
  const io = { cwd: dir, out: (s: string) => out.push(s), err: () => {}, env: {} };
  assert.equal(
    await runGenerate(
      [root, "--episode", "ep-001", "--cut", "cut-1", "--review-status", "final"],
      io,
    ),
    EXIT_OK,
  );
  assert.match(out.join("\n"), /No cuts with review status "final"/);
  for (const flags of [
    ["--review-status", "rejected"],
    ["--review-status", "draft", "--transition", "tr-001"],
    ["--review-status", "draft", "--cut", "missing"],
  ]) {
    assert.equal(await runGenerate([root, "--episode", "ep-001", ...flags], io), EXIT_USAGE);
  }
  assert.equal(
    await runGenerate([root, "--episode", "missing", "--review-status", "draft"], io),
    EXIT_USAGE,
  );
});
