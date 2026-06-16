// Round-trip and format tests for the on-disk IO layer.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import type {
  Cut,
  Episode,
  LetteringOverlay,
  Project,
  SequenceItem,
  Transition,
} from "@toony/schema";
import { decodeYaml } from "../format.js";
import { ProjectIoError } from "../index.js";
import { cutsFile, episodeFile, letteringFile, transitionsFile, webtoonPath } from "../paths.js";
import { loadProject } from "../reader.js";
import { buildInitialProject, slugify } from "../scaffold.js";
import { writeLettering, writeProject, writeTransitions } from "../writer.js";

function transition(over: Partial<Transition> = {}): Transition {
  return {
    id: "tr-001",
    type: "gutter",
    gutterHeight: 48,
    text: null,
    sfx: null,
    agentNote: null,
    humanNote: null,
    image: null,
    reviewStatus: "draft",
    ...over,
  };
}

function episodeWith(sequence: SequenceItem[]): Episode {
  return { schemaVersion: 1, id: "ep-001", title: "Episode", sequence };
}

function overlay(over: Partial<LetteringOverlay> = {}): LetteringOverlay {
  return {
    id: "ov-001",
    cutId: "cut-001",
    speaker: "Mira",
    kind: "speech",
    text: "Hello.",
    font: "Nanum Gothic",
    fill: "#ffffff",
    opacity: 1,
    border: { width: 2, color: "#101010" },
    tail: { x: 0.42, y: 0.78 },
    geometry: { x: 0.1, y: 0.12, width: 0.45, height: 0.2 },
    overflow: false,
    reviewStatus: "human-edited",
    ...over,
  };
}

let workdir: string;

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), "toony-project-io-"));
});

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

test("slugify normalizes names to safe ids", () => {
  assert.equal(slugify("My Demo Webtoon"), "my-demo-webtoon");
  assert.equal(slugify("  Spaced  "), "spaced");
  assert.equal(slugify("***"), "untitled");
});

test("write then read round-trips and validates", async () => {
  const root = join(workdir, "demo");
  await writeProject(root, buildInitialProject("demo"));
  const loaded = await loadProject(root);
  assert.equal(loaded.validation.valid, true, JSON.stringify(loaded.validation.issues));
  assert.equal(loaded.project.webtoon.projectId, "demo");
  assert.equal(loaded.project.episodes[0]?.episode.sequence.length, 3);
});

test("content files are YAML and structural files are JSON", async () => {
  const root = join(workdir, "demo");
  await writeProject(root, buildInitialProject("demo"));

  // webtoon.json + lettering.json parse as JSON.
  const webtoon = JSON.parse(await readFile(webtoonPath(root), "utf8"));
  assert.equal(webtoon.schemaVersion, 1);
  const lettering = JSON.parse(await readFile(letteringFile(root, "ep-001"), "utf8"));
  assert.ok(Array.isArray(lettering));

  // episode.yaml / cuts.yaml / transitions.yaml are YAML, not JSON.
  for (const file of [
    episodeFile(root, "ep-001"),
    cutsFile(root, "ep-001"),
    transitionsFile(root, "ep-001"),
  ]) {
    const text = await readFile(file, "utf8");
    assert.doesNotThrow(() => decodeYaml(text), `${file} should parse as YAML`);
    // Plain-JSON output would start with "{" or "["; block YAML does not.
    assert.ok(!text.trimStart().startsWith("{"), `${file} should not be JSON-object text`);
  }

  // Spot-check the YAML content actually carries the model.
  const episode = decodeYaml(await readFile(episodeFile(root, "ep-001"), "utf8")) as {
    id: string;
    sequence: unknown[];
  };
  assert.equal(episode.id, "ep-001");
  assert.equal(episode.sequence.length, 3);
});

test("writeProject output is deterministic", async () => {
  const a = join(workdir, "a");
  const b = join(workdir, "b");
  await writeProject(a, buildInitialProject("demo"));
  await writeProject(b, buildInitialProject("demo"));
  for (const rel of ["webtoon.json", "episodes/ep-001/episode.yaml"]) {
    assert.equal(
      await readFile(join(a, rel), "utf8"),
      await readFile(join(b, rel), "utf8"),
      `${rel} should be byte-stable`,
    );
  }
});

