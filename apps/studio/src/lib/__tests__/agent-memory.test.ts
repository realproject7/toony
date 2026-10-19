// Agent memory and recovery: the brief a new session starts from stays within
// 8 KB however large the work is, says what changed since the last turn, and
// the focus line names what the person is looking at in words, including a
// page for an episode that does not exist yet.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildInitialProject } from "@toony/project-io";
import type { EpisodeBundle, Project } from "@toony/schema";
import { focusFromLocation } from "../agent/focus-route.js";
import {
  BRIEF_MAX_BYTES,
  cleanMemory,
  episodeName,
  focusLine,
  MEMORY_FILE,
  normalizeTasks,
  readMemory,
  recoveryBrief,
  updateMemory,
} from "../agent/memory.js";
import type { JournalEntry } from "../ops/index.js";

function bundle(id: string, title: string, cuts: number, withArt = 0): EpisodeBundle {
  const cutIds = Array.from({ length: cuts }, (_, i) => `cut-${String(i + 1).padStart(3, "0")}`);
  return {
    episode: {
      schemaVersion: 1,
      id,
      title,
      sequence: cutIds.flatMap((cutId, i) => [
        ...(i > 0 ? [{ type: "transition" as const, id: `tr-${cutId}` }] : []),
        { type: "cut" as const, id: cutId },
      ]),
    },
    cuts: cutIds.map((cutId, i) => ({
      id: cutId,
      image: i < withArt ? { clean: `episodes/${id}/assets/${cutId}.png` } : null,
      imagePrompt: `Scene ${i + 1}`,
      negativePrompt: "",
    })),
    transitions: [],
    lettering: cutIds.slice(0, 2).map((cutId, i) => ({
      id: `b${i + 1}`,
      cutId,
      speaker: "mina",
      text: i === 0 ? "Where did this letter come from? It is soaked through." : "Hello.",
    })),
  } as unknown as EpisodeBundle;
}

function project(episodes: EpisodeBundle[]): Project {
  const base = buildInitialProject("Harbor Letters");
  base.webtoon.logline = "A girl answers letters the sea brings.";
  base.webtoon.characters = [{ id: "mina", name: "Mina", lockstring: "yellow raincoat" }];
  base.episodes = episodes;
  return base;
}

const journal = (
  n: number,
  at = (i: number) => `2026-10-${String(1 + (i % 28)).padStart(2, "0")}T10:00:00.000Z`,
) =>
  Array.from(
    { length: n },
    (_, i): JournalEntry => ({
      changeId: `c${i}`,
      at: at(i),
      actor: i % 2 ? "human" : "agent",
      summary: `Change number ${i} ${"with a long description ".repeat(4)}`,
      scopes: [{ kind: "episode", episodeId: "ep-002" }],
      files: [],
    }),
  );

test("the focus line names episodes and cuts by number and title", () => {
  const p = project([bundle("ep-010", "Later", 2), bundle("ep-002", "The Letter", 4)]);
  assert.equal(episodeName(p, "ep-002"), "Episode 1 (The Letter)");
  assert.equal(episodeName(p, "ep-010"), "Episode 2 (Later)");
  assert.equal(
    focusLine(p, {
      route: "episode",
      episodeId: "ep-002",
      cutId: "cut-003",
      bubbleIds: ["b1", "b2"],
    }),
    'The person is looking at Episode 1 (The Letter), Cut 3. Selected bubbles: 2 ("Where did this letter come from? It is…", "Hello.").',
  );
  assert.equal(
    focusLine(p, { route: "episode", episodeId: "ep-002", transitionId: "tr-cut-002" }),
    "The person is looking at Episode 1 (The Letter), the transition after Cut 1.",
  );
  assert.equal(
    focusLine(p, { route: "episode", episodeId: "ep-099" }),
    "The person is on a page for a new episode that does not exist yet.",
  );
  assert.equal(
    focusLine(p, { route: "preview", episodeId: "ep-010" }),
    "The person is reading Episode 2 (Later).",
  );
  assert.equal(
    focusLine(p, { route: "characters", characterId: "mina" }),
    "The person is looking at the cast, at Mina.",
  );
  assert.equal(focusLine(p, { route: "story" }), "The person is looking at the story page.");
  assert.equal(
    focusLine(null, { route: "episode", episodeId: "ep-002" }),
    "The person is in the library.",
  );
  assert.equal(focusLine(p, undefined), "The person is in the library.");
});

