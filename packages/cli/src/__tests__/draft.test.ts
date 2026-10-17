// `toony draft compile|show|apply` through the command surface (#312).
//
// The project-io tests prove the compiler, the diff and the apply. These prove
// the command: what it prints and exits with, that compile and show write no
// project byte, that the pre-apply geometry equals `toony plan --episode` after
// apply, that the two pixel-free craft findings reach the report, and that a
// compiled cut composes the same prompt a hand-authored cut with the same scene
// text does.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { loadProject, writeBrief, writeEpisodeScript } from "@toony/project-io";
import {
  type Character,
  EPISODE_SCRIPT_FORMAT_VERSION,
  type EpisodeScript,
  PRODUCTION_BRIEF_FORMAT_VERSION,
} from "@toony/schema";
import { runDraft } from "../commands/draft.js";
import { injectCharacterLockstrings } from "../commands/generate.js";
import { runInit } from "../commands/init.js";
import { runPlan } from "../commands/plan.js";
import { EXIT_OK, EXIT_USAGE, EXIT_VALIDATION } from "../exit.js";
import { appendPaletteClause } from "../palette.js";

let workdir: string;

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { cwd: workdir, out: (l: string) => out.push(l), err: (l: string) => err.push(l) },
    out,
    err,
  };
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), "toony-cli-draft-"));
});

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

const CAST: Character[] = [
  { id: "mira", name: "Mira", lockstring: "teal coat, cropped hair, ink line" },
];

async function scaffold(): Promise<string> {
  assert.equal(await runInit(["demo"], capture().io), EXIT_OK);
  const dir = join(workdir, "demo");
  const { writeWebtoon } = await import("@toony/project-io");
  const loaded = await loadProject(dir);
  await writeWebtoon(dir, { ...loaded.project.webtoon, characters: CAST });
  return dir;
}

async function writeScript(dir: string, episodeId: string, over: Partial<EpisodeScript> = {}) {
  const revision = await writeBrief(dir, {
    briefFormat: PRODUCTION_BRIEF_FORMAT_VERSION,
    intent: "A harbour short.",
    audience: "Anyone.",
    world: "A harbour.",
    storyGoals: ["Keep it short."],
  });
  const script: EpisodeScript = {
    scriptFormat: EPISODE_SCRIPT_FORMAT_VERSION,
    episodeId,
    briefRevision: revision,
    beats: [
      {
        id: "beat-001",
        purpose: "Open.",
        cuts: [
          {
            id: "sc-001",
            intent: "Open.",
            scene: "The harbour before dawn.",
            characters: ["mira"],
            shotType: "establishing_wide",
            palette: "#9fb4c7",
            dialogue: [{ speaker: null, text: "The tide keeps its own books." }],
            transitionAfter: { type: "gutter" },
          },
          {
            id: "sc-002",
            intent: "Turn.",
            scene: "Mira on the pier.",
            characters: ["mira"],
            shotType: "close_up",
            dialogue: [{ speaker: "mira", text: "Early." }],
          },
        ],
      },
    ],
    ...over,
  };
  await writeEpisodeScript(dir, script);
  return script;
}

async function snapshot(root: string, skip: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  async function walk(dir: string, rel: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const next = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (skip.some((prefix) => next === prefix || next.startsWith(`${prefix}/`))) continue;
      if (entry.isDirectory()) await walk(join(dir, entry.name), next);
      else
        out.set(
          next,
          createHash("sha256")
            .update(await readFile(join(dir, entry.name)))
            .digest("hex"),
        );
    }
  }
  await walk(root, "");
  return out;
}

