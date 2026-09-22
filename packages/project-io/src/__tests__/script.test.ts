// On-disk behaviour of the authored planning artifacts (#311).
//
// Two things are proven here. First, the family itself: what the readers report,
// what the writers refuse, and that a revision has a durable name. Second, and
// more important, the boundary — that adding this folder to a project changes
// nothing about how the rest of the repo reads that project.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  type Character,
  type Cut,
  EPISODE_SCRIPT_FORMAT_VERSION,
  type EpisodeScript,
  PRODUCTION_BRIEF_FORMAT_VERSION,
  type ProductionBrief,
  type Project,
  validateProject,
} from "@toony/schema";
import { encodeJson } from "../format.js";
import { briefPath, episodeScriptFile, SCRIPT_DIR, scriptEpisodesDir } from "../paths.js";
import { loadProject } from "../reader.js";
import { buildInitialProject } from "../scaffold.js";
import {
  readBrief,
  readEpisodeScript,
  revisionId,
  writeBrief,
  writeEpisodeScript,
} from "../script.js";
import { listWorkspace } from "../workspace.js";
import {
  writeCuts,
  writeLettering,
  writeProject,
  writeTransitions,
  writeWebtoon,
} from "../writer.js";

const CAST: Character[] = [
  { id: "mira", name: "Mira", lockstring: "teal coat, cropped hair, ink line" },
  { id: "sol", name: "Sol", lockstring: "grey scarf, round glasses, ink line" },
];

function brief(over: Partial<ProductionBrief> = {}): ProductionBrief {
  return {
    briefFormat: PRODUCTION_BRIEF_FORMAT_VERSION,
    intent: "A quiet harbour story about a debt nobody wrote down.",
    audience: "Adult readers who want a slow burn.",
    world: "A working harbour town, late autumn.",
    storyGoals: ["Make the debt feel physical."],
    ...over,
  };
}

function script(episodeId: string, briefRevision: string, over: Partial<EpisodeScript> = {}) {
  const value: EpisodeScript = {
    scriptFormat: EPISODE_SCRIPT_FORMAT_VERSION,
    episodeId,
    briefRevision,
    beats: [
      {
        id: "beat-001",
        purpose: "Establish the debt.",
        goals: [{ characterId: "mira", goal: "Get through the morning unseen." }],
        cuts: [
          {
            id: "sc-001",
            intent: "Open on the thing the episode is about.",
            scene: "The harbour before dawn.",
            characters: ["mira"],
            dialogue: [{ speaker: null, text: "The tide keeps its own books." }],
          },
        ],
      },
    ],
    ...over,
  };
  return value;
}

/** A script of `count` cuts naming exactly `cast`, for the length/roster tests. */
function scriptOfLength(
  episodeId: string,
  briefRevision: string,
  count: number,
  cast: string[],
): EpisodeScript {
  return {
    scriptFormat: EPISODE_SCRIPT_FORMAT_VERSION,
    episodeId,
    briefRevision,
    beats: [
      {
        id: "beat-001",
        purpose: "The whole episode.",
        cuts: Array.from({ length: count }, (_unused, i) => ({
          id: `sc-${i}`,
          intent: "One cut.",
          scene: "The harbour.",
          characters: cast,
        })),
      },
    ],
  };
}

let workdir: string;

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), "toony-script-"));
});

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

async function newProject(name = "demo"): Promise<string> {
  const root = join(workdir, name);
  const project = buildInitialProject(name);
  project.webtoon.characters = CAST;
  await writeProject(root, project);
  return root;
}

// --- Readers ----------------------------------------------------------------

test("an absent brief is reported as absent, not as an error", async () => {
  const root = await newProject();
  const loaded = await readBrief(root);
  assert.equal(loaded.absent, true);
  assert.equal(loaded.brief, null);
  assert.equal(loaded.revision, null);
  assert.deepEqual(loaded.validation.issues, []);
});

test("an absent script is reported as absent, not as an error", async () => {
  const root = await newProject();
  const loaded = await readEpisodeScript(root, "ep-001", CAST);
  assert.equal(loaded.absent, true);
  assert.equal(loaded.script, null);
  assert.deepEqual(loaded.validation.issues, []);
});

test("a malformed brief comes back with issues and a null brief, not a throw", async () => {
  const root = await newProject();
  await mkdir(join(root, SCRIPT_DIR), { recursive: true });
  await writeFile(briefPath(root), encodeJson({ briefFormat: 1 }));
  const loaded = await readBrief(root);
  assert.equal(loaded.absent, false);
  assert.equal(loaded.brief, null);
  assert.equal(loaded.validation.valid, false);
});

