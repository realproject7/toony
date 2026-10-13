// The Script page's view-model (#330, #331): the diff Studio shows is the diff
// the CLI prints, because both come from `diffDraft`; apply through Studio
// leaves the same bytes as `applyDraft`; a conflicting draft is refused with
// nothing written; and the readers' states reach the page as they are.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
  applyDraft,
  buildInitialProject,
  compileEpisodeScript,
  DRAFT_FORMAT_VERSION,
  diffDraft,
  draftPath,
  fingerprintEpisode,
  loadProject,
  writeBrief,
  writeDraft,
  writeEpisodeScript,
  writeProject,
} from "@toony/project-io";
import {
  type Character,
  EPISODE_SCRIPT_FORMAT_VERSION,
  type EpisodeScript,
  PRODUCTION_BRIEF_FORMAT_VERSION,
} from "@toony/schema";
import {
  applyFromStudio,
  describeRefusal,
  discardFromStudio,
  isDraftActionPayload,
  loadBriefView,
  loadDraftView,
  loadScriptView,
} from "../script-view.js";

const CAST: Character[] = [{ id: "mira", name: "Mira", lockstring: "teal coat" }];

let workdir: string;
beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), "toony-script-view-"));
});
afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

async function newProject(name: string): Promise<string> {
  const root = join(workdir, name);
  const project = buildInitialProject(name);
  project.webtoon.characters = CAST;
  await writeProject(root, project);
  return root;
}

function script(episodeId: string, briefRevision: string): EpisodeScript {
  return {
    scriptFormat: EPISODE_SCRIPT_FORMAT_VERSION,
    episodeId,
    briefRevision,
    title: "The Ledger",
    beats: [
      {
        id: "beat-001",
        purpose: "Open.",
        cuts: [
          {
            id: "sc-001",
            intent: "Open on the harbour.",
            scene: "The harbour before dawn.",
            characters: ["mira"],
            dialogue: [{ speaker: null, text: "The tide keeps its own books." }],
            transitionAfter: { type: "gutter" },
          },
          {
            id: "sc-002",
            intent: "Turn.",
            scene: "Mira on the pier.",
            characters: ["mira", "ghost"],
          },
        ],
      },
    ],
  };
}

async function writeDraftFor(root: string, episodeId: string): Promise<void> {
  const revision = await writeBrief(root, {
    briefFormat: PRODUCTION_BRIEF_FORMAT_VERSION,
    intent: "A harbour short.",
    audience: "Anyone.",
    world: "A harbour.",
    storyGoals: ["Keep it short."],
  });
  const value = script(episodeId, revision);
  await writeEpisodeScript(root, value);
  const loaded = await loadProject(root);
  const { bundle, defaults } = compileEpisodeScript(value, loaded.project);
  await writeDraft(root, {
    draftFormat: DRAFT_FORMAT_VERSION,
    episodeId,
    scriptRevision: "a".repeat(64),
    briefRevision: revision,
    bundle,
    defaults,
    reviewedAgainst: null,
  });
}

