// The generate run as Studio drives it in-process: each finished image's writes
// go through the caller's commit (its lock and undo history), a run can keep the
// cut's authored scene text, and `--source current` edits the image a cut holds
// instead of drawing from noise. A fake ComfyUI answers over real HTTP, so the
// real provider and ingest path run.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
  buildInitialProject,
  loadProject,
  writeCuts,
  writeProject,
  writeStoryBible,
  writeWebtoon,
} from "@toony/project-io";
import { EXIT_OK, EXIT_USAGE } from "../exit.js";
import { type GenerateEvent, type GenerateIo, runGenerate } from "../generate.js";

const PROMPT_ID = "run-0001";

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}
function chunk(type: string, data: number[]): number[] {
  return [...u32(data.length), ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
}
/** A 1x1 PNG whose IDAT byte differs per `tag`, so two renders differ on disk. */
function png(tag: number): Uint8Array {
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk("IHDR", [...u32(1), ...u32(1), 8, 2, 0, 0, 0]),
    ...chunk("IDAT", [0x08, 0x1d, tag]),
    ...chunk("IEND", []),
  ]);
}

interface Fake {
  url: string;
  close: () => void;
  graphs: () => Array<Record<string, { class_type: string; inputs: Record<string, unknown> }>>;
  uploads: () => Buffer[];
}

async function fakeComfy(): Promise<Fake> {
  const graphs: Array<Record<string, { class_type: string; inputs: Record<string, unknown> }>> = [];
  const uploads: Buffer[] = [];
  const server: Server = createServer((req, res) => {
    const url = req.url ?? "";
    const body: Buffer[] = [];
    req.on("data", (part: Buffer) => body.push(part));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.method === "POST" && url === "/prompt") {
        graphs.push(JSON.parse(Buffer.concat(body).toString("utf8")).prompt);
        res.end(JSON.stringify({ prompt_id: PROMPT_ID, node_errors: {} }));
      } else if (req.method === "POST" && url === "/upload/image") {
        uploads.push(Buffer.concat(body));
        res.end(JSON.stringify({ name: `up-${uploads.length}.png`, subfolder: "" }));
      } else if (url.startsWith("/history/")) {
        res.end(
          JSON.stringify({
            [PROMPT_ID]: {
              outputs: { "9": { images: [{ filename: "o.png", subfolder: "", type: "output" }] } },
              status: { status_str: "success", completed: true },
            },
          }),
        );
      } else if (url.startsWith("/view")) {
        res.setHeader("content-type", "image/png");
        res.end(Buffer.from(png(graphs.length)));
      } else {
        res.statusCode = 404;
        res.end("{}");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => server.close(),
    graphs: () => [...graphs],
    uploads: () => [...uploads],
  };
}

let workdir: string;
let comfy: Fake;
beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), "toony-generate-"));
  comfy = await fakeComfy();
});
afterEach(async () => {
  comfy.close();
  await rm(workdir, { recursive: true, force: true });
});

/** A starter project whose first cut has a scene written in Korean. */
async function project(): Promise<{ dir: string; episodeId: string; cutId: string }> {
  const dir = join(workdir, "demo");
  await writeProject(dir, buildInitialProject("demo"));
  const loaded = await loadProject(dir);
  const bundle = loaded.project.episodes[0];
  assert.ok(bundle);
  const first = bundle.cuts[0];
  assert.ok(first);
  await writeCuts(
    dir,
    bundle.episode.id,
    bundle.cuts.map((cut) => (cut.id === first.id ? { ...cut, imagePrompt: "비 오는 부두" } : cut)),
  );
  return { dir, episodeId: bundle.episode.id, cutId: first.id };
}

function io(extra: Partial<GenerateIo> = {}): GenerateIo & { err: (l: string) => void } {
  const errors: string[] = [];
  return {
    cwd: workdir,
    out: () => {},
    err: (line: string) => errors.push(line),
    env: { TOONY_COMFYUI_URL: comfy.url },
    ...extra,
    toString: () => errors.join("\n"),
  } as GenerateIo & { err: (l: string) => void };
}

async function cutOf(dir: string, episodeId: string, cutId: string) {
  const loaded = await loadProject(dir);
  return loaded.project.episodes
    .find((b) => b.episode.id === episodeId)
    ?.cuts.find((c) => c.id === cutId);
}

test("each image's writes run inside the caller's commit, after the cut is reported started", async () => {
  const { dir, episodeId, cutId } = await project();
  const events: GenerateEvent["kind"][] = [];
  const commits: Array<{ cutId: string; bytes: number; imageBefore: unknown }> = [];
  const code = await runGenerate(
    [dir, "--episode", episodeId, "--cut", cutId, "--prompt", "a rainy pier at night"],
    io({
      report: (event) => events.push(event.kind),
      commit: async (image, write) => {
        const before = await cutOf(dir, episodeId, cutId);
        commits.push({
          cutId: image.target.kind === "cut" ? image.target.cutId : "",
          bytes: image.bytes.byteLength,
          imageBefore: before?.image ?? null,
        });
        return write();
      },
    }),
  );
  assert.equal(code, EXIT_OK);
  // The authored scene was replaced by the submitted prompt, which is reported.
  assert.deepEqual(events, ["started", "rewrote-prompt", "generated"]);
  assert.equal(commits.length, 1);
  assert.equal(commits[0]?.cutId, cutId);
  assert.ok((commits[0]?.bytes ?? 0) > 0);
  assert.equal(commits[0]?.imageBefore, null, "nothing was written before the commit ran");
  assert.ok((await cutOf(dir, episodeId, cutId))?.image?.clean);
});

