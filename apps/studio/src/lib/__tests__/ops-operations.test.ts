// The project operations agent tools and the left workspace share: works,
// story, cast, episodes from scripts, cut edits with sequence integrity,
// dialogue that never silently replaces lettering, transitions and artwork.

import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  buildInitialProject,
  loadProject,
  readBrief,
  readStoryBible,
  writeLettering,
  writeProject,
} from "@toony/project-io";
import type { EpisodeBundle, SequenceItem } from "@toony/schema";
import {
  applyCutOperations,
  applyDialogueReplacement,
  contextFor,
  createBlankEpisode,
  createEpisode,
  createWork,
  deleteEpisode,
  editCuts,
  importArtwork,
  OpError,
  removeCharacter,
  renameEpisode,
  renameWork,
  setDialogue,
  setTransitions,
  undoChange,
  updateStory,
  upsertCharacters,
  workFolderSlug,
} from "../ops/index.js";

// Named fixture: a real 1x1 PNG.
const PNG_FIXTURE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n5sAAAAASUVORK5CYII=",
  "base64",
);

async function workspace(t: { after: (fn: () => Promise<void>) => void }): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "toony-ops-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function blankWork(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await workspace(t);
  const created = await createWork(dir, "Harbor Lights");
  const root = join(dir, created.workId);
  return { dir, root, ctx: contextFor(root, { workId: created.workId, actor: "agent" }) };
}

const sequenceIds = (bundle: EpisodeBundle | undefined) =>
  bundle?.episode.sequence.map((item: SequenceItem) => `${item.type[0]}:${item.id}`);

test("a new work keeps its typed title, gets a safe unique folder and no episode", async (t) => {
  const dir = await workspace(t);
  const korean = await createWork(dir, "  고양이 탐정  ");
  const again = await createWork(dir, "고양이 탐정");
  const latin = await createWork(dir, "The Cat's Pajamas");
  assert.deepEqual(
    [korean.workId, again.workId, latin.workId],
    ["webtoon", "webtoon-2", "the-cat-s-pajamas"],
  );
  const loaded = await loadProject(join(dir, korean.workId));
  assert.equal(loaded.project.webtoon.title, "고양이 탐정");
  assert.equal(
    (await loadProject(join(dir, latin.workId))).project.webtoon.title,
    "The Cat's Pajamas",
  );
  assert.deepEqual(loaded.project.episodes, []);
  assert.equal(loaded.validation.valid, true);
  assert.deepEqual(await readdir(join(dir, korean.workId, "episodes")), []);
  assert.equal(korean.change.undoable, false);
  assert.equal(workFolderSlug("Café Noir", ["cafe-noir", "Cafe-Noir-2"]), "cafe-noir-3");
  await assert.rejects(createWork(dir, "   "), /Enter a title/);
});

test("a starter, when asked for, seeds the work exactly like toony init", async (t) => {
  const dir = await workspace(t);
  const created = await createWork(dir, "Night Shift", { genre: "thriller", language: "ko" });
  const loaded = await loadProject(join(dir, created.workId));
  assert.equal(loaded.project.episodes.length, 1);
  assert.equal(loaded.project.webtoon.languages.dialogueLanguage, "ko");
  assert.equal(loaded.validation.valid, true);
  await assert.rejects(createWork(dir, "Other", { genre: "no-such-genre" }), /no longer available/);
});

