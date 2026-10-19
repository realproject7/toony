// The human workspace's pure helpers: theme, labels, order, progress, plain
// issues, the lettering editor cache, speakers, focus and connection state.

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildInitialProject } from "@toony/project-io";
import type { ConnectionState } from "../agent/protocol.js";
import {
  connectionLabel,
  getConnectionState,
  setConnectionState,
  subscribeConnectionState,
} from "../connection-store.js";
import { isConflictMessage, plainSaveError } from "../editor-messages.js";
import { episodeProgress, progressLine } from "../episode-progress.js";
import { parseLastWork, serializeLastWork } from "../last-work.js";
import {
  cacheMatches,
  letteringEditorKey,
  rememberSave,
  startingLettering,
} from "../lettering-cache.js";
import { plainIssues } from "../plain-issues.js";
import { redactPaths } from "../redact.js";
import { editedLabel, relativeTime } from "../relative-time.js";
import {
  cutNumberIn,
  cutOrder,
  dropTarget,
  orderAfterMove,
  stepTarget,
} from "../sequence-order.js";
import { bubbleMissingSpeaker, defaultSpeaker, needsSpeaker, speakerChoices } from "../speaker.js";
import { readThemeChoice, resolveTheme, THEME_BOOT_SCRIPT } from "../theme.js";
import { episodeFocus, pageFocus } from "../workspace-focus.js";

const seq = (...ids: string[]) =>
  ids.map((id) => ({ type: id.startsWith("t") ? ("transition" as const) : ("cut" as const), id }));

test("theme follows the system unless a light or dark choice is stored", () => {
  assert.equal(readThemeChoice(null), "system");
  assert.equal(readThemeChoice("sepia"), "system");
  assert.equal(readThemeChoice("dark"), "dark");
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("light", true), "light");
  assert.match(THEME_BOOT_SCRIPT, /toony-theme/);
  assert.match(THEME_BOOT_SCRIPT, /prefers-color-scheme: dark/);
});

test("relative time labels stay short and locale-free", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  assert.equal(relativeTime("2026-10-20T11:59:40Z", now), "Just now");
  assert.equal(relativeTime("2026-10-20T11:55:00Z", now), "5 minutes ago");
  assert.equal(relativeTime("2026-10-20T11:00:00Z", now), "1 hour ago");
  assert.equal(relativeTime("2026-10-19T08:00:00Z", now), "Yesterday");
  assert.equal(relativeTime("2026-10-16T12:00:00Z", now), "4 days ago");
  assert.equal(relativeTime("2026-03-04T12:00:00Z", now), "Mar 4");
  assert.equal(relativeTime("2025-03-04T12:00:00Z", now), "Mar 4, 2025");
  assert.equal(relativeTime("1970-01-01T00:00:00.000Z", now), "");
  assert.equal(relativeTime("not a date", now), "");
  assert.equal(editedLabel("2026-10-19T08:00:00Z", now), "Edited yesterday");
  assert.equal(editedLabel("2026-10-20T11:59:40Z", now), "Edited just now");
  assert.equal(editedLabel("2026-10-20T11:55:00Z", now), "Edited 5 minutes ago");
  assert.equal(editedLabel(null, now), "");
});

test("the remembered work parses defensively", () => {
  assert.deepEqual(parseLastWork(serializeLastWork({ id: "cat-cafe", title: "Cat Café" })), {
    id: "cat-cafe",
    title: "Cat Café",
  });
  assert.deepEqual(parseLastWork('{"id":"webtoon-2","title":""}'), {
    id: "webtoon-2",
    title: "webtoon-2",
  });
  assert.equal(parseLastWork("{"), null);
  assert.equal(parseLastWork('{"id":"../up"}'), null);
  assert.equal(parseLastWork('"text"'), null);
  assert.equal(parseLastWork(null), null);
});

test("absolute paths are removed from error text", () => {
  const text = redactPaths("Could not read /srv/studio/Toony/cat/webtoon.json: bad JSON");
  assert.equal(text, "Could not read a project file: bad JSON");
  assert.equal(redactPaths("C:\\Data\\a\\b\\webtoon.json is missing"), "a project file is missing");
  assert.equal(redactPaths("see /api for details"), "see /api for details");
});

test("cut order numbers cuts and steps them up or down", () => {
  const sequence = seq("a", "t1", "b", "c");
  assert.deepEqual(cutOrder(sequence), ["a", "b", "c"]);
  assert.equal(cutNumberIn(sequence, "c"), 3);
  assert.equal(cutNumberIn(sequence, "t1"), 0);
  assert.equal(stepTarget(sequence, "a", "up"), undefined);
  assert.equal(stepTarget(sequence, "b", "up"), null);
  assert.equal(stepTarget(sequence, "c", "up"), "a");
  assert.equal(stepTarget(sequence, "a", "down"), "b");
  assert.equal(stepTarget(sequence, "c", "down"), undefined);
  assert.equal(stepTarget(sequence, "missing", "down"), undefined);
});