test("compile writes a draft under .toony, reports, and changes no project file", async () => {
  const dir = await scaffold();
  await writeScript(dir, "ep-002");
  const before = await snapshot(dir, [".toony"]);

  const c = capture();
  const code = await runDraft(["compile", dir, "--episode", "ep-002", "--json"], c.io);
  assert.equal(code, EXIT_OK, c.err.join("\n"));
  const report = JSON.parse(c.out.join("\n"));
  assert.equal(report.applied, false);
  assert.match(report.draft, /\.toony\/drafts\/ep-002\.json$/);
  assert.deepEqual(report.records, { cuts: 2, transitions: 1, overlays: 2 });
  assert.ok(report.defaults.some((d: { field: string }) => d.field === "gutterHeight"));
  assert.ok(Array.isArray(report.lint.findings));
  assert.ok(report.lint.notRun.length > 0);
  assert.equal(report.geometry.cuts, 2);
  assert.equal(report.geometry.cutsWithoutDeclaredShape, 2, "a script states no shape");
  assert.ok(report.geometry.unchecked.length > 0);
  assert.equal(report.diff.episodeExists, false);
  assert.deepEqual(report.conflicts, []);
  assert.deepEqual(await snapshot(dir, [".toony"]), before);

  const text = capture();
  assert.equal(await runDraft(["compile", dir, "--episode", "ep-002"], text.io), EXIT_OK);
  const joined = text.out.join("\n");
  assert.match(joined, /draft written: .*not applied/);
  assert.match(joined, /defaulted fields:/);
  assert.match(joined, /not run:/);
  assert.match(joined, /geometry at \d+px/);
  assert.match(joined, /conflicts: none/);
});

test("the draft's geometry equals toony plan --episode after apply, field by field", async () => {
  const dir = await scaffold();
  await writeScript(dir, "ep-002");
  const compiled = capture();
  assert.equal(
    await runDraft(
      ["compile", dir, "--episode", "ep-002", "--json", "--width", "640"],
      compiled.io,
    ),
    EXIT_OK,
  );
  const before = JSON.parse(compiled.out.join("\n")).geometry;

  assert.equal(await runDraft(["apply", dir, "--episode", "ep-002"], capture().io), EXIT_OK);
  const planned = capture();
  assert.equal(
    await runPlan([dir, "--episode", "ep-002", "--json", "--width", "640"], planned.io),
    EXIT_OK,
  );
  const after = JSON.parse(planned.out.join("\n"));
  for (const key of [
    "width",
    "height",
    "screenAspect",
    "screenHeight",
    "cuts",
    "cutsWithoutDeclaredShape",
    "fallbackAspect",
    "metrics",
    "unchecked",
    "transitions",
  ]) {
    assert.deepEqual(before[key], after[key], key);
  }
});

test("compile reports transition monotony and lettering overflow before any art exists", async () => {
  const dir = await scaffold();
  const cuts = Array.from({ length: 6 }, (_u, i) => ({
    id: `sc-${i}`,
    intent: "Beat.",
    scene: `Panel ${i}.`,
    shotType: "medium" as const,
    dialogue:
      i === 0
        ? [{ speaker: null, text: Array.from({ length: 60 }, () => "overflowing").join(" ") }]
        : [],
    ...(i < 5 ? { transitionAfter: { type: "gutter" as const } } : {}),
  }));
  await writeScript(dir, "ep-002", {
    beats: [{ id: "beat-001", purpose: "Monotony.", cuts }],
  });
  const c = capture();
  const code = await runDraft(["compile", dir, "--episode", "ep-002", "--json"], c.io);
  assert.equal(code, EXIT_OK, c.err.join("\n"));
  const codes = JSON.parse(c.out.join("\n")).lint.findings.map((f: { code: string }) => f.code);
  assert.ok(codes.includes("craft/transition-monotony"), codes.join(", "));
  assert.ok(codes.includes("lettering/overflow"), codes.join(", "));
});