test("a script whose filename disagrees with its recorded episodeId is reported", async () => {
  const root = await newProject();
  const revision = await writeBrief(root, brief());
  await writeEpisodeScript(root, script("ep-001", revision));
  // Copy the file under another episode's name, the way a rename would.
  const bytes = await readFile(episodeScriptFile(root, "ep-001"), "utf8");
  await writeFile(episodeScriptFile(root, "ep-002"), bytes);

  const loaded = await readEpisodeScript(root, "ep-002", CAST);
  assert.ok(loaded.script, "a disagreeing script must still read");
  const issue = loaded.validation.issues.find(
    (candidate) => candidate.code === "script.episode-id-mismatch",
  );
  assert.ok(issue, JSON.stringify(loaded.validation.issues));
  assert.equal(issue.path, "script.episodeId");
  assert.match(issue.message, /ep-001/);
});

test("an unresolved character id surfaces the id and the cut that names it", async () => {
  const root = await newProject();
  const revision = await writeBrief(root, brief());
  const value = script("ep-001", revision);
  const cut = value.beats[0]?.cuts[0];
  assert.ok(cut);
  cut.characters = ["mira", "nell"];
  cut.dialogue = [{ speaker: "kestrel", text: "You are short again." }];
  await writeEpisodeScript(root, value);

  const loaded = await readEpisodeScript(root, "ep-001", CAST);
  assert.ok(loaded.script, "an unresolved ref must not stop the script reading");
  const unknown = loaded.validation.issues.filter(
    (issue) => issue.code === "script.character.unknown-ref",
  );
  assert.equal(unknown.length, 2, JSON.stringify(loaded.validation.issues));
  for (const issue of unknown) assert.match(issue.message, /sc-001/);
  assert.ok(unknown.some((issue) => issue.message.includes("nell")));
  assert.ok(unknown.some((issue) => issue.message.includes("kestrel")));
  assert.ok(unknown.every((issue) => issue.path.startsWith("script.beats[0].cuts[0].")));
});

test("a character the brief cast names resolves, and the registry is not the only source", async () => {
  const root = await newProject();
  const revision = await writeBrief(
    root,
    brief({ cast: [{ characterId: "nell", role: "The harbour master." }] }),
  );
  const value = script("ep-001", revision);
  const cut = value.beats[0]?.cuts[0];
  assert.ok(cut);
  cut.characters = ["nell"];
  await writeEpisodeScript(root, value);

  const loaded = await readEpisodeScript(root, "ep-001", CAST);
  assert.deepEqual(loaded.validation.issues, []);
});

test("an unresolved beat goal is reported against the beat", async () => {
  const root = await newProject();
  const revision = await writeBrief(root, brief());
  const value = script("ep-001", revision);
  const beat = value.beats[0];
  assert.ok(beat);
  beat.goals = [{ characterId: "nell", goal: "Close the ledger." }];
  await writeEpisodeScript(root, value);

  const loaded = await readEpisodeScript(root, "ep-001", CAST);
  const issue = loaded.validation.issues.find(
    (candidate) => candidate.code === "script.character.unknown-ref",
  );
  assert.ok(issue, JSON.stringify(loaded.validation.issues));
  assert.equal(issue.path, "script.beats[0].goals[0].characterId");
  assert.match(issue.message, /beat-001/);
});

test("a script whose brief is gone still reads, and says the brief is missing", async () => {
  const root = await newProject();
  const revision = await writeBrief(root, brief());
  await writeEpisodeScript(root, script("ep-001", revision));
  await rm(briefPath(root));

  const loaded = await readEpisodeScript(root, "ep-001", CAST);
  assert.ok(loaded.script, "a script must not become unreadable when the brief goes");
  const issue = loaded.validation.issues.find(
    (candidate) => candidate.code === "script.brief-missing",
  );
  assert.ok(issue, JSON.stringify(loaded.validation.issues));
  assert.equal(issue.path, "script.briefRevision");
});

// --- Round trip and revision identity ---------------------------------------

test("a written artifact reads back equal and a second write is byte-identical", async () => {
  const root = await newProject();
  const authored = brief({ contentConstraints: ["No on-page violence."] });
  const revision = await writeBrief(root, authored);
  const first = await readFile(briefPath(root), "utf8");
  const reread = await readBrief(root);
  assert.deepEqual(reread.brief, authored);
  assert.equal(reread.revision, revision);

  await writeBrief(root, authored);
  assert.equal(await readFile(briefPath(root), "utf8"), first);

  const authoredScript = script("ep-001", revision);
  await writeEpisodeScript(root, authoredScript);
  const firstScriptBytes = await readFile(episodeScriptFile(root, "ep-001"), "utf8");
  const loaded = await readEpisodeScript(root, "ep-001", CAST);
  assert.deepEqual(loaded.script, authoredScript);
  await writeEpisodeScript(root, authoredScript);
  assert.equal(await readFile(episodeScriptFile(root, "ep-001"), "utf8"), firstScriptBytes);
});

