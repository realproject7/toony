// A pack's theme and lexicon reach the places they are meant for and no other
// (#334, #335, #336): the draft compiler letters a themed project's overlays
// with the theme, generate composes the lexicon's words into the prompt and the
// negative prompt and records them as submitted, a project that selects neither
// sends byte-identical requests, a selected lexicon no pack provides refuses the
// run, and `toony packs list` names both.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
  loadProject,
  writeBrief,
  writeCuts,
  writeEpisodeScript,
  writeWebtoon,
} from "@toony/project-io";
import { EPISODE_SCRIPT_FORMAT_VERSION, PRODUCTION_BRIEF_FORMAT_VERSION } from "@toony/schema";
import { pngWithText, startFakeComfy } from "../__fixtures__/comfyui-server.js";
import { runDraft } from "../commands/draft.js";
import { runGenerate } from "../commands/generate.js";
import { runInit } from "../commands/init.js";
import { runPacks } from "../commands/packs.js";
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
  workdir = await mkdtemp(join(tmpdir(), "toony-pack-style-"));
});
afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

const THEME = {
  themeFormat: 1,
  kinds: {
    speech: {
      fontFamily: "bangers",
      fill: "#fff7e6",
      textColor: "#2a1a05",
      border: { width: 3, color: "#2a1a05" },
    },
    narration: { fill: "#1b1b1b", textColor: "#f3f3f3", border: null },
  },
  sfxMode: "impact_band",
};
const LEXICON = {
  lexiconFormat: 1,
  styleClause: "flat cel shading, clean ink line",
  negativeBase: "lowres, watermark",
};

async function installStylePack(dir: string): Promise<void> {
  const pack = join(dir, ".toony", "packs", "style");
  await mkdir(join(pack, "themes"), { recursive: true });
  await mkdir(join(pack, "lexicons"), { recursive: true });
  await writeFile(join(pack, "themes", "cold.json"), JSON.stringify(THEME));
  await writeFile(join(pack, "lexicons", "cold.json"), JSON.stringify(LEXICON));
  await writeFile(
    join(pack, "toony-pack.json"),
    JSON.stringify({
      packFormat: 1,
      id: "style",
      name: "Style pack",
      letteringThemes: [{ id: "cold", file: "themes/cold.json" }],
      styleLexicons: [{ id: "cold", file: "lexicons/cold.json" }],
    }),
  );
}

async function scaffold(
  name: string,
  select: { theme?: string; lexicon?: string },
): Promise<string> {
  assert.equal(await runInit([name], capture().io), EXIT_OK);
  const dir = join(workdir, name);
  const loaded = await loadProject(dir);
  await writeWebtoon(dir, {
    ...loaded.project.webtoon,
    characters: [{ id: "mira", name: "Mira", lockstring: "teal coat" }],
    ...(select.theme === undefined ? {} : { letteringTheme: select.theme }),
    ...(select.lexicon === undefined ? {} : { styleLexicon: select.lexicon }),
  });
  const bundle = loaded.project.episodes[0];
  assert.ok(bundle);
  await writeCuts(
    dir,
    bundle.episode.id,
    bundle.cuts.map((cut, i) =>
      i === 0
        ? {
            ...cut,
            imagePrompt: "a pier at dawn",
            negativePrompt: "blurry",
            characters: ["mira"],
            palette: "#9fb4c7",
          }
        : { ...cut, imagePrompt: "a ledger" },
    ),
  );
  return dir;
}

async function writeScript(dir: string): Promise<void> {
  const revision = await writeBrief(dir, {
    briefFormat: PRODUCTION_BRIEF_FORMAT_VERSION,
    intent: "x",
    audience: "y",
    world: "z",
    storyGoals: ["g"],
  });
  await writeEpisodeScript(dir, {
    scriptFormat: EPISODE_SCRIPT_FORMAT_VERSION,
    episodeId: "ep-002",
    briefRevision: revision,
    beats: [
      {
        id: "beat-001",
        purpose: "Open.",
        cuts: [
          {
            id: "sc-001",
            intent: "Open.",
            scene: "The pier.",
            dialogue: [
              { speaker: null, text: "The tide keeps its own books." },
              { speaker: "mira", text: "Early." },
              { speaker: null, text: "CLANG", kind: "sfx" },
            ],
          },
        ],
      },
    ],
  });
}

function normalizeClientId(body: string): string {
  return body.replace(/"client_id":"[^"]+"/, '"client_id":"x"');
}

test("a compiled draft letters with the project's theme, and says when the theme is not installed", async () => {
  const themed = await scaffold("themed", { theme: "cold" });
  await installStylePack(themed);
  await writeScript(themed);
  const c = capture();
  assert.equal(
    await runDraft(["compile", themed, "--episode", "ep-002", "--json"], c.io),
    EXIT_OK,
    c.err.join("\n"),
  );
  const report = JSON.parse(c.out.join("\n"));
  assert.deepEqual(report.letteringTheme, { id: "cold", applied: true });
  const draft = JSON.parse(await readFile(join(themed, ".toony", "drafts", "ep-002.json"), "utf8"));
  const [narration, speech, sfx] = draft.bundle.lettering;
  assert.equal(narration.fill, "#1b1b1b");
  assert.equal(narration.textColor, "#f3f3f3");
  assert.equal(speech.fontFamily, "bangers");
  assert.deepEqual(speech.border, { width: 3, color: "#2a1a05" });
  assert.equal(sfx.sfxMode, "impact_band");
  assert.ok(
    report.defaults.some(
      (d: { id: string; field: string }) => d.id === speech.id && d.field === "fontFamily",
    ),
  );

  const missing = await scaffold("missing", { theme: "warm" });
  await writeScript(missing);
  const m = capture();
  assert.equal(
    await runDraft(["compile", missing, "--episode", "ep-002", "--json"], m.io),
    EXIT_OK,
  );
  assert.match(m.err.join("\n"), /lettering theme "warm", which no installed pack provides/);
  assert.deepEqual(JSON.parse(m.out.join("\n")).letteringTheme, { id: "warm", applied: false });
  const bare = JSON.parse(await readFile(join(missing, ".toony", "drafts", "ep-002.json"), "utf8"));
  assert.equal(bare.bundle.lettering[1].fontFamily, undefined);
});