test("a compiled cut composes the same prompt as a hand-authored cut with the same scene text", async () => {
  const dir = await scaffold();
  await writeScript(dir, "ep-002");
  assert.equal(await runDraft(["compile", dir, "--episode", "ep-002"], capture().io), EXIT_OK);
  assert.equal(await runDraft(["apply", dir, "--episode", "ep-002"], capture().io), EXIT_OK);
  const loaded = await loadProject(dir);
  const compiled = loaded.project.episodes
    .find((e) => e.episode.id === "ep-002")
    ?.cuts.find((cut) => cut.id === "sc-001");
  assert.ok(compiled);
  assert.equal(compiled.imagePrompt, "The harbour before dawn.");
  const hand = {
    id: "hand",
    image: null,
    imagePrompt: "The harbour before dawn.",
    negativePrompt: "",
    characters: ["mira"],
    palette: "#9fb4c7",
  };
  const compose = (cut: typeof hand) =>
    appendPaletteClause(
      injectCharacterLockstrings(cut.imagePrompt, cut.characters, CAST),
      cut.palette,
    );
  assert.equal(compose(compiled as typeof hand), compose(hand));
  assert.match(
    compose(hand),
    /^teal coat/,
    "the lockstring composes at generate time, not in the cut",
  );
});

test("show reports the diff and exits 1 on a conflict; apply refuses with nothing written", async () => {
  const dir = await scaffold();
  const loaded = await loadProject(dir);
  const existing = loaded.project.episodes[0];
  assert.ok(existing);
  const id = existing.episode.id;
  const first = existing.cuts[0];
  assert.ok(first);
  // A script that names the scaffold's own first cut with a different prompt.
  await writeScript(dir, id, {
    beats: [
      {
        id: "beat-001",
        purpose: "Rewrite.",
        cuts: [
          { id: first.id, intent: "Rewrite.", scene: "A different prompt." },
          { id: "sc-new", intent: "Add.", scene: "A new cut." },
        ],
      },
    ],
  });
  const compiled = capture();
  assert.equal(await runDraft(["compile", dir, "--episode", id], compiled.io), EXIT_VALIDATION);
  assert.match(compiled.out.join("\n"), /conflicts: \d+; apply refuses/);

  const shown = capture();
  assert.equal(await runDraft(["show", dir, "--episode", id, "--json"], shown.io), EXIT_VALIDATION);
  const report = JSON.parse(shown.out.join("\n"));
  assert.ok(
    report.conflicts.some(
      (c: { id: string; field: string }) => c.id === first.id && c.field === "imagePrompt",
    ),
  );

  const before = await snapshot(dir, [".toony"]);
  const applied = capture();
  assert.equal(await runDraft(["apply", dir, "--episode", id], applied.io), EXIT_VALIDATION);
  assert.match(applied.err.join("\n"), /apply refused: \d+ conflict\(s\)/);
  assert.match(applied.err.join("\n"), new RegExp(`cut ${first.id} imagePrompt`));
  assert.deepEqual(await snapshot(dir, [".toony"]), before);
});

test("apply refuses when the project moved after the last report, and succeeds after show", async () => {
  const dir = await scaffold();
  await writeScript(dir, "ep-002");
  assert.equal(await runDraft(["compile", dir, "--episode", "ep-002"], capture().io), EXIT_OK);
  const { writeWebtoon } = await import("@toony/project-io");
  const loaded = await loadProject(dir);
  await writeWebtoon(dir, { ...loaded.project.webtoon, title: "Renamed" });

  const refused = capture();
  assert.equal(await runDraft(["apply", dir, "--episode", "ep-002"], refused.io), EXIT_VALIDATION);
  assert.match(refused.err.join("\n"), /changed since the draft was last reported/);

  assert.equal(await runDraft(["show", dir, "--episode", "ep-002"], capture().io), EXIT_OK);
  const applied = capture();
  assert.equal(await runDraft(["apply", dir, "--episode", "ep-002"], applied.io), EXIT_OK);
  assert.match(applied.out.join("\n"), /applied draft to episode ep-002 \(created\)/);
  assert.equal((await loadProject(dir)).validation.valid, true);
});