test("a revision identity is stable across a rewrite and differs on any change", async () => {
  const authored = brief();
  assert.equal(revisionId(authored), revisionId(brief()));
  // Key order is not content: the persisted bytes are canonical either way.
  assert.equal(revisionId({ ...authored }), revisionId(authored));
  assert.notEqual(revisionId(brief({ audience: "Someone else." })), revisionId(authored));
  assert.notEqual(
    revisionId(brief({ storyGoals: ["Make the debt feel physical.", "And then some."] })),
    revisionId(authored),
  );

  const root = await newProject();
  const written = await writeBrief(root, authored);
  assert.equal(written, revisionId(authored));
  assert.equal(await writeBrief(root, authored), written);
});

// --- Episode independence ---------------------------------------------------

test("one project holds scripts of different lengths and different casts", async () => {
  const root = await newProject();
  const revision = await writeBrief(root, brief());

  const first = scriptOfLength("ep-001", revision, 67, ["mira"]);
  await writeEpisodeScript(root, first);
  const firstBytes = await readFile(episodeScriptFile(root, "ep-001"), "utf8");

  const second = scriptOfLength("ep-002", revision, 103, ["sol"]);
  await writeEpisodeScript(root, second);

  const loadedFirst = await readEpisodeScript(root, "ep-001", CAST);
  const loadedSecond = await readEpisodeScript(root, "ep-002", CAST);
  assert.deepEqual(loadedFirst.validation.issues, []);
  assert.deepEqual(loadedSecond.validation.issues, []);
  assert.equal(loadedFirst.script?.beats[0]?.cuts.length, 67);
  assert.equal(loadedSecond.script?.beats[0]?.cuts.length, 103);

  // Writing the second never touched the first.
  assert.equal(await readFile(episodeScriptFile(root, "ep-001"), "utf8"), firstBytes);
});

test("a script may be written for an episode the project does not have", async () => {
  const root = await newProject();
  const revision = await writeBrief(root, brief());
  await writeEpisodeScript(root, script("ep-404", revision));
  const loaded = await readEpisodeScript(root, "ep-404", CAST);
  assert.deepEqual(loaded.validation.issues, []);
  const project = await loadProject(root);
  assert.equal(project.validation.valid, true, JSON.stringify(project.validation.issues));
  assert.equal(project.project.episodes.length, 1);
});

test("a script id that differs only by case is refused, naming both ids", async () => {
  const root = await newProject();
  const revision = await writeBrief(root, brief());
  await writeEpisodeScript(root, script("ep-A", revision));
  const before = await readFile(episodeScriptFile(root, "ep-A"), "utf8");
  const listedBefore = (await readdir(scriptEpisodesDir(root))).sort();

  await assert.rejects(
    writeEpisodeScript(root, script("ep-a", revision)),
    (error: Error) =>
      error.name === "ProjectIoError" &&
      error.message.includes('"ep-a"') &&
      error.message.includes('"ep-A"'),
  );

  // The refusal is decided here, not by the filesystem: on a case-insensitive
  // filesystem nothing was overwritten, and on a case-sensitive one nothing was
  // added.
  assert.equal(await readFile(episodeScriptFile(root, "ep-A"), "utf8"), before);
  assert.deepEqual((await readdir(scriptEpisodesDir(root))).sort(), listedBefore);
});

// --- Revising the brief -----------------------------------------------------

test("the brief is editable while scripts exist, and each script says it is stale", async () => {
  const root = await newProject();
  const first = await writeBrief(root, brief());
  await writeEpisodeScript(root, script("ep-001", first));
  await writeEpisodeScript(root, script("ep-002", first));

  const second = await writeBrief(root, brief({ audience: "Readers who want it faster." }));
  assert.notEqual(second, first);

  for (const id of ["ep-001", "ep-002"]) {
    const loaded = await readEpisodeScript(root, id, CAST);
    assert.ok(loaded.script, `${id} stopped reading after the brief was edited`);
    const issue = loaded.validation.issues.find(
      (candidate) => candidate.code === "script.brief-stale",
    );
    assert.ok(issue, `${id}: ${JSON.stringify(loaded.validation.issues)}`);
    assert.equal(issue.path, "script.briefRevision");
    assert.match(issue.message, new RegExp(second));
  }
});

// --- Refusals ---------------------------------------------------------------