test("a dropped cut lands where it was dropped", () => {
  const sequence = seq("a", "b", "c", "d");
  assert.equal(dropTarget(sequence, "c", 0), null);
  assert.equal(dropTarget(sequence, "a", 4), "d");
  assert.equal(dropTarget(sequence, "a", 2), "b");
  assert.equal(dropTarget(sequence, "d", 1), "a");
  assert.equal(dropTarget(sequence, "b", 1), undefined);
  assert.equal(dropTarget(sequence, "b", 2), undefined);
  for (const [cut, index] of [
    ["c", 0],
    ["a", 4],
    ["a", 2],
    ["d", 1],
  ] as const) {
    const after = dropTarget(sequence, cut, index);
    assert.notEqual(after, undefined);
    const moved = orderAfterMove(["a", "b", "c", "d"], cut, after ?? null);
    assert.equal(moved.length, 4);
    assert.equal(moved.indexOf(cut), index > ["a", "b", "c", "d"].indexOf(cut) ? index - 1 : index);
  }
});

test("episode progress counts art, lettering and final cuts", () => {
  const project = buildInitialProject("Progress fixture");
  const bundle = project.episodes[0];
  assert.ok(bundle);
  const first = bundle.cuts[0];
  assert.ok(first);
  const progress = episodeProgress({
    ...bundle,
    cuts: [
      { ...first, image: { clean: "assets/a.png", final: null }, reviewStatus: "final" },
      ...bundle.cuts.slice(1),
    ],
    lettering: [],
  });
  assert.equal(progress.cuts, bundle.cuts.length);
  assert.equal(progress.withArt, 1);
  assert.equal(progress.final, 1);
  assert.equal(progress.lettered, 0);
  assert.match(progressLine(progress), /1 with art/);
  assert.equal(progressLine({ cuts: 0, withArt: 0, lettered: 0, final: 0 }), "No cuts yet");
});

test("validation issues read as places and plain sentences", () => {
  const project = buildInitialProject("Issue fixture");
  const bundle = project.episodes[0];
  assert.ok(bundle);
  const secondCut = bundle.episode.sequence.filter((i) => i.type === "cut")[1]?.id;
  assert.ok(secondCut);
  const lettering = [
    { ...structuredClone(bundle.lettering[0] ?? {}), cutId: secondCut, speaker: "" },
  ] as typeof bundle.lettering;
  const withBubble = { ...project, episodes: [{ ...bundle, lettering }] };
  const issues = plainIssues(
    [
      {
        path: "episodes[0].lettering[0].speaker",
        code: "field.required",
        message: "speaker must be a non-empty string for this bubble kind.",
      },
      { path: "episodes[0].lettering[0].speaker", code: "field.required", message: "duplicate" },
      { path: "webtoon.characters[0].references[0]", code: "character.reference", message: "x" },
      {
        path: "webtoon.title",
        code: "field.required",
        message: "title must be a non-empty `string`",
      },
    ],
    withBubble,
    "/w/fixture",
  );
  assert.equal(issues.length, 3);
  assert.equal(issues[0]?.text, "A dialogue bubble has no speaker.");
  assert.match(issues[0]?.where ?? "", /Cut 2$/);
  assert.equal(
    issues[0]?.href,
    `/w/fixture/episodes/${bundle.episode.id}?item=${encodeURIComponent(`cut:${secondCut}`)}`,
  );
  assert.equal(issues[1]?.where, "Characters");
  assert.equal(issues[2]?.text, "Title must be a non-empty.");
  assert.equal(issues[2]?.where, "Story settings");
});

test("the lettering cache keeps own saves and remounts for outside changes", () => {
  const bubbles = [] as Parameters<typeof rememberSave>[2];
  const first = rememberSave(undefined, "r0", bubbles, "r1");
  assert.deepEqual([first.base, first.revision], ["r0", "r1"]);
  // A refresh brings r1 from disk; a second save keeps the original base.
  const second = rememberSave(first, "r1", bubbles, "r2");
  assert.equal(second.base, "r0");
  assert.equal(letteringEditorKey("c", "r0", first), letteringEditorKey("c", "r1", second));
  assert.equal(letteringEditorKey("c", "r2", second), "c:r0:0");
  // The agent wrote r9: the key changes and the editor starts from the server.
  assert.equal(cacheMatches(second, "r9"), false);
  assert.equal(letteringEditorKey("c", "r9", second), "c:r9:0");
  assert.equal(startingLettering(bubbles, "r9", second).revision, "r9");
  assert.equal(startingLettering(bubbles, "r1", second).revision, "r2");
  assert.equal(letteringEditorKey("c", "r9", second, 2), "c:r9:2");
});