test("rename and story updates change only what they name, and the brief needs its basics", async (t) => {
  const { root, ctx } = await blankWork(t);
  const renamed = await renameWork(ctx, "Harbor Lights at Dawn");
  assert.ok(renamed);
  assert.equal((await loadProject(root)).project.webtoon.title, "Harbor Lights at Dawn");
  assert.equal(await renameWork(ctx, "Harbor Lights at Dawn"), null, "same title, no change");

  await assert.rejects(updateStory(ctx, { intent: "A short." }), /intent, audience, world/);
  const story = await updateStory(ctx, {
    logline: "A ferry pilot hears a voice in the fog.",
    intent: "A quiet mystery.",
    audience: "Adults.",
    world: "A northern harbor.",
    storyGoals: ["Keep the fog unsettling."],
    storyBible: "# Harbor\n\nThe lighthouse is dark.",
  });
  assert.ok(story);
  const loaded = await loadProject(root);
  assert.equal(loaded.project.webtoon.logline, "A ferry pilot hears a voice in the fog.");
  assert.equal(loaded.project.webtoon.title, "Harbor Lights at Dawn");
  assert.equal((await readBrief(root)).brief?.world, "A northern harbor.");
  assert.equal(await readStoryBible(root), "# Harbor\n\nThe lighthouse is dark.");
  await updateStory(ctx, { world: "A southern harbor.", logline: null });
  assert.equal(
    (await readBrief(root)).brief?.intent,
    "A quiet mystery.",
    "other brief fields stay",
  );
  assert.equal((await loadProject(root)).project.webtoon.logline, undefined);
});

test("characters merge by id, never replacing the cast from a stale copy", async (t) => {
  const { root, ctx } = await blankWork(t);
  const first = await upsertCharacters(ctx, [
    { name: "Mira", lockstring: "teal coat", visualIdentity: "Cropped hair" },
    { name: "준" },
  ]);
  assert.deepEqual(
    first.characters.map((c) => [c.id, c.created]),
    [
      ["mira", true],
      ["character", true],
    ],
  );
  await assert.rejects(
    upsertCharacters(ctx, [{ id: "mira", development: { role: "pilot" } }]),
    (error: unknown) => error instanceof OpError && /cast would not be valid/.test(error.message),
    "a partial development profile is refused, not half saved",
  );
  await upsertCharacters(ctx, [{ id: "character", lockstring: "grey scarf" }]);
  const cast = (await loadProject(root)).project.webtoon.characters ?? [];
  assert.deepEqual(
    cast.map((c) => [c.id, c.name, c.lockstring, c.visualIdentity ?? null]),
    [
      ["mira", "Mira", "teal coat", "Cropped hair"],
      ["character", "준", "grey scarf", null],
    ],
  );
});

const SCRIPT = {
  title: "Fog",
  beats: [
    {
      purpose: "Open on the harbor.",
      cuts: [
        {
          intent: "Place us.",
          scene: "A pier in fog.",
          characters: ["mira"],
          dialogue: [{ speaker: "mira", text: "Hello?" }],
          transitionAfter: { type: "beat" as const },
        },
        {
          intent: "Answer.",
          scene: "A lamp turns on.",
          dialogue: [{ speaker: null, text: "Nobody." }],
        },
        { intent: "Close.", scene: "Mira steps back." },
      ],
    },
  ],
};

test("an episode script compiles and applies as the next zero-padded episode", async (t) => {
  const { root, ctx } = await blankWork(t);
  await upsertCharacters(ctx, [{ name: "Mira" }]);
  const created = await createEpisode(ctx, { script: SCRIPT });
  assert.equal(created.episodeId, "ep-001");
  assert.equal(created.title, "Fog");
  assert.deepEqual(created.cutIds, ["cut-001", "cut-002", "cut-003"]);
  assert.ok(created.change);
  const second = await createEpisode(ctx, { title: "Morning", script: SCRIPT });
  assert.equal(second.episodeId, "ep-002");
  const loaded = await loadProject(root);
  assert.equal(loaded.validation.valid, true, JSON.stringify(loaded.validation.issues));
  const bundle = loaded.project.episodes[0];
  assert.deepEqual(sequenceIds(bundle), ["c:cut-001", "t:tr-cut-001", "c:cut-002", "c:cut-003"]);
  assert.equal(bundle?.cuts[0]?.imagePrompt, "A pier in fog.");
  assert.deepEqual(
    bundle?.lettering.map((o) => [o.cutId, o.speaker, o.kind, o.text]),
    [
      ["cut-001", "Mira", "speech", "Hello?"],
      ["cut-002", "", "narration", "Nobody."],
    ],
  );
  const script = JSON.parse(await readFile(join(root, "script/episodes/ep-001.json"), "utf8"));
  assert.equal(script.episodeId, "ep-001");
  await assert.rejects(
    createEpisode(ctx, {
      script: { beats: [{ purpose: "x", cuts: [{ intent: "", scene: "" }] }] },
    }),
    (error: unknown) => error instanceof OpError && error.code === "invalid",
  );
  assert.equal(
    (await loadProject(root)).project.episodes.length,
    2,
    "a refused script adds nothing",
  );
});