test("keepCutPrompt leaves the scene text and still records the seed and the submitted prompt", async () => {
  const { dir, episodeId, cutId } = await project();
  const code = await runGenerate(
    [dir, "--episode", episodeId, "--cut", cutId, "--prompt", "a rainy pier, night", "--seed", "7"],
    io({ keepCutPrompt: true }),
  );
  assert.equal(code, EXIT_OK);
  const cut = await cutOf(dir, episodeId, cutId);
  assert.equal(cut?.imagePrompt, "비 오는 부두");
  assert.equal(cut?.imageSeed, 7);
  const log = JSON.parse(
    await readFile(join(dir, "episodes", episodeId, "logs", "ingest.json"), "utf8"),
  ) as Array<{ renderInputs?: { basePrompt?: string } }>;
  assert.equal(log.at(-1)?.renderInputs?.basePrompt, "a rainy pier, night");
});

test("a standalone prompt is sent without the story bible around it", async () => {
  // Studio's agent writes a whole prompt per cut. Wrapped in the story bible,
  // other cuts' continuity notes and words like "speech bubbles" reached the
  // image model and drew a workshop instead of a close-up, and bubbles.
  const { dir, episodeId, cutId } = await project();
  await writeStoryBible(dir, "## Continuity\nSame workshop. No speech bubbles.");
  const run = (extra: Partial<GenerateIo>) =>
    runGenerate(
      [dir, "--episode", episodeId, "--cut", cutId, "--prompt", "a coiled spring", "--seed", "5"],
      io({ keepCutPrompt: true, ...extra }),
    );
  assert.equal(await run({}), EXIT_OK);
  assert.equal(await run({ standalonePrompt: true }), EXIT_OK);
  const log = JSON.parse(
    await readFile(join(dir, "episodes", episodeId, "logs", "ingest.json"), "utf8"),
  ) as Array<{ renderInputs?: { prompt?: string } }>;
  assert.match(log.at(-2)?.renderInputs?.prompt ?? "", /^Story context:[\s\S]*Same workshop/);
  assert.equal(log.at(-1)?.renderInputs?.prompt, "a coiled spring");
  const sent = JSON.stringify(comfy.graphs().at(-1));
  assert.ok(sent.includes("a coiled spring") && !sent.includes("Same workshop"));
});

test("a wide shape is drawn at the baseline detail when the caller keeps detail", async () => {
  // Studio's route cannot pass a width, and the guard that refuses a smaller
  // canvas made a wide cut undrawable there. With keepDetail the column widens
  // so the panel holds at least the workflow's baseline pixels.
  const { dir, episodeId, cutId } = await project();
  const base = [dir, "--episode", episodeId, "--cut", cutId, "--prompt", "a harbor", "--seed", "4"];
  assert.equal(await runGenerate(base, io({ keepCutPrompt: true })), EXIT_OK);
  const latentOf = (
    graph: Record<string, { class_type: string; inputs: Record<string, unknown> }>,
  ) =>
    Object.values(graph).find((node) => node.class_type === "EmptyLatentImage")?.inputs as {
      width: number;
      height: number;
    };
  const baseline = latentOf(comfy.graphs().at(-1) ?? {});
  assert.ok(baseline.width > 0 && baseline.height > baseline.width, "a portrait baseline");

  const loaded = await loadProject(dir);
  const bundle = loaded.project.episodes[0];
  assert.ok(bundle);
  await writeCuts(
    dir,
    episodeId,
    bundle.cuts.map((cut) => (cut.id === cutId ? { ...cut, panelAspect: 0.6 } : cut)),
  );
  const refused = io({ keepCutPrompt: true });
  assert.notEqual(
    await runGenerate(base, refused),
    EXIT_OK,
    "without keepDetail the small canvas is refused",
  );
  assert.match(String(refused), /reduced-generation-canvas/);
  assert.equal(comfy.graphs().length, 1, "nothing was submitted");

  assert.equal(await runGenerate(base, io({ keepCutPrompt: true, keepDetail: true })), EXIT_OK);
  const wide = latentOf(comfy.graphs().at(-1) ?? {});
  assert.ok(
    wide.width * wide.height >= baseline.width * baseline.height,
    "no fewer pixels than the baseline",
  );
  assert.ok(
    Math.abs(wide.height / wide.width - 0.6) < 0.02,
    `shape kept: ${wide.width}x${wide.height}`,
  );
  assert.equal(wide.width % 8, 0);
  const log = JSON.parse(
    await readFile(join(dir, "episodes", episodeId, "logs", "ingest.json"), "utf8"),
  ) as Array<{ renderInputs?: { width?: number; height?: number } }>;
  assert.deepEqual(
    [log.at(-1)?.renderInputs?.width, log.at(-1)?.renderInputs?.height],
    [wide.width, wide.height],
    "the widened size is what the record keeps",
  );
});