test("save errors read as plain sentences", () => {
  assert.equal(
    plainSaveError(
      "invalid project after lettering edit: episodes[0].lettering[1].speaker: speaker must be a non-empty string for this bubble kind.",
    ),
    "Choose who says each dialogue bubble, then save again.",
  );
  assert.match(
    plainSaveError("invalid transitions: transitions[0].gutterHeight: must be an integer"),
    /height/,
  );
  const conflict =
    "This episode changed after you opened it. Your draft is preserved. Reload the saved version before applying it again.";
  assert.equal(isConflictMessage(conflict), true);
  assert.equal(plainSaveError(conflict), conflict);
  assert.equal(plainSaveError("Lettering saved."), "Lettering saved.");
});

test("a new dialogue bubble starts with a known speaker", () => {
  const characters = [
    { id: "mina", name: "Mina", lockstring: "x" },
    { id: "jun", name: "Jun", lockstring: "y" },
  ];
  assert.equal(
    defaultSpeaker({ lastUsed: "Narrator Cat", characters, bubbles: [] }),
    "Narrator Cat",
  );
  assert.equal(defaultSpeaker({ cutCharacterIds: ["jun"], characters, bubbles: [] }), "Jun");
  assert.equal(defaultSpeaker({ characters, bubbles: [] }), "");
  assert.equal(
    defaultSpeaker({ characters: [characters[0] as (typeof characters)[0]], bubbles: [] }),
    "Mina",
  );
  assert.deepEqual(speakerChoices(characters, ["jun"]), ["Jun", "Mina"]);
  assert.equal(needsSpeaker("narration"), false);
  assert.equal(needsSpeaker("whisper"), true);
  const bubble = { id: "b", kind: "speech", speaker: " " } as Parameters<
    typeof bubbleMissingSpeaker
  >[0][number];
  assert.equal(bubbleMissingSpeaker([bubble])?.id, "b");
  assert.equal(bubbleMissingSpeaker([{ ...bubble, kind: "narration" }]), null);
});

test("focus names the cut, transition and selected bubbles", () => {
  assert.deepEqual(episodeFocus("ep-001", { type: "cut", id: "cut-002" }, ["b1"]), {
    route: "episode",
    episodeId: "ep-001",
    cutId: "cut-002",
    bubbleIds: ["b1"],
  });
  assert.deepEqual(episodeFocus("ep-001", { type: "transition", id: "tr-1" }, ["b1"]), {
    route: "episode",
    episodeId: "ep-001",
    transitionId: "tr-1",
  });
  assert.deepEqual(pageFocus("story"), { route: "story" });
  assert.deepEqual(pageFocus("preview", "ep-002"), { route: "preview", episodeId: "ep-002" });
});

test("the connection store notifies on real changes only", () => {
  let calls = 0;
  const stop = subscribeConnectionState(() => {
    calls += 1;
  });
  const state: ConnectionState = { status: "disconnected" };
  setConnectionState(state);
  setConnectionState({ status: "disconnected" });
  assert.equal(calls, 1);
  assert.deepEqual(getConnectionState(), state);
  assert.equal(connectionLabel(state), "Not connected");
  assert.equal(connectionLabel(null), "Checking…");
  assert.equal(
    connectionLabel({
      status: "connected",
      verifiedAt: "x",
      preferences: {
        provider: "codex",
        model: "",
        autoApply: true,
        viewArtwork: true,
        retainHistory: true,
      },
    }),
    "Codex is connected",
  );
  stop();
});

test("the story page lists episodes in reading order with their last change and the cast", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { loadProject, writeProject } = await import("@toony/project-io");
  const { castMembers, storyEpisodes } = await import("../story-view.js");
  const temp = await mkdtemp(join(tmpdir(), "toony-story-view-"));
  const root = join(temp, "work");
  try {
    const project = buildInitialProject("Story view fixture");
    const first = project.episodes[0];
    assert.ok(first);
    const second = structuredClone(first);
    second.episode = { ...second.episode, id: "ep-010", title: "  " };
    const third = structuredClone(first);
    third.episode = { ...third.episode, id: "ep-002", title: "Second" };
    project.episodes = [first, second, third];
    project.webtoon.characters = [
      {
        id: "mina",
        name: "Mina",
        lockstring: "x",
        development: { role: "Lead", desire: "a", flaw: "b", voice: "c", arc: "d" },
      },
    ];
    await writeProject(root, project);
    const loaded = await loadProject(root);
    const episodes = await storyEpisodes(root, loaded);
    assert.deepEqual(
      episodes.map((e) => [e.id, e.number, e.title]),
      [
        [first.episode.id, 1, first.episode.title],
        ["ep-002", 2, "Second"],
        ["ep-010", 3, "Episode 3"],
      ],
    );
    assert.ok(episodes.every((e) => e.updatedAt !== "" && !Number.isNaN(Date.parse(e.updatedAt))));
    assert.deepEqual(castMembers("fixture", root, loaded), [
      { id: "mina", name: "Mina", role: "Lead", portrait: null },
    ]);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