test("episodes can be renamed, deleted and the deletion undone", async (t) => {
  const { root, ctx } = await blankWork(t);
  const blank = await createBlankEpisode(ctx, { cuts: 3 });
  assert.equal(blank.episodeId, "ep-001");
  assert.equal(blank.title, "Episode 1");
  await renameEpisode(ctx, "ep-001", "The Dock");
  const deleted = await deleteEpisode(ctx, "ep-001");
  assert.ok(deleted);
  await assert.rejects(stat(join(root, "episodes/ep-001")));
  assert.deepEqual((await loadProject(root)).project.episodes, []);
  await undoChange(ctx, deleted.changeId);
  const restored = await loadProject(root);
  assert.equal(restored.project.episodes[0]?.episode.title, "The Dock");
  assert.equal(restored.project.episodes[0]?.cuts.length, 3);
  await assert.rejects(renameEpisode(ctx, "ep-009", "Nope"), /does not exist/);
  await assert.rejects(createBlankEpisode(ctx, { cuts: 0 }), /between 1 and/);
});

function episodeWith(sequence: string[]): EpisodeBundle {
  const cuts = sequence
    .filter((id) => id.startsWith("c"))
    .map((id) => ({
      id,
      image: null,
      imagePrompt: "",
      negativePrompt: "",
    }));
  const transitions = sequence
    .filter((id) => id.startsWith("t"))
    .map((id) => ({
      id,
      type: "gutter" as const,
      gutterHeight: 48,
      text: null,
      sfx: null,
      agentNote: null,
      humanNote: null,
      image: null,
      reviewStatus: "draft" as const,
    }));
  return {
    episode: {
      schemaVersion: 1,
      id: "ep-001",
      title: "One",
      sequence: sequence.map((id) => ({ type: id.startsWith("c") ? "cut" : "transition", id })),
    },
    cuts,
    transitions,
    lettering: [],
  };
}

test("cut edits keep the reading order whole", () => {
  const ids = (b: EpisodeBundle) => b.episode.sequence.map((item) => item.id);
  const known = new Set<string>();
  const base = episodeWith(["c1", "t1", "c2", "t2", "c3"]);
  assert.deepEqual(ids(applyCutOperations(base, [{ op: "remove", cutId: "c2" }], known).bundle), [
    "c1",
    "t1",
    "c3",
  ]);
  assert.deepEqual(ids(applyCutOperations(base, [{ op: "remove", cutId: "c1" }], known).bundle), [
    "c2",
    "t2",
    "c3",
  ]);
  const last = applyCutOperations(base, [{ op: "remove", cutId: "c3" }], known).bundle;
  assert.deepEqual(ids(last), ["c1", "t1", "c2"]);
  assert.deepEqual(
    last.transitions.map((t) => t.id),
    ["t1"],
    "the orphaned transition record goes too",
  );
  const lone = episodeWith(["c1", "c2", "t2", "c3"]);
  assert.deepEqual(ids(applyCutOperations(lone, [{ op: "remove", cutId: "c2" }], known).bundle), [
    "c1",
    "t2",
    "c3",
  ]);
  const moved = applyCutOperations(base, [{ op: "move", cutId: "c3", after: null }], known).bundle;
  assert.deepEqual(
    ids(moved),
    ["c3", "t1", "c1", "t2", "c2"],
    "transitions stay between positions",
  );
  const added = applyCutOperations(base, [{ op: "add", after: "c1", scene: "Gulls." }], known);
  assert.deepEqual(ids(added.bundle), ["c1", "cut-001", "t1", "c2", "t2", "c3"]);
  assert.equal(added.bundle.cuts[1]?.imagePrompt, "Gulls.");
  assert.throws(
    () => applyCutOperations(episodeWith(["c1"]), [{ op: "remove", cutId: "c1" }], known),
    /at least one cut/,
  );
  assert.throws(
    () => applyCutOperations(base, [{ op: "update", cutId: "c1", characters: ["ghost"] }], known),
    /Add these characters/,
  );
});

