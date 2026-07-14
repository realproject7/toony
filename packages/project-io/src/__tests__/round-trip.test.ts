// Round-trip and format tests for the on-disk IO layer.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import { atomicWrite } from "../atomic.js";
import { decodeYaml } from "../format.js";
import { ProjectIoError } from "../index.js";
import { cutsFile, episodeFile, letteringFile, transitionsFile, webtoonPath } from "../paths.js";
import { loadProject } from "../reader.js";
import { buildInitialProject, slugify } from "../scaffold.js";
import {
  buildTransitionCommitSteps,
  transitionCommitPlan,
  writeCuts,
  writeLettering,
  writeProject,
  writeTransitions,
  writeWebtoon,
} from "../writer.js";

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

test("writeWebtoon persists the character registry and round-trips", async () => {
  const root = join(workdir, "demo");
  await writeProject(root, buildInitialProject("demo"));

  const loaded = await loadProject(root);
  const next = {
    ...loaded.project.webtoon,
    characters: [
      { id: "rin", name: "Rin", lockstring: "locked palette: teal + ash; round glasses; bob cut" },
    ],
  };
  await writeWebtoon(root, next);

  const reloaded = await loadProject(root);
  assert.equal(reloaded.validation.valid, true, JSON.stringify(reloaded.validation.issues));
  assert.deepEqual(reloaded.project.webtoon.characters, next.characters);

  // Only webtoon.json changes — the episode files stay byte-stable.
  const before = await readFile(cutsFile(root, "ep-001"), "utf8");
  await writeWebtoon(root, next);
  assert.equal(await readFile(cutsFile(root, "ep-001"), "utf8"), before);
});

test("writeLettering preserves agent-owned cut + registry data byte-stable (#137/#121)", async () => {
  const root = join(workdir, "demo");
  await writeProject(root, buildInitialProject("demo"));

  // Seed agent-owned fields: a cut with prompts + craft, and a character registry.
  const cuts = decodeYaml(await readFile(cutsFile(root, "ep-001"), "utf8")) as Cut[];
  const target = cuts.find((c) => c.id === "cut-001");
  assert.ok(target);
  target.imagePrompt = "rain-soaked alley, neon reflections";
  target.negativePrompt = "lowres";
  target.shotType = "medium";
  target.palette = "#3a4a5a";
  target.styleTag = "noir";
  target.characters = ["rin"];
  await writeCuts(root, "ep-001", cuts);

  const loaded = await loadProject(root);
  await writeWebtoon(root, {
    ...loaded.project.webtoon,
    characters: [{ id: "rin", name: "Rin", lockstring: "teal + ash; round glasses; bob" }],
  });

  // Snapshot the agent-owned files BEFORE a lettering-only save (the editor's only write, #121).
  const cutsBefore = await readFile(cutsFile(root, "ep-001"), "utf8");
  const webtoonBefore = await readFile(webtoonPath(root), "utf8");

  await writeLettering(root, "ep-001", [overlay({ id: "ov-1", text: "Hello?" })]);

  // Agent-owned files are byte-identical; only lettering.json changed.
  assert.equal(
    await readFile(cutsFile(root, "ep-001"), "utf8"),
    cutsBefore,
    "cuts.yaml must survive a lettering save byte-stable",
  );
  assert.equal(
    await readFile(webtoonPath(root), "utf8"),
    webtoonBefore,
    "webtoon.json must survive a lettering save byte-stable",
  );

  const after = await loadProject(root);
  assert.equal(after.validation.valid, true, JSON.stringify(after.validation.issues));
  const cut = after.project.episodes[0]?.cuts.find((c) => c.id === "cut-001");
  assert.equal(cut?.imagePrompt, "rain-soaked alley, neon reflections");
  assert.equal(cut?.shotType, "medium");
  assert.deepEqual(cut?.characters, ["rin"]);
  assert.equal(after.project.webtoon.characters?.[0]?.id, "rin");
  const lettering = JSON.parse(await readFile(letteringFile(root, "ep-001"), "utf8"));
  assert.equal(lettering.length, 1);
  assert.equal(lettering[0]?.text, "Hello?");
});