test("generate composes the lexicon into the prompt and the negative prompt, and records it", async () => {
  const dir = await scaffold("lex", { lexicon: "cold" });
  await installStylePack(dir);
  const comfy = await startFakeComfy(pngWithText());
  try {
    const c = capture({ TOONY_COMFYUI_URL: comfy.url });
    assert.equal(
      await runGenerate(
        [dir, "--episode", "ep-001", "--cut", "cut-001", "--seed", "3", "--allow-remote"],
        c.io,
      ),
      EXIT_OK,
      c.err.join("\n"),
    );
    const prompt = comfy.prompts()[0] ?? "";
    assert.ok(prompt.endsWith("flat cel shading, clean ink line"), prompt);
    assert.ok(
      prompt.includes("color palette, flat cel shading"),
      "the clause follows the palette clause",
    );
    const body = JSON.parse(comfy.bodies()[0] ?? "{}") as {
      prompt: Record<string, { inputs: Record<string, unknown> }>;
    };
    assert.equal(body.prompt["7"]?.inputs.text, "lowres, watermark, blurry");
    const log = JSON.parse(
      await readFile(join(dir, "episodes", "ep-001", "logs", "ingest.json"), "utf8"),
    );
    assert.deepEqual(log[0].renderInputs.styleLexicon, {
      id: "cold",
      ...{ styleClause: LEXICON.styleClause, negativeBase: LEXICON.negativeBase },
    });
    assert.equal(
      log[0].renderInputs.negativePrompt,
      "blurry",
      "the cut's own negative is recorded as its own",
    );
    const cut = (await loadProject(dir)).project.episodes[0]?.cuts[0];
    assert.equal(cut?.imagePrompt, "a pier at dawn", "the write-back keeps the cut's own prompt");
    assert.equal(cut?.negativePrompt, "blurry");
    // A bare re-run repeats the same request.
    assert.equal(
      await runGenerate(
        [dir, "--episode", "ep-001", "--cut", "cut-001", "--allow-remote"],
        capture({ TOONY_COMFYUI_URL: comfy.url }).io,
      ),
      EXIT_OK,
    );
    const [a, b] = comfy.bodies().map(normalizeClientId);
    assert.equal(b, a);
  } finally {
    comfy.close();
  }
});

test("a project that selects no lexicon sends byte-identical requests, pack installed or not", async () => {
  const withPack = await scaffold("with", {});
  await installStylePack(withPack);
  const without = await scaffold("without", {});
  const comfy = await startFakeComfy(pngWithText());
  try {
    const env = { TOONY_COMFYUI_URL: comfy.url };
    for (const dir of [withPack, without]) {
      assert.equal(
        await runGenerate(
          [dir, "--episode", "ep-001", "--cut", "cut-001", "--seed", "3", "--allow-remote"],
          capture(env).io,
        ),
        EXIT_OK,
      );
    }
    const [a, b] = comfy.bodies().map(normalizeClientId);
    assert.equal(a, b);
    const log = JSON.parse(
      await readFile(join(withPack, "episodes", "ep-001", "logs", "ingest.json"), "utf8"),
    );
    assert.equal(Object.hasOwn(log[0].renderInputs, "styleLexicon"), false);
  } finally {
    comfy.close();
  }
});

test("a selected lexicon no installed pack provides refuses the run before any request", async () => {
  const dir = await scaffold("orphan", { lexicon: "warm" });
  const comfy = await startFakeComfy(pngWithText());
  try {
    const c = capture({ TOONY_COMFYUI_URL: comfy.url });
    assert.equal(
      await runGenerate([dir, "--episode", "ep-001", "--cut", "cut-001", "--allow-remote"], c.io),
      EXIT_USAGE,
    );
    assert.match(c.err.join("\n"), /style lexicon "warm", which no installed pack provides/);
    assert.equal(comfy.calls(), 0);
  } finally {
    comfy.close();
  }
});

test("packs list names themes and lexicons, as text and as JSON", async () => {
  const dir = await scaffold("list", {});
  await installStylePack(dir);
  const text = capture();
  assert.equal(await runPacks(["list", dir], text.io), EXIT_OK);
  assert.match(text.out.join("\n"), /letteringThemes\s+cold/);
  assert.match(text.out.join("\n"), /styleLexicons\s+cold/);
  const json = capture();
  assert.equal(await runPacks(["list", dir, "--json"], json.io), EXIT_OK);
  const report = JSON.parse(json.out.join("\n")) as {
    packs: Array<{ contributes: Record<string, string[]> }>;
  };
  assert.deepEqual(report.packs[0]?.contributes.letteringThemes, ["cold"]);
  assert.deepEqual(report.packs[0]?.contributes.styleLexicons, ["cold"]);
});