test("editCuts removes a cut with its lettering and transition and validates", async (t) => {
  const { root, ctx } = await blankWork(t);
  await upsertCharacters(ctx, [{ name: "Mira" }]);
  await createEpisode(ctx, { script: SCRIPT });
  const result = await editCuts(ctx, "ep-001", [
    { op: "remove", cutId: "cut-001" },
    { op: "update", cutId: "cut-003", scene: "Mira runs.", characters: ["mira"] },
  ]);
  assert.deepEqual(result.cuts, ["cut-002", "cut-003"]);
  const loaded = await loadProject(root);
  assert.equal(loaded.validation.valid, true, JSON.stringify(loaded.validation.issues));
  const bundle = loaded.project.episodes[0];
  assert.deepEqual(sequenceIds(bundle), ["c:cut-002", "c:cut-003"]);
  assert.deepEqual(bundle?.transitions, []);
  assert.deepEqual(
    bundle?.lettering.map((o) => o.cutId),
    ["cut-002"],
  );
  assert.equal(bundle?.cuts[1]?.imagePrompt, "Mira runs.");
  assert.equal(bundle?.cuts[1]?.reviewStatus, undefined, "an edit leaves the review mark alone");
  assert.match(result.change?.summary ?? "", /Removed a cut, updated Cut 2 in Fog/);
});

test("dialogue letters an empty cut but only proposes replacing existing lettering", async (t) => {
  const { root, ctx } = await blankWork(t);
  await upsertCharacters(ctx, [{ name: "Mira" }]);
  await createEpisode(ctx, { script: SCRIPT });
  const created = await setDialogue(ctx, "ep-001", "cut-003", [
    { speaker: "Mira", text: "I'm leaving." },
    { speaker: null, text: "She never came back." },
  ]);
  assert.equal(created.mode, "created");
  const afterCreate = (await loadProject(root)).project.episodes[0]?.lettering ?? [];
  assert.deepEqual(
    afterCreate.filter((o) => o.cutId === "cut-003").map((o) => [o.speaker, o.kind]),
    [
      ["Mira", "speech"],
      ["", "narration"],
    ],
  );

  const before = await readFile(join(root, "episodes/ep-001/lettering.json"), "utf8");
  const proposed = await setDialogue(ctx, "ep-001", "cut-001", [
    { speaker: "mira", text: "Who's there?" },
  ]);
  assert.equal(proposed.mode, "replacement");
  if (proposed.mode !== "replacement") return;
  assert.deepEqual(
    proposed.replacement.before.map((l) => l.text),
    ["Hello?"],
  );
  assert.deepEqual(proposed.replacement.after, [
    { speaker: "Mira", text: "Who's there?", kind: "speech" },
  ]);
  assert.equal(
    await readFile(join(root, "episodes/ep-001/lettering.json"), "utf8"),
    before,
    "a replacement is never written without approval",
  );

  const applied = await applyDialogueReplacement(ctx, proposed.replacement);
  assert.ok(applied.change);
  const replaced = (await loadProject(root)).project.episodes[0]?.lettering.find(
    (o) => o.cutId === "cut-001",
  );
  assert.equal(replaced?.text, "Who's there?");
  assert.equal(replaced?.id, "ov-cut-001-1", "the bubble keeps its place");
  await assert.rejects(
    applyDialogueReplacement(ctx, proposed.replacement),
    (error: unknown) => error instanceof OpError && error.code === "stale",
  );
});