test("an invalid artifact is refused before any byte is written", async () => {
  const root = await newProject();
  await assert.rejects(
    writeBrief(root, brief({ storyGoals: [] })),
    (error: Error) => error.name === "ProjectIoError",
  );
  await assert.rejects(readFile(briefPath(root), "utf8"));

  const revision = await writeBrief(root, brief());
  const bad = script("../../outside", revision);
  await assert.rejects(
    writeEpisodeScript(root, bad),
    (error: Error) => error.name === "ProjectIoError",
  );
  await assert.rejects(readdir(scriptEpisodesDir(root)));
});

// --- The boundary -----------------------------------------------------------

test("a fresh writeProject creates no script folder", async () => {
  const root = await newProject();
  await assert.rejects(readdir(join(root, SCRIPT_DIR)));
});

test("the surgical writers leave every file under script/ byte-identical", async () => {
  const root = await newProject();
  const revision = await writeBrief(root, brief());
  await writeEpisodeScript(root, script("ep-001", revision));
  const before = await readTree(join(root, SCRIPT_DIR));

  const loaded = await loadProject(root);
  const bundle = loaded.project.episodes[0];
  assert.ok(bundle);
  await writeWebtoon(root, loaded.project.webtoon);
  await writeCuts(root, bundle.episode.id, bundle.cuts);
  await writeLettering(root, bundle.episode.id, bundle.lettering);
  await writeTransitions(root, bundle.episode.id, bundle.episode, bundle.transitions, bundle.cuts);

  assert.deepEqual(await readTree(join(root, SCRIPT_DIR)), before);
});

test("loadProject and validateProject are unchanged by the folder, malformed file and all", async () => {
  const root = await newProject();
  const without = await loadProject(root);
  const withoutValidation = validateProject(without.project);

  const revision = await writeBrief(root, brief());
  await writeEpisodeScript(root, script("ep-001", revision));
  await writeFile(episodeScriptFile(root, "ep-002"), "{ this is not json");

  const withFolder = await loadProject(root);
  assert.deepEqual(withFolder.project, without.project);
  assert.deepEqual(withFolder.validation, without.validation);
  assert.deepEqual(validateProject(withFolder.project), withoutValidation);
  assert.equal(withFolder.validation.valid, true, JSON.stringify(withFolder.validation.issues));
});

test("listWorkspace reports the same entry with the folder as without it", async () => {
  const root = join(workdir, "demo");
  const project: Project = buildInitialProject("demo");
  project.webtoon.characters = CAST;
  await writeProject(root, project);

  const before = await listWorkspace(workdir);
  const revision = await writeBrief(root, brief());
  await writeEpisodeScript(root, script("ep-001", revision));
  await writeFile(episodeScriptFile(root, "ep-002"), "{ this is not json");
  const after = await listWorkspace(workdir);

  assert.deepEqual(after, before);
});

test("a project with no script folder is untouched by everything above", async () => {
  const root = await newProject("plain");
  const before = await loadProject(root);
  const cuts: Cut[] = before.project.episodes[0]?.cuts ?? [];
  await writeCuts(root, "ep-001", cuts);
  const after = await loadProject(root);
  assert.deepEqual(after.project, before.project);
  assert.equal((await readBrief(root)).absent, true);
  assert.equal((await readEpisodeScript(root, "ep-001", CAST)).absent, true);
  await assert.rejects(readdir(join(root, SCRIPT_DIR)));
});

// This file compiles to dist-test/__tests__/, so the repository root is four up.
function exampleRoot(name: string): string {
  return fileURLToPath(new URL(`../../../../examples/${name}`, import.meta.url));
}

test("the shipped example projects carry no planning artifacts and read as they always did", async () => {
  for (const name of ["dead-air", "last-train"]) {
    const root = exampleRoot(name);
    const loaded = await loadProject(root);
    assert.equal(
      loaded.validation.valid,
      true,
      `${name}: ${JSON.stringify(loaded.validation.issues)}`,
    );
    assert.equal((await readBrief(root)).absent, true, `${name} grew a brief`);
    const episodeId = loaded.project.episodes[0]?.episode.id;
    assert.ok(episodeId);
    const registry = loaded.project.webtoon.characters ?? [];
    const script = await readEpisodeScript(root, episodeId, registry);
    assert.equal(script.absent, true, `${name} grew a script`);
    assert.deepEqual(script.validation.issues, []);
  }
});

/** Every file under `dir` as `path -> bytes`, for a byte-identity comparison. */
async function readTree(dir: string, prefix = ""): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const key = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      Object.assign(out, await readTree(join(dir, entry.name), key));
    } else {
      out[key] = await readFile(join(dir, entry.name), "utf8");
    }
  }
  return out;
}