test("writeWebtoon refuses to write an invalid registry", async () => {
  const root = join(workdir, "demo");
  await writeProject(root, buildInitialProject("demo"));
  const loaded = await loadProject(root);
  const bad = {
    ...loaded.project.webtoon,
    // Empty lockstring is invalid per the schema.
    characters: [{ id: "rin", name: "Rin", lockstring: "" }],
  };
  await assert.rejects(writeWebtoon(root, bad), (error: unknown) => {
    assert.ok(error instanceof ProjectIoError);
    assert.match(error.message, /refusing to write invalid webtoon/);
    return true;
  });
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

test("cut prompt fields round-trip through cuts.yaml deterministically", async () => {
  const root = join(workdir, "demo");
  await writeProject(root, buildInitialProject("demo"));

  // Edit the cuts file to carry prompt text, then write it back through the same
  // deterministic encoder the writer uses, and confirm a reload preserves it.
  const cuts = decodeYaml(await readFile(cutsFile(root, "ep-001"), "utf8")) as Cut[];
  const target = cuts.find((c) => c.id === "cut-001");
  assert.ok(target);
  target.imagePrompt = "rain-soaked alley at night, neon reflections";
  target.negativePrompt = "lowres, extra fingers";
  const { encodeYaml } = await import("../format.js");
  await writeFile(cutsFile(root, "ep-001"), encodeYaml(cuts), "utf8");

  const loaded = await loadProject(root);
  assert.equal(loaded.validation.valid, true, JSON.stringify(loaded.validation.issues));
  const reloaded = loaded.project.episodes[0]?.cuts.find((c) => c.id === "cut-001");
  assert.equal(reloaded?.imagePrompt, "rain-soaked alley at night, neon reflections");
  assert.equal(reloaded?.negativePrompt, "lowres, extra fingers");

  // Byte-stability: re-encoding the loaded cuts is identical to what is on disk.
  const onDisk = await readFile(cutsFile(root, "ep-001"), "utf8");
  assert.equal(encodeYaml(loaded.project.episodes[0]?.cuts), onDisk);
});

test("old cuts.yaml without prompt fields still loads, validates, and defaults to ''", async () => {
  const root = join(workdir, "demo");
  await writeProject(root, buildInitialProject("demo"));

  // Simulate a project written before the prompt fields existed: the cuts file
  // has only id + image, exactly as an older toony would have emitted it.
  const legacyCuts = `- id: cut-001
  image: null
- id: cut-002
  image: null
`;
  await writeFile(cutsFile(root, "ep-001"), legacyCuts, "utf8");

  const loaded = await loadProject(root);
  assert.equal(loaded.validation.valid, true, JSON.stringify(loaded.validation.issues));
  for (const cut of loaded.project.episodes[0]?.cuts ?? []) {
    assert.equal(cut.imagePrompt, "");
    assert.equal(cut.negativePrompt, "");
  }
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
    { id: "cut-001", image: null, imagePrompt: "", negativePrompt: "" },
    { id: "cut-002", image: null, imagePrompt: "", negativePrompt: "" },
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
    { id: "cut-001", image: null, imagePrompt: "", negativePrompt: "" },
    { id: "cut-002", image: null, imagePrompt: "", negativePrompt: "" },
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
    { id: "cut-001", image: null, imagePrompt: "", negativePrompt: "" },
    { id: "cut-002", image: null, imagePrompt: "", negativePrompt: "" },
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
    { id: "cut-001", image: null, imagePrompt: "", negativePrompt: "" },
    { id: "cut-002", image: null, imagePrompt: "", negativePrompt: "" },
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
    { id: "cut-001", image: null, imagePrompt: "", negativePrompt: "" },
    { id: "cut-002", image: null, imagePrompt: "", negativePrompt: "" },
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

test("writeTransitions accepts a cut and transition sharing an id (#146 namespaces)", async () => {
  const root = join(workdir, "shared-id");
  await writeProject(root, buildInitialProject("shared-id"));
  // A cut and a transition legitimately share the id "beat" (independent
  // namespaces). The previously-divergent writer copy of the sequence check
  // falsely rejected this; it now uses the single-sourced @toony/schema check.
  const cuts: Cut[] = [
    { id: "beat", image: null, imagePrompt: "", negativePrompt: "" },
    { id: "cut-002", image: null, imagePrompt: "", negativePrompt: "" },
  ];
  await writeCuts(root, "ep-001", cuts);
  const transitions = [transition({ id: "beat" })];
  const sequence: SequenceItem[] = [
    { type: "cut", id: "beat" },
    { type: "transition", id: "beat" },
    { type: "cut", id: "cut-002" },
  ];
  await assert.doesNotReject(
    writeTransitions(root, "ep-001", episodeWith(sequence), transitions, cuts),
  );

  const loaded = await loadProject(root);
  assert.equal(loaded.validation.valid, true, JSON.stringify(loaded.validation.issues));
  assert.deepEqual(
    loaded.project.episodes[0]?.episode.sequence,
    sequence,
    "the shared-id sequence must round-trip intact",
  );
});

test("writeTransitions still rejects a genuine same-type duplicate reference (#146)", async () => {
  const root = join(workdir, "dup-same-type");
  await writeProject(root, buildInitialProject("dup-same-type"));
  const cuts: Cut[] = [
    { id: "cut-001", image: null, imagePrompt: "", negativePrompt: "" },
    { id: "cut-002", image: null, imagePrompt: "", negativePrompt: "" },
  ];
  const transitions = [transition({ id: "tr-001" })];
  // cut-001 referenced twice — a real duplicate, must still be refused.
  const sequence: SequenceItem[] = [
    { type: "cut", id: "cut-001" },
    { type: "transition", id: "tr-001" },
    { type: "cut", id: "cut-001" },
  ];
  await assert.rejects(
    writeTransitions(root, "ep-001", episodeWith(sequence), transitions, cuts),
    (error: unknown) => {
      assert.ok(error instanceof ProjectIoError);
      assert.match(error.message, /more than once/);
      return true;
    },
  );
});

test("writeTransitions rejects a sequence referencing an unknown transition", async () => {
  const root = join(workdir, "demo");
  await writeProject(root, buildInitialProject("demo"));
  const cuts: Cut[] = [
    { id: "cut-001", image: null, imagePrompt: "", negativePrompt: "" },
    { id: "cut-002", image: null, imagePrompt: "", negativePrompt: "" },
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
    { id: "cut-001", image: null, imagePrompt: "", negativePrompt: "" },
    { id: "cut-002", image: null, imagePrompt: "", negativePrompt: "" },
    { id: "cut-003", image: null, imagePrompt: "", negativePrompt: "" },
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
          {
            id: "cut-001",
            image: { clean: "assets/clean/cut-001.webp", final: null },
            imagePrompt: "a lantern drifting on dark water, soft glow",
            negativePrompt: "blurry, watermark",
          },
          { id: "cut-002", image: null, imagePrompt: "", negativePrompt: "" },
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

test("character registry + cut.characters round-trip and validate (#92)", async () => {
  const root = join(workdir, "chars");
  const project = buildInitialProject("chars");
  project.webtoon.characters = [
    {
      id: "mina",
      name: "Mina",
      lockstring: "short black bob, amber eyes, red scarf, flat cel style",
    },
  ];
  const cut = project.episodes[0]?.cuts[0];
  assert.ok(cut);
  cut.characters = ["mina"];
  await writeProject(root, project);

  const loaded = await loadProject(root);
  assert.equal(loaded.validation.valid, true, JSON.stringify(loaded.validation.issues));
  assert.equal(
    loaded.project.webtoon.characters?.[0]?.lockstring,
    "short black bob, amber eyes, red scarf, flat cel style",
  );
  assert.deepEqual(loaded.project.episodes[0]?.cuts[0]?.characters, ["mina"]);
});

test("a legacy project without characters loads and validates (back-compat)", async () => {
  const root = join(workdir, "legacy-chars");
  await writeProject(root, buildInitialProject("legacy-chars"));
  const loaded = await loadProject(root);
  assert.equal(loaded.validation.valid, true, JSON.stringify(loaded.validation.issues));
  assert.equal(loaded.project.webtoon.characters, undefined);
  assert.equal(loaded.project.episodes[0]?.cuts[0]?.characters, undefined);
});

test("cut craft fields + transition.color round-trip and validate (#98)", async () => {
  const root = join(workdir, "craft98");
  const project = buildInitialProject("craft98");
  const cut = project.episodes[0]?.cuts[0];
  assert.ok(cut);
  cut.shotType = "establishing_wide";
  cut.palette = "#2a3b4c";
  cut.layer = "metaphor";
  cut.styleTag = "noir";
  const transition = project.episodes[0]?.transitions[0];
  assert.ok(transition);
  transition.color = "#101820";
  await writeProject(root, project);

  const loaded = await loadProject(root);
  assert.equal(loaded.validation.valid, true, JSON.stringify(loaded.validation.issues));
  const rc = loaded.project.episodes[0]?.cuts[0];
  assert.equal(rc?.shotType, "establishing_wide");
  assert.equal(rc?.palette, "#2a3b4c");
  assert.equal(rc?.layer, "metaphor");
  assert.equal(rc?.styleTag, "noir");
  assert.equal(loaded.project.episodes[0]?.transitions[0]?.color, "#101820");
});

test("overlay placement/placementSide round-trip (#98)", async () => {
  const root = join(workdir, "place98");
  await writeProject(root, buildInitialProject("place98"));
  await writeLettering(root, "ep-001", [
    overlay({ id: "ov-1", placement: "gutter", placementSide: "left" }),
  ]);
  const loaded = await loadProject(root);
  assert.equal(loaded.validation.valid, true, JSON.stringify(loaded.validation.issues));
  const ov = loaded.project.episodes[0]?.lettering[0];
  assert.equal(ov?.placement, "gutter");
  assert.equal(ov?.placementSide, "left");
});

// --- #144 write-unit commit ordering (crash safety) -------------------------

/** Ids of the transitions the persisted episode sequence still points at. */
function referencedTransitionIds(episode: Episode): string[] {
  return episode.sequence.filter((i) => i.type === "transition").map((i) => i.id);
}

/**
 * Read the two persisted files and assert the core invariant: the episode
 * sequence references only transition ids that are actually present in
 * `transitions.yaml` (an orphan record is allowed; a dangling reference is not).
 */
async function assertNoDanglingReference(root: string, episodeId: string): Promise<void> {
  const transitions = decodeYaml(
    await readFile(transitionsFile(root, episodeId), "utf8"),
  ) as Transition[];
  const episode = decodeYaml(await readFile(episodeFile(root, episodeId), "utf8")) as Episode;
  const present = new Set(transitions.map((t) => t.id));
  for (const id of referencedTransitionIds(episode)) {
    assert.ok(
      present.has(id),
      `sequence references transition "${id}" but it is absent from transitions.yaml`,
    );
  }
}

test("transitionCommitPlan orders records-first for additions and a no-op", () => {
  assert.deepEqual(transitionCommitPlan(new Set(), new Set(["a"])), ["transitions:new", "episode"]);
  assert.deepEqual(transitionCommitPlan(new Set(["a"]), new Set(["a", "b"])), [
    "transitions:new",
    "episode",
  ]);
  // No change is treated as the additions case (records-first is always safe here).
  assert.deepEqual(transitionCommitPlan(new Set(["a"]), new Set(["a"])), [
    "transitions:new",
    "episode",
  ]);
});

test("transitionCommitPlan orders sequence-first for a pure deletion", () => {
  assert.deepEqual(transitionCommitPlan(new Set(["a", "b"]), new Set(["a"])), [
    "episode",
    "transitions:new",
  ]);
});

test("transitionCommitPlan stages through a union for a mixed add+delete", () => {
  assert.deepEqual(transitionCommitPlan(new Set(["a", "b"]), new Set(["a", "c"])), [
    "transitions:union",
    "episode",
    "transitions:new",
  ]);
});

/**
 * Seed an episode with two transitions (tr-001 before cut-002, tr-002 before
 * cut-003) and three cuts, then return the shared cuts array.
 */
async function seedTwoTransitions(root: string, projectId: string): Promise<Cut[]> {
  await writeProject(root, buildInitialProject(projectId));
  const cuts: Cut[] = [
    { id: "cut-001", image: null, imagePrompt: "", negativePrompt: "" },
    { id: "cut-002", image: null, imagePrompt: "", negativePrompt: "" },
    { id: "cut-003", image: null, imagePrompt: "", negativePrompt: "" },
  ];
  await writeCuts(root, "ep-001", cuts);
  const transitions = [transition({ id: "tr-001" }), transition({ id: "tr-002" })];
  const sequence: SequenceItem[] = [
    { type: "cut", id: "cut-001" },
    { type: "transition", id: "tr-001" },
    { type: "cut", id: "cut-002" },
    { type: "transition", id: "tr-002" },
    { type: "cut", id: "cut-003" },
  ];
  await writeTransitions(root, "ep-001", episodeWith(sequence), transitions, cuts);
  return cuts;
}

test("a deletion interrupted before the record prune leaves no dangling reference", async () => {
  const root = join(workdir, "del-interrupt");
  const cuts = await seedTwoTransitions(root, "del-interrupt");

  // Delete tr-002. Plan is [episode, transitions:new]: episode.yaml commits
  // first (dropping the tr-002 reference), then transitions.yaml is pruned.
  const remaining = [transition({ id: "tr-001" })];
  const sequence: SequenceItem[] = [
    { type: "cut", id: "cut-001" },
    { type: "transition", id: "tr-001" },
    { type: "cut", id: "cut-002" },
    { type: "cut", id: "cut-003" },
  ];

  // Interrupt the SECOND rename (the prune): make the transitions temp a
  // directory so its staging fails with EISDIR after episode.yaml is committed.
  await mkdir(`${transitionsFile(root, "ep-001")}.tmp`);
  await assert.rejects(writeTransitions(root, "ep-001", episodeWith(sequence), remaining, cuts));

  // episode.yaml is the new (deleted) sequence; transitions.yaml still holds the
  // old superset. Old-order code would have pruned tr-002 first and left the old
  // sequence dangling; here the new sequence references only present ids.
  await assertNoDanglingReference(root, "ep-001");
  const transitions = decodeYaml(
    await readFile(transitionsFile(root, "ep-001"), "utf8"),
  ) as Transition[];
  assert.deepEqual(
    transitions.map((t) => t.id).sort(),
    ["tr-001", "tr-002"],
    "the interrupted prune must leave the old records (tr-002 as a benign orphan)",
  );
});

test("a mixed edit interrupted after the union pass leaves no dangling reference", async () => {
  const root = join(workdir, "mixed-interrupt");
  const cuts = await seedTwoTransitions(root, "mixed-interrupt");

  // Delete tr-002 AND add tr-003. Plan is [transitions:union, episode,
  // transitions:new]: the union pass writes {tr-001, tr-003, tr-002} first.
  const next = [transition({ id: "tr-001" }), transition({ id: "tr-003" })];
  const sequence: SequenceItem[] = [
    { type: "cut", id: "cut-001" },
    { type: "transition", id: "tr-001" },
    { type: "cut", id: "cut-002" },
    { type: "transition", id: "tr-003" },
    { type: "cut", id: "cut-003" },
  ];

  // Interrupt the episode rename (phase 2): make episode.yaml's temp a directory.
  // The union pass has committed, but the sequence is still the OLD one, which
  // references tr-002 — present only because the union kept it.
  await mkdir(`${episodeFile(root, "ep-001")}.tmp`);
  await assert.rejects(writeTransitions(root, "ep-001", episodeWith(sequence), next, cuts));

  await assertNoDanglingReference(root, "ep-001");
  const transitions = decodeYaml(
    await readFile(transitionsFile(root, "ep-001"), "utf8"),
  ) as Transition[];
  assert.deepEqual(
    transitions.map((t) => t.id).sort(),
    ["tr-001", "tr-002", "tr-003"],
    "the union pass must persist old ∪ new so both the old and new sequence are covered",
  );
  // The episode is still the old sequence (its rename was interrupted).
  const episode = decodeYaml(await readFile(episodeFile(root, "ep-001"), "utf8")) as Episode;
  assert.deepEqual(referencedTransitionIds(episode).sort(), ["tr-001", "tr-002"]);
});

test("a completed mixed add+delete prunes to the new records and validates", async () => {
  const root = join(workdir, "mixed-ok");
  const cuts = await seedTwoTransitions(root, "mixed-ok");

  const next = [transition({ id: "tr-001" }), transition({ id: "tr-003" })];
  const sequence: SequenceItem[] = [
    { type: "cut", id: "cut-001" },
    { type: "transition", id: "tr-001" },
    { type: "cut", id: "cut-002" },
    { type: "transition", id: "tr-003" },
    { type: "cut", id: "cut-003" },
  ];
  await writeTransitions(root, "ep-001", episodeWith(sequence), next, cuts);

  const loaded = await loadProject(root);
  assert.equal(loaded.validation.valid, true, JSON.stringify(loaded.validation.issues));
  const persisted = loaded.project.episodes[0]?.transitions;
  assert.deepEqual(
    persisted?.map((t) => t.id).sort(),
    ["tr-001", "tr-003"],
    "the prune pass must drop the deleted tr-002 (no lingering orphan on success)",
  );
});

test("a mixed edit interrupted during the final prune leaves no dangling reference", async () => {
  const root = join(workdir, "mixed-prune-interrupt");
  await seedTwoTransitions(root, "mixed-prune-interrupt");

  const next = [transition({ id: "tr-001" }), transition({ id: "tr-003" })];
  const sequence: SequenceItem[] = [
    { type: "cut", id: "cut-001" },
    { type: "transition", id: "tr-001" },
    { type: "cut", id: "cut-002" },
    { type: "transition", id: "tr-003" },
    { type: "cut", id: "cut-003" },
  ];

  // The phase-3 prune interruption cannot be isolated with a static-fs fault
  // inside one writeTransitions call — phases 1 and 3 both stage into
  // transitions.yaml.tmp, so a directory there would trip phase 1 first. So
  // drive the SAME ordered commit the writer builds: run phases 1+2 for real,
  // then interrupt phase 3 (the prune) via EISDIR on its staging temp.
  const transitionsPath = transitionsFile(root, "ep-001");
  const episodePath = episodeFile(root, "ep-001");
  const oldTransitions = decodeYaml(await readFile(transitionsPath, "utf8")) as unknown[];
  const steps = buildTransitionCommitSteps({
    oldTransitions,
    transitions: next,
    episode: episodeWith(sequence),
    transitionsPath,
    episodePath,
  });
  const [phase1, phase2, phase3] = steps;
  assert.ok(phase1 && phase2 && phase3, "a mixed add+delete must commit in three phases");

  await atomicWrite(phase1.file, phase1.data); // phase 1: transitions = old ∪ new
  await atomicWrite(phase2.file, phase2.data); // phase 2: episode = new sequence
  await mkdir(`${transitionsPath}.tmp`);
  await assert.rejects(atomicWrite(phase3.file, phase3.data)); // phase 3: prune, interrupted

  // transitions.yaml is still the union superset; episode.yaml is the new
  // sequence. Every referenced id is present (tr-002 lingers as a benign orphan).
  await assertNoDanglingReference(root, "ep-001");
  const transitions = decodeYaml(await readFile(transitionsPath, "utf8")) as Transition[];
  assert.deepEqual(transitions.map((t) => t.id).sort(), ["tr-001", "tr-002", "tr-003"]);
  const episode = decodeYaml(await readFile(episodePath, "utf8")) as Episode;
  assert.deepEqual(referencedTransitionIds(episode).sort(), ["tr-001", "tr-003"]);
});

test("writeTransitions refuses to write (touching nothing) when the on-disk records are unreadable", async () => {
  const root = join(workdir, "unreadable-old");
  const cuts = await seedTwoTransitions(root, "unreadable-old");

  // Corrupt the existing transitions.yaml so the crash-safe ordering cannot be
  // trusted. A valid edit must NOT be guessed into a records-first order (which
  // could dangle on a deletion); it must fail closed with every file intact.
  const transitionsPath = transitionsFile(root, "ep-001");
  const episodePath = episodeFile(root, "ep-001");
  await writeFile(transitionsPath, "- id: tr-001\n  image: [unterminated\n", "utf8");
  const transitionsBefore = await readFile(transitionsPath, "utf8");
  const episodeBefore = await readFile(episodePath, "utf8");

  // A pure deletion (drop tr-002) — the exact case a wrong empty-old guess dooms.
  const remaining = [transition({ id: "tr-001" })];
  const sequence: SequenceItem[] = [
    { type: "cut", id: "cut-001" },
    { type: "transition", id: "tr-001" },
    { type: "cut", id: "cut-002" },
    { type: "cut", id: "cut-003" },
  ];
  await assert.rejects(
    writeTransitions(root, "ep-001", episodeWith(sequence), remaining, cuts),
    (error: unknown) => {
      assert.ok(error instanceof ProjectIoError);
      assert.match(error.message, /crash-safe write order/);
      return true;
    },
  );

  // No target committed: both files are byte-for-byte what they were.
  assert.equal(await readFile(transitionsPath, "utf8"), transitionsBefore);
  assert.equal(await readFile(episodePath, "utf8"), episodeBefore);
});