test("transitions are set by the cut they follow", async (t) => {
  const { root, ctx } = await blankWork(t);
  await createBlankEpisode(ctx, { cuts: 3 });
  await setTransitions(ctx, "ep-001", [
    { afterCut: "cut-001", type: "scene-break", text: "Later" },
    { afterCut: "cut-002", type: "gutter", gutterHeight: 120 },
  ]);
  let bundle = (await loadProject(root)).project.episodes[0];
  assert.deepEqual(sequenceIds(bundle), [
    "c:cut-001",
    "t:tr-cut-001",
    "c:cut-002",
    "t:tr-cut-002",
    "c:cut-003",
  ]);
  assert.equal(bundle?.transitions[0]?.text, "Later");
  await setTransitions(ctx, "ep-001", [{ afterCut: "cut-001", type: "none" }]);
  bundle = (await loadProject(root)).project.episodes[0];
  assert.deepEqual(
    bundle?.transitions.map((tr) => [tr.id, tr.gutterHeight]),
    [["tr-cut-002", 120]],
  );
  await assert.rejects(
    setTransitions(ctx, "ep-001", [{ afterCut: "cut-003", type: "beat" }]),
    /last cut/,
  );
});

test("artwork bytes are checked, stored like an import, and undoable", async (t) => {
  const { root, ctx } = await blankWork(t);
  await createBlankEpisode(ctx, { cuts: 2 });
  const imported = await importArtwork(ctx, "ep-001", "cut-002", PNG_FIXTURE);
  assert.equal(imported.image, "episodes/ep-001/assets/clean/cut-002.png");
  assert.equal(
    (await loadProject(root)).project.episodes[0]?.cuts[1]?.image?.clean,
    imported.image,
  );
  await stat(join(root, imported.image));
  await assert.rejects(
    importArtwork(ctx, "ep-001", "cut-001", new TextEncoder().encode("<svg/>")),
    /PNG, JPEG, WebP or GIF/,
  );
  assert.ok(imported.change);
  await undoChange(ctx, imported.change.changeId);
  assert.equal((await loadProject(root)).project.episodes[0]?.cuts[1]?.image, null);
  await assert.rejects(stat(join(root, imported.image)), "the imported file is removed on undo");
});

test("removing a character takes it out of every cut that names it", async (t) => {
  const { root, ctx } = await blankWork(t);
  await upsertCharacters(ctx, [{ name: "Mira" }]);
  await createEpisode(ctx, { script: SCRIPT });
  await removeCharacter(ctx, "mira");
  const loaded = await loadProject(root);
  assert.deepEqual(loaded.project.webtoon.characters, []);
  assert.equal(loaded.project.episodes[0]?.cuts[0]?.characters, undefined);
  await assert.rejects(removeCharacter(ctx, "mira"), /not in the cast/);
});

test("a work made by toony init with lettering keeps working with these operations", async (t) => {
  const dir = await workspace(t);
  const root = join(dir, "legacy");
  await writeProject(root, buildInitialProject("Legacy"));
  const ctx = contextFor(root);
  await writeLettering(root, "ep-001", []);
  const created = await setDialogue(ctx, "ep-001", "cut-001", [
    { speaker: "Narrator", text: "Once." },
  ]);
  assert.equal(created.mode, "created");
  const loaded = await loadProject(root);
  assert.equal(loaded.validation.valid, true);
  assert.equal(loaded.project.episodes[0]?.lettering[0]?.speaker, "Narrator");
});

test("undoing a new episode is refused while a later edit inside it stands", async (t) => {
  const { root, ctx } = await blankWork(t);
  const blank = await createBlankEpisode(ctx, { cuts: 2 });
  assert.ok(blank.change);
  const added = await editCuts(ctx, blank.episodeId, [{ op: "add", scene: "Rain." }]);
  assert.ok(added.change);
  await assert.rejects(undoChange(ctx, blank.change.changeId), /Newer edits depend on this change/);
  await undoChange(ctx, added.change.changeId);
  await undoChange(ctx, blank.change.changeId);
  assert.deepEqual((await loadProject(root)).project.episodes, []);
});