test("corrupted YAML content fails with an actionable IO error", async () => {
  const root = join(workdir, "demo");
  await writeProject(root, buildInitialProject("demo"));
  // Break YAML structure (unclosed flow sequence).
  await writeFile(cutsFile(root, "ep-001"), "- id: cut-001\n  image: [unterminated\n");
  await assert.rejects(loadProject(root), (error: unknown) => {
    assert.ok(error instanceof ProjectIoError);
    assert.match(error.message, /invalid YAML/);
    assert.match(error.file, /cuts\.yaml$/);
    return true;
  });
});

test("corrupted JSON structural file fails with an actionable IO error", async () => {
  const root = join(workdir, "demo");
  await writeProject(root, buildInitialProject("demo"));
  await writeFile(webtoonPath(root), "{ not valid json");
  await assert.rejects(loadProject(root), (error: unknown) => {
    assert.ok(error instanceof ProjectIoError);
    assert.match(error.message, /invalid JSON/);
    assert.match(error.file, /webtoon\.json$/);
    return true;
  });
});

test("a corrupted-but-parseable field surfaces as a validation issue, not a throw", async () => {
  const root = join(workdir, "demo");
  await writeProject(root, buildInitialProject("demo"));
  // Valid YAML, invalid value: gutterHeight must be a non-negative integer.
  const transitions = `- id: tr-001
  type: gutter
  gutterHeight: -5
  text: null
  sfx: null
  agentNote: null
  humanNote: null
  image: null
  reviewStatus: draft
`;
  await writeFile(transitionsFile(root, "ep-001"), transitions);
  const loaded = await loadProject(root);
  assert.equal(loaded.validation.valid, false);
  assert.ok(loaded.validation.issues.some((issue) => issue.path.includes("gutterHeight")));
});

test("writeLettering persists overlays and survives reload", async () => {
  const root = join(workdir, "demo");
  await writeProject(root, buildInitialProject("demo"));

  const overlays = [
    overlay({ id: "ov-001", text: "First line." }),
    overlay({
      id: "ov-002",
      text: "Second line.",
      tail: null,
      geometry: { x: 0.5, y: 0.5, width: 0.3, height: 0.2 },
    }),
  ];
  await writeLettering(root, "ep-001", overlays);

  const loaded = await loadProject(root);
  assert.equal(loaded.validation.valid, true, JSON.stringify(loaded.validation.issues));
  const persisted = loaded.project.episodes[0]?.lettering;
  assert.equal(persisted?.length, 2);
  assert.equal(persisted?.[0]?.id, "ov-001");
  assert.equal(persisted?.[1]?.text, "Second line.");
});

test("writeLettering output is deterministic (sorted keys, byte-stable)", async () => {
  const root = join(workdir, "demo");
  await writeProject(root, buildInitialProject("demo"));
  const overlays = [overlay()];
  await writeLettering(root, "ep-001", overlays);
  const first = await readFile(letteringFile(root, "ep-001"), "utf8");
  await writeLettering(root, "ep-001", overlays);
  const second = await readFile(letteringFile(root, "ep-001"), "utf8");
  assert.equal(first, second);
  // Sorted keys: "border" sorts before "cutId" within an overlay object.
  assert.ok(first.indexOf('"border"') < first.indexOf('"cutId"'));
});

test("writeLettering rejects an invalid overlay before writing", async () => {
  const root = join(workdir, "demo");
  await writeProject(root, buildInitialProject("demo"));
  const before = await readFile(letteringFile(root, "ep-001"), "utf8");
  // geometry x + width > 1 escapes the image bounds.
  const bad = [overlay({ geometry: { x: 0.9, y: 0.1, width: 0.4, height: 0.2 } })];
  await assert.rejects(writeLettering(root, "ep-001", bad), (error: unknown) => {
    assert.ok(error instanceof ProjectIoError);
    assert.match(error.message, /invalid lettering/);
    return true;
  });
  // The file on disk is untouched by a rejected write.
  assert.equal(await readFile(letteringFile(root, "ep-001"), "utf8"), before);
});

test("writeLettering rejects duplicate overlay ids", async () => {
  const root = join(workdir, "demo");
  await writeProject(root, buildInitialProject("demo"));
  const dupes = [overlay({ id: "dup" }), overlay({ id: "dup", text: "Other." })];
  await assert.rejects(writeLettering(root, "ep-001", dupes), (error: unknown) => {
    assert.ok(error instanceof ProjectIoError);
    assert.match(error.message, /duplicate overlay id/);
    return true;
  });
});