async function snapshot(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  async function walk(dir: string, rel: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const next = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (next === ".toony" || next.startsWith(".toony/")) continue;
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

test("the script view reports absent, warned and malformed states as the readers do", async () => {
  const root = await newProject("demo");
  const absent = await loadScriptView(root, "ep-002", CAST);
  assert.equal(absent.brief?.absent, true);
  assert.equal(absent.script?.absent, true);
  assert.deepEqual(absent.unreadable, []);

  await writeDraftFor(root, "ep-002");
  const view = await loadScriptView(root, "ep-002", CAST);
  assert.equal(view.script?.validation.valid, true);
  assert.deepEqual(
    view.script?.warnings.map((w) => w.code),
    ["script.character.unknown-ref"],
    "ghost resolves nowhere, and the script stays valid",
  );
  assert.equal(view.brief?.brief?.intent, "A harbour short.");

  await writeFile(join(root, "script", "brief.json"), "{ not json");
  const broken = await loadScriptView(root, "ep-002", CAST);
  assert.deepEqual(broken.unreadable, ["brief"]);
  assert.equal((await loadBriefView(root)).unreadable, true);
});

test("the diff Studio shows is the diff the CLI computes, for a new and an existing episode", async () => {
  const root = await newProject("demo");
  await writeDraftFor(root, "ep-002");
  const loaded = await loadProject(root);
  const fresh = await loadDraftView(root, "ep-002", null);
  assert.ok(fresh.draft?.draft);
  assert.deepEqual(fresh.diff, diffDraft(fresh.draft.draft.bundle, null));
  assert.deepEqual(fresh.conflicts, []);
  assert.equal(fresh.diff?.episodeExists, false);

  const existing = loaded.project.episodes[0];
  assert.ok(existing);
  await writeDraftFor(root, existing.episode.id);
  const against = await loadDraftView(root, existing.episode.id, existing);
  assert.ok(against.draft?.draft);
  assert.deepEqual(against.diff, diffDraft(against.draft.draft.bundle, existing));
  assert.ok(against.conflicts.length > 0, "the scaffold's records are dropped, so it conflicts");
});

test("apply through Studio leaves the same project bytes as the CLI apply", async () => {
  const a = await newProject("cli");
  const b = await newProject("studio");
  await writeDraftFor(a, "ep-002");
  await writeDraftFor(b, "ep-002");

  // The CLI path: show records the fingerprint, apply writes.
  const { readDraft, writeDraft: rewrite } = await import("@toony/project-io");
  const draftA = await readDraft(a, "ep-002");
  assert.ok(draftA.draft);
  await rewrite(a, { ...draftA.draft, reviewedAgainst: await fingerprintEpisode(a, "ep-002") });
  assert.equal((await applyDraft(a, "ep-002")).applied, true);

  // The Studio path: the page rendered against a fingerprint, apply posts it.
  const view = await loadDraftView(b, "ep-002", null);
  const result = await applyFromStudio(b, "ep-002", view.fingerprint);
  assert.equal(result.applied, true, describeRefusal(result));
  assert.equal(result.created, true);

  const bytesA = await snapshot(a);
  const bytesB = await snapshot(b);
  // webtoon.json differs by projectId and title only; every episode file is identical.
  for (const [file, digest] of bytesA) {
    if (file === "webtoon.json") continue;
    assert.equal(bytesB.get(file), digest, file);
  }
  assert.equal((await loadProject(b)).validation.valid, true);
});

test("a stale page cannot apply: the fingerprint it rendered against no longer matches", async () => {
  const root = await newProject("demo");
  await writeDraftFor(root, "ep-002");
  const view = await loadDraftView(root, "ep-002", null);
  // The registry changes under the page.
  const { writeWebtoon } = await import("@toony/project-io");
  const loaded = await loadProject(root);
  await writeWebtoon(root, {
    ...loaded.project.webtoon,
    characters: [...CAST, { id: "nell", name: "Nell", lockstring: "x" }],
  });
  const before = await snapshot(root);
  const result = await applyFromStudio(root, "ep-002", view.fingerprint);
  assert.equal(result.applied, false);
  assert.equal(result.refusal?.reason, "project-changed");
  assert.match(describeRefusal(result), /Reload and review/);
  assert.deepEqual(await snapshot(root), before);
});

test("a conflicting draft is refused with nothing written, and discard removes only the draft", async () => {
  const root = await newProject("demo");
  const loaded = await loadProject(root);
  const existing = loaded.project.episodes[0];
  assert.ok(existing);
  await writeDraftFor(root, existing.episode.id);
  const view = await loadDraftView(root, existing.episode.id, existing);
  assert.ok(view.conflicts.length > 0);
  const before = await snapshot(root);
  const result = await applyFromStudio(root, existing.episode.id, view.fingerprint);
  assert.equal(result.applied, false);
  assert.equal(result.refusal?.reason, "conflicts");
  assert.match(describeRefusal(result), /conflict\(s\)/);
  assert.deepEqual(await snapshot(root), before);

  assert.equal(await discardFromStudio(root, existing.episode.id), true);
  assert.equal(await discardFromStudio(root, existing.episode.id), false);
  await assert.rejects(readFile(draftPath(root, existing.episode.id)));
  assert.deepEqual(await snapshot(root), before);
  const gone = await loadDraftView(root, existing.episode.id, existing);
  assert.equal(gone.draft?.absent, true);
  assert.equal(gone.diff, null);
});

test("the action payload guard admits only what the route needs", () => {
  const fp = {
    webtoon: "a".repeat(64),
    episode: null,
    cuts: null,
    transitions: null,
    lettering: null,
  };
  assert.equal(isDraftActionPayload({ workId: "w", episodeId: "e", action: "discard" }), true);
  assert.equal(
    isDraftActionPayload({ workId: "w", episodeId: "e", action: "apply", reviewedAgainst: fp }),
    true,
  );
  assert.equal(isDraftActionPayload({ workId: "w", episodeId: "e", action: "apply" }), false);
  assert.equal(
    isDraftActionPayload({
      workId: "w",
      episodeId: "e",
      action: "apply",
      reviewedAgainst: { ...fp, webtoon: "x" },
    }),
    false,
  );
  assert.equal(isDraftActionPayload({ workId: "w", episodeId: "e", action: "force" }), false);
  assert.equal(isDraftActionPayload(null), false);
});