test("--source current edits the image the cut holds at the given strength and records it", async () => {
  const { dir, episodeId, cutId } = await project();
  const base = [dir, "--episode", episodeId, "--cut", cutId, "--prompt", "a rainy pier"];
  assert.equal(await runGenerate([...base, "--seed", "3"], io({ keepCutPrompt: true })), EXIT_OK);
  const drawn = (await cutOf(dir, episodeId, cutId))?.image?.clean;
  assert.ok(drawn);
  const current = await readFile(join(dir, drawn));

  const code = await runGenerate(
    [...base, "--source", "current", "--strength", "0.35"],
    io({ keepCutPrompt: true }),
  );
  assert.equal(code, EXIT_OK);
  assert.equal(comfy.uploads().length, 1, "the current image was uploaded once");
  assert.ok(comfy.uploads()[0]?.includes(current), "the upload carries the image on disk");
  const graph = comfy.graphs().at(-1);
  assert.equal(graph?.toony_source_load?.inputs.image, "up-1.png");
  assert.deepEqual(graph?.["3"]?.inputs.latent_image, ["toony_source_encode", 0]);
  assert.equal(graph?.["3"]?.inputs.denoise, 0.35);
  assert.equal(graph?.["3"]?.inputs.seed, 3, "an edit keeps the recorded seed");

  const log = JSON.parse(
    await readFile(join(dir, "episodes", episodeId, "logs", "ingest.json"), "utf8"),
  ) as Array<{ renderInputs?: { source?: { sha256: string; strength: number } } }>;
  assert.deepEqual(log.at(-1)?.renderInputs?.source, {
    sha256: createHash("sha256").update(current).digest("hex"),
    strength: 0.35,
  });
});

test("--source refuses a cut with no image, and --strength needs --source and a value in range", async () => {
  const { dir, episodeId, cutId } = await project();
  const base = [dir, "--episode", episodeId, "--cut", cutId, "--prompt", "p"];
  const errors: string[] = [];
  const quiet = io({ err: (line) => errors.push(line) });
  assert.equal(await runGenerate([...base, "--source", "current"], quiet), EXIT_USAGE);
  assert.match(errors.join("\n"), /no clean image to edit/);
  assert.equal(await runGenerate([...base, "--strength", "0.5"], quiet), EXIT_USAGE);
  assert.equal(
    await runGenerate([...base, "--source", "current", "--strength", "1.5"], quiet),
    EXIT_USAGE,
  );
  assert.equal(await runGenerate([...base, "--source", "earlier"], quiet), EXIT_USAGE);
  assert.equal(comfy.graphs().length, 0, "nothing reached the engine");
});

test("a cut with a panel shape keeps its reference sheet on the request", async () => {
  const { dir, episodeId, cutId } = await project();
  const loaded = await loadProject(dir);
  await writeWebtoon(dir, {
    ...loaded.project.webtoon,
    characters: [
      { id: "mira", name: "Mira", lockstring: "teal coat", references: ["characters/mira/s.png"] },
    ],
  });
  await mkdir(join(dir, "characters", "mira"), { recursive: true });
  await writeFile(join(dir, "characters", "mira", "s.png"), png(9));
  const bundle = (await loadProject(dir)).project.episodes[0];
  assert.ok(bundle);
  await writeCuts(
    dir,
    episodeId,
    bundle.cuts.map((cut) =>
      cut.id === cutId ? { ...cut, characters: ["mira"], panelAspect: 1.5 } : cut,
    ),
  );
  const defaults = JSON.parse(
    await readFile(
      new URL("../../../providers/src/assets/default-txt2img.workflow.json", import.meta.url),
      "utf8",
    ),
  ) as Record<string, unknown>;
  const pack = join(dir, ".toony", "packs", "refpack");
  await mkdir(join(pack, "workflows"), { recursive: true });
  await writeFile(
    join(pack, "workflows", "ref.workflow.json"),
    JSON.stringify({ ...defaults, "10": { class_type: "LoadImage", inputs: { image: "x.png" } } }),
  );
  await writeFile(
    join(pack, "toony-pack.json"),
    JSON.stringify({
      packFormat: 1,
      id: "refpack",
      name: "Reference pack",
      workflows: [
        {
          name: "ref",
          file: "workflows/ref.workflow.json",
          reference: { node: "10", input: "image" },
        },
      ],
    }),
  );
  const code = await runGenerate(
    [dir, "--episode", episodeId, "--cut", cutId, "--prompt", "p", "--workflow", "ref"],
    io(),
  );
  assert.equal(code, EXIT_OK);
  const graph = comfy.graphs()[0];
  assert.equal(graph?.["10"]?.inputs.image, "up-1.png", "the sheet was sent");
  assert.equal(graph?.["5"]?.inputs.height, 1248, "the declared shape sized the latent");
});