test("usage errors: missing subcommand, missing --episode, unknown option, no script, no draft", async () => {
  const dir = await scaffold();
  assert.equal(await runDraft([], capture().io), EXIT_USAGE);
  assert.equal(await runDraft(["bogus"], capture().io), EXIT_USAGE);
  assert.equal(await runDraft(["compile", dir], capture().io), EXIT_USAGE);
  assert.equal(
    await runDraft(["compile", dir, "--episode", "x", "--force"], capture().io),
    EXIT_USAGE,
  );
  assert.equal(
    await runDraft(["show", dir, "--episode", "x", "--from", "f"], capture().io),
    EXIT_USAGE,
  );
  const noScript = capture();
  assert.equal(await runDraft(["compile", dir, "--episode", "ep-009"], noScript.io), EXIT_USAGE);
  assert.match(noScript.err.join("\n"), /no script for episode ep-009/);
  const noDraft = capture();
  assert.equal(await runDraft(["show", dir, "--episode", "ep-009"], noDraft.io), EXIT_USAGE);
  assert.match(noDraft.err.join("\n"), /no draft for episode ep-009/);
  assert.equal(
    await runDraft(["apply", dir, "--episode", "ep-009"], capture().io),
    EXIT_VALIDATION,
  );
});

test("compile --from reads a script elsewhere and still checks the recorded episode id", async () => {
  const dir = await scaffold();
  const script = await writeScript(dir, "ep-002");
  const elsewhere = join(workdir, "elsewhere.json");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(elsewhere, `${JSON.stringify(script, null, 2)}\n`);
  assert.equal(
    await runDraft(["compile", dir, "--episode", "ep-002", "--from", elsewhere], capture().io),
    EXIT_OK,
  );
  const wrong = capture();
  assert.equal(
    await runDraft(["compile", dir, "--episode", "ep-003", "--from", elsewhere], wrong.io),
    EXIT_VALIDATION,
  );
  assert.match(wrong.err.join("\n"), /does not validate/);
});

test("a script that names an unknown character compiles, and the warning is in the report", async () => {
  const dir = await scaffold();
  await writeScript(dir, "ep-002", {
    beats: [
      {
        id: "beat-001",
        purpose: "Open.",
        cuts: [{ id: "sc-001", intent: "Open.", scene: "A pier.", characters: ["ghost"] }],
      },
    ],
  });
  const c = capture();
  assert.equal(await runDraft(["compile", dir, "--episode", "ep-002", "--json"], c.io), EXIT_OK);
  const report = JSON.parse(c.out.join("\n"));
  assert.ok(
    report.scriptWarnings.some((w: { code: string }) => w.code === "script.character.unknown-ref"),
  );
  assert.ok(
    report.lint.findings.some((f: { code: string }) => f.code === "character/unknown-ref"),
    "the same answer the real cut gets",
  );
});

test("the report says what the episode continues from (#329)", async () => {
  const dir = await scaffold();
  await writeScript(dir, "ep-002", {
    continuity: { previousEpisodeId: "ep-001", startsFrom: "Mira has not paid." },
  });
  const c = capture();
  assert.equal(await runDraft(["compile", dir, "--episode", "ep-002"], c.io), EXIT_OK);
  assert.match(c.out.join("\n"), /continues from ep-001: "Mira has not paid\."/);
  const json = capture();
  assert.equal(await runDraft(["show", dir, "--episode", "ep-002", "--json"], json.io), EXIT_OK);
  assert.deepEqual(JSON.parse(json.out.join("\n")).continuity, {
    previousEpisodeId: "ep-001",
    startsFrom: "Mira has not paid.",
    previousExists: true,
  });
  await writeScript(dir, "ep-003", {
    continuity: { previousEpisodeId: "ep-009", startsFrom: "Later." },
  });
  const later = capture();
  assert.equal(await runDraft(["compile", dir, "--episode", "ep-003"], later.io), EXIT_OK);
  assert.match(later.out.join("\n"), /continues from ep-009 \(not in the project yet\)/);
  assert.match(later.out.join("\n"), /script\.previous-episode-missing/);
});