test("writeTransitions inserts a transition and survives reload", async () => {
  const root = join(workdir, "demo");
  await writeProject(root, buildInitialProject("demo"));
  const cuts: Cut[] = [
    { id: "cut-001", image: null },
    { id: "cut-002", image: null },
  ];
  // Insert a second transition (a scene break) before cut-002 is not possible
  // (tr-001 already sits there); instead edit tr-001 and add a leading cut span.
  const transitions = [transition({ id: "tr-001", type: "scene-break", gutterHeight: 96 })];
  const sequence: SequenceItem[] = [
    { type: "cut", id: "cut-001" },
    { type: "transition", id: "tr-001" },
    { type: "cut", id: "cut-002" },
  ];
  await writeTransitions(root, "ep-001", episodeWith(sequence), transitions, cuts);

  const loaded = await loadProject(root);
  assert.equal(loaded.validation.valid, true, JSON.stringify(loaded.validation.issues));
  const persisted = loaded.project.episodes[0]?.transitions;
  assert.equal(persisted?.length, 1);
  assert.equal(persisted?.[0]?.type, "scene-break");
  assert.equal(persisted?.[0]?.gutterHeight, 96);
  assert.equal(loaded.project.episodes[0]?.episode.sequence.length, 3);
});

test("writeTransitions writes both transitions.yaml and episode.yaml", async () => {
  const root = join(workdir, "demo");
  await writeProject(root, buildInitialProject("demo"));
  const cuts: Cut[] = [
    { id: "cut-001", image: null },
    { id: "cut-002", image: null },
  ];
  const transitions = [transition({ id: "tr-001", text: "Later that night." })];
  const sequence: SequenceItem[] = [
    { type: "cut", id: "cut-001" },
    { type: "transition", id: "tr-001" },
    { type: "cut", id: "cut-002" },
  ];
  await writeTransitions(root, "ep-001", episodeWith(sequence), transitions, cuts);
  const tr = decodeYaml(await readFile(transitionsFile(root, "ep-001"), "utf8")) as Transition[];
  const ep = decodeYaml(await readFile(episodeFile(root, "ep-001"), "utf8")) as Episode;
  assert.equal(tr[0]?.text, "Later that night.");
  assert.equal(ep.sequence.length, 3);
});

test("writeTransitions output is deterministic (byte-stable)", async () => {
  const root = join(workdir, "demo");
  await writeProject(root, buildInitialProject("demo"));
  const cuts: Cut[] = [
    { id: "cut-001", image: null },
    { id: "cut-002", image: null },
  ];
  const transitions = [transition({ id: "tr-001" })];
  const sequence: SequenceItem[] = [
    { type: "cut", id: "cut-001" },
    { type: "transition", id: "tr-001" },
    { type: "cut", id: "cut-002" },
  ];
  await writeTransitions(root, "ep-001", episodeWith(sequence), transitions, cuts);
  const firstTr = await readFile(transitionsFile(root, "ep-001"), "utf8");
  const firstEp = await readFile(episodeFile(root, "ep-001"), "utf8");
  await writeTransitions(root, "ep-001", episodeWith(sequence), transitions, cuts);
  assert.equal(await readFile(transitionsFile(root, "ep-001"), "utf8"), firstTr);
  assert.equal(await readFile(episodeFile(root, "ep-001"), "utf8"), firstEp);
});

test("writeTransitions rejects a transition with an out-of-range gutter", async () => {
  const root = join(workdir, "demo");
  await writeProject(root, buildInitialProject("demo"));
  const before = await readFile(transitionsFile(root, "ep-001"), "utf8");
  const cuts: Cut[] = [
    { id: "cut-001", image: null },
    { id: "cut-002", image: null },
  ];
  const transitions = [transition({ id: "tr-001", gutterHeight: -10 })];
  const sequence: SequenceItem[] = [
    { type: "cut", id: "cut-001" },
    { type: "transition", id: "tr-001" },
    { type: "cut", id: "cut-002" },
  ];
  await assert.rejects(
    writeTransitions(root, "ep-001", episodeWith(sequence), transitions, cuts),
    (error: unknown) => {
      assert.ok(error instanceof ProjectIoError);
      assert.match(error.message, /invalid transitions/);
      return true;
    },
  );
  // Files are untouched by a rejected write.
  assert.equal(await readFile(transitionsFile(root, "ep-001"), "utf8"), before);
});