test("the recovery brief stays within 8 KB and keeps what matters most", () => {
  const huge = project(
    Array.from({ length: 70 }, (_, i) =>
      bundle(`ep-${String(i + 1).padStart(3, "0")}`, `Episode title ${"x".repeat(80)} ${i}`, 30, 5),
    ),
  );
  const brief = recoveryBrief({
    project: huge,
    memory: {
      version: 1,
      notes: Array.from({ length: 100 }, (_, i) => ({
        id: `n-${i}`,
        kind: "decision" as const,
        text: `Decision ${i}: ${"keep it gentle ".repeat(30)}`,
        at: "2026-10-01T00:00:00.000Z",
      })),
      tasks: normalizeTasks([
        { title: "Write episode 71", status: "in_progress" },
        { title: "Letter it", status: "pending" },
      ]),
      updatedAt: "2026-10-01T00:00:00.000Z",
    },
    journal: journal(200),
    since: "2026-12-01T00:00:00.000Z",
    openQuestions: ["Which ending should episode 71 have?"],
    tasks: normalizeTasks([{ title: "Write episode 71", status: "in_progress" }]),
  });
  assert.ok(Buffer.byteLength(brief) <= BRIEF_MAX_BYTES, `${Buffer.byteLength(brief)} bytes`);
  assert.match(brief, /^# Harbor Letters/);
  assert.match(brief, /Logline: A girl answers letters/);
  assert.match(brief, /\[>\] Write episode 71/);
  assert.match(brief, /Open question \(waiting for the person\)\n- Which ending/);
  assert.match(brief, /## Changed since your last turn\n- Nothing\./);
  assert.match(brief, /Episode 1 \(Episode title/);
  assert.ok(
    (brief.split("## Episodes\n")[1] ?? "").split("\n").filter((l) => l.startsWith("- Episode"))
      .length >= 12,
  );
  assert.match(brief, /## Remembered notes\n/);
});

test("the brief lists what changed since the last turn, by whom", () => {
  const p = project([bundle("ep-002", "The Letter", 3, 1)]);
  const entries = journal(4, (i) => `2026-10-20T1${i}:00:00.000Z`);
  const brief = recoveryBrief({
    project: p,
    memory: { version: 1, notes: [], tasks: [], updatedAt: "" },
    journal: entries,
    since: "2026-10-20T11:30:00.000Z",
    openQuestions: [],
    tasks: [],
  });
  const changed = brief.split("## Changed since your last turn\n")[1]?.split("\n\n")[0] ?? "";
  assert.equal(changed.split("\n").length, 2);
  assert.match(changed, /\(agent\) Change number 2/);
  assert.match(changed, /\(person\) Change number 3/);
  assert.match(
    brief,
    /Episode 1 \(The Letter\) \[ep-002\]: 3 cuts, 1 with art, 2 bubbles; last change/,
  );

  const library = recoveryBrief({
    project: null,
    works: [{ id: "harbor", title: "Harbor Letters" }],
    memory: { version: 1, notes: [], tasks: [], updatedAt: "" },
    journal: [],
    since: null,
    openQuestions: [],
    tasks: [],
  });
  assert.match(library, /library/);
  assert.match(library, /- Harbor Letters \[harbor\]/);
});

test("memory files are private, cleaned on read and changed one at a time", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "toony-memory-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.deepEqual((await readMemory(dir)).notes, []);
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      updateMemory(dir, (memory) => {
        memory.notes.push({
          id: `n-${i}`,
          kind: "note",
          text: `note ${i}`,
          at: "2026-10-20T00:00:00.000Z",
        });
        return memory;
      }),
    ),
  );
  const memory = await readMemory(dir);
  assert.equal(memory.notes.length, 10, "no update was lost");
  assert.equal((await stat(join(dir, MEMORY_FILE))).mode & 0o777, 0o600);
  assert.equal((await stat(join(dir, ".toony/agent"))).mode & 0o777, 0o700);
  await writeFile(
    join(dir, MEMORY_FILE),
    JSON.stringify({
      notes: [
        { id: "../bad", kind: "note", text: "x", at: "" },
        { id: "ok", kind: "secret", text: "x", at: "" },
      ],
      tasks: [
        { id: "t1", title: "Fine", status: "done" },
        { id: "t2", title: "", status: "done" },
      ],
    }),
  );
  const cleaned = await readMemory(dir);
  assert.deepEqual(cleaned.notes, []);
  assert.deepEqual(cleaned.tasks, [{ id: "t1", title: "Fine", status: "done" }]);
  assert.deepEqual(cleanMemory("nonsense").tasks, []);
  assert.ok((await readFile(join(dir, MEMORY_FILE), "utf8")).length > 0);
});

test("the browser location gives the focus, including the editor's selection", () => {
  assert.deepEqual(focusFromLocation("/"), { workId: null, focus: { route: "library" } });
  assert.deepEqual(focusFromLocation("/settings"), { workId: null, focus: { route: "settings" } });
  assert.deepEqual(focusFromLocation("/w/harbor"), { workId: "harbor", focus: { route: "story" } });
  assert.deepEqual(focusFromLocation("/w/harbor/characters"), {
    workId: "harbor",
    focus: { route: "characters" },
  });
  assert.deepEqual(focusFromLocation("/w/harbor/episodes/ep-002", "?item=cut%3Acut-003"), {
    workId: "harbor",
    focus: { route: "episode", episodeId: "ep-002", cutId: "cut-003" },
  });
  assert.deepEqual(focusFromLocation("/w/harbor/episodes/ep-002", "item=transition:tr-cut-002"), {
    workId: "harbor",
    focus: { route: "episode", episodeId: "ep-002", transitionId: "tr-cut-002" },
  });
  assert.deepEqual(focusFromLocation("/w/harbor/episodes/ep-002/cuts/cut-004/edit"), {
    workId: "harbor",
    focus: { route: "episode", episodeId: "ep-002", cutId: "cut-004" },
  });
  assert.deepEqual(focusFromLocation("/w/harbor/episodes/ep-002/read").focus.route, "preview");
  assert.deepEqual(focusFromLocation("/w/harbor/episodes/ep-002/export").focus.route, "export");
  // A script page for an episode that does not exist yet still has a focus.
  assert.deepEqual(focusFromLocation("/w/harbor/episodes/ep-009/script"), {
    workId: "harbor",
    focus: { route: "episode", episodeId: "ep-009" },
  });
  assert.deepEqual(focusFromLocation("/w/..%2Fx/episodes"), {
    workId: null,
    focus: { route: "library" },
  });
  assert.deepEqual(focusFromLocation("/w/harbor/episodes/ep-1", "?item=cut:..").focus, {
    route: "episode",
    episodeId: "ep-1",
  });
});