test("writeTransitions rejects two adjacent transitions", async () => {
  const root = join(workdir, "demo");
  await writeProject(root, buildInitialProject("demo"));
  const cuts: Cut[] = [
    { id: "cut-001", image: null },
    { id: "cut-002", image: null },
  ];
  const transitions = [transition({ id: "tr-001" }), transition({ id: "tr-002" })];
  const sequence: SequenceItem[] = [
    { type: "cut", id: "cut-001" },
    { type: "transition", id: "tr-001" },
    { type: "transition", id: "tr-002" },
    { type: "cut", id: "cut-002" },
  ];
  await assert.rejects(
    writeTransitions(root, "ep-001", episodeWith(sequence), transitions, cuts),
    (error: unknown) => {
      assert.ok(error instanceof ProjectIoError);
      assert.match(error.message, /adjacent|between cuts/);
      return true;
    },
  );
});

test("writeTransitions rejects a sequence referencing an unknown transition", async () => {
  const root = join(workdir, "demo");
  await writeProject(root, buildInitialProject("demo"));
  const cuts: Cut[] = [
    { id: "cut-001", image: null },
    { id: "cut-002", image: null },
  ];
  // The record list is empty but the sequence still points at tr-001.
  const sequence: SequenceItem[] = [
    { type: "cut", id: "cut-001" },
    { type: "transition", id: "tr-001" },
    { type: "cut", id: "cut-002" },
  ];
  await assert.rejects(
    writeTransitions(root, "ep-001", episodeWith(sequence), [], cuts),
    (error: unknown) => {
      assert.ok(error instanceof ProjectIoError);
      assert.match(error.message, /missing-transition|no matching transition/);
      return true;
    },
  );
});

test("writeTransitions rejects duplicate transition ids", async () => {
  const root = join(workdir, "demo");
  await writeProject(root, buildInitialProject("demo"));
  const cuts: Cut[] = [
    { id: "cut-001", image: null },
    { id: "cut-002", image: null },
    { id: "cut-003", image: null },
  ];
  const transitions = [transition({ id: "dup" }), transition({ id: "dup" })];
  const sequence: SequenceItem[] = [
    { type: "cut", id: "cut-001" },
    { type: "transition", id: "dup" },
    { type: "cut", id: "cut-002" },
    { type: "transition", id: "dup" },
    { type: "cut", id: "cut-003" },
  ];
  await assert.rejects(
    writeTransitions(root, "ep-001", episodeWith(sequence), transitions, cuts),
    (error: unknown) => {
      assert.ok(error instanceof ProjectIoError);
      assert.match(error.message, /duplicate transition id|more than once/);
      return true;
    },
  );
});

test("a fuller fixture with lettering round-trips", async () => {
  const fixture: Project = {
    webtoon: {
      schemaVersion: 1,
      projectId: "lantern-tide",
      title: "Lantern Tide",
      languages: {
        defaultLanguage: "en",
        supportedLanguages: ["en", "ko"],
        dialogueLanguage: "en",
        promptLanguage: "en",
      },
      imageProviders: { defaultProvider: "manual", providers: [] },
    },
    episodes: [
      {
        episode: {
          schemaVersion: 1,
          id: "ep-001",
          title: "First Light",
          sequence: [
            { type: "cut", id: "cut-001" },
            { type: "transition", id: "tr-001" },
            { type: "cut", id: "cut-002" },
          ],
        },
        cuts: [
          { id: "cut-001", image: { clean: "assets/clean/cut-001.webp", final: null } },
          { id: "cut-002", image: null },
        ],
        transitions: [
          {
            id: "tr-001",
            type: "gutter",
            gutterHeight: 48,
            text: null,
            sfx: null,
            agentNote: null,
            humanNote: null,
            image: null,
            reviewStatus: "draft",
          },
        ],
        lettering: [
          {
            id: "ov-001",
            cutId: "cut-001",
            speaker: "Mira",
            kind: "speech",
            text: "The tide remembers every name.",
            font: "Nanum Gothic",
            fill: "#ffffff",
            opacity: 1,
            border: { width: 2, color: "#101010" },
            tail: { x: 0.42, y: 0.78 },
            geometry: { x: 0.1, y: 0.12, width: 0.45, height: 0.2 },
            overflow: false,
            reviewStatus: "human-edited",
          },
        ],
      },
    ],
  };
  const root = join(workdir, "fixture");
  await writeProject(root, fixture);
  const loaded = await loadProject(root);
  assert.equal(loaded.validation.valid, true, JSON.stringify(loaded.validation.issues));
  assert.equal(loaded.project.episodes[0]?.lettering.length, 1);
  assert.equal(loaded.project.episodes[0]?.lettering[0]?.speaker, "Mira");
});
