// The episode draft: compile, diff, conflicts and apply (#312).
//
// Four things are proven here. The compiler invents nothing silently and names
// every default. Compile and report write no byte into the project. A conflict
// is any field apply would change on a record the project holds, or a record it
// would drop, and apply refuses on every one of them with nothing written. And
// an apply interrupted at any rename leaves every reference on disk resolving.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
  type Character,
  EPISODE_SCRIPT_FORMAT_VERSION,
  type EpisodeScript,
  PRODUCTION_BRIEF_FORMAT_VERSION,
  type ProductionBrief,
  validateProject,
} from "@toony/schema";
import { atomicWriteAll } from "../atomic.js";
import {
  applyDraft,
  compileEpisodeScript,
  DRAFT_DEFAULT_GUTTER_HEIGHT,
  DRAFT_FORMAT_VERSION,
  diffDraft,
  draftCommitSteps,
  draftConflicts,
  draftPath,
  type EpisodeDraft,
  fingerprintEpisode,
  projectWithDraft,
  readDraft,
  writeDraft,
} from "../draft.js";
import { encodeJson } from "../format.js";
import { episodeDir } from "../paths.js";
import { loadProject } from "../reader.js";
import { buildInitialProject } from "../scaffold.js";
import { writeBrief, writeEpisodeScript } from "../script.js";
import { writeCuts, writeProject, writeWebtoon } from "../writer.js";

const CAST: Character[] = [
  { id: "mira", name: "Mira", lockstring: "teal coat, cropped hair, ink line" },
  { id: "sol", name: "Sol", lockstring: "grey scarf, round glasses, ink line" },
];

function brief(): ProductionBrief {
  return {
    briefFormat: PRODUCTION_BRIEF_FORMAT_VERSION,
    intent: "A quiet harbour story about a debt nobody wrote down.",
    audience: "Adult readers who want a slow burn.",
    world: "A working harbour town, late autumn.",
    storyGoals: ["Make the debt feel physical."],
  };
}

/** A three-cut script with one gutter, one scene break, dialogue and narration. */
function script(episodeId: string, briefRevision: string): EpisodeScript {
  return {
    scriptFormat: EPISODE_SCRIPT_FORMAT_VERSION,
    episodeId,
    briefRevision,
    beats: [
      {
        id: "beat-001",
        purpose: "Establish the debt.",
        cuts: [
          {
            id: "sc-001",
            intent: "Open on the harbour.",
            scene: "The harbour before dawn, nets still wet.",
            characters: ["mira"],
            shotType: "establishing_wide",
            dialogue: [{ speaker: null, text: "The tide keeps its own books." }],
            transitionAfter: { type: "gutter" },
          },
          {
            id: "sc-002",
            intent: "Mira is seen.",
            scene: "Sol on the pier, turning at a footstep.",
            characters: ["mira", "sol"],
            shotType: "medium",
            palette: "#9fb4c7",
            dialogue: [
              { speaker: "sol", text: "You are early." },
              { speaker: "mira", text: "You are late.", kind: "whisper" },
            ],
            transitionAfter: { type: "scene-break", gutterHeight: 120, text: "Noon" },
          },
        ],
      },
      {
        id: "beat-002",
        purpose: "The debt is named.",
        cuts: [
          {
            id: "sc-003",
            intent: "Close on the ledger.",
            scene: "A ledger open on a crate, one line underlined.",
            shotType: "close_up",
          },
        ],
      },
    ],
  };
}

let workdir: string;

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), "toony-draft-"));
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

/** sha256 of every file under `root`, keyed by relative path. */
async function snapshot(root: string, skip: string[] = []): Promise<Map<string, string>> {
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

async function compileFor(root: string, episodeId: string) {
  const revision = await writeBrief(root, brief());
  const value = script(episodeId, revision);
  await writeEpisodeScript(root, value);
  const loaded = await loadProject(root);
  return { ...compileEpisodeScript(value, loaded.project), script: value, project: loaded.project };
}

async function draftFor(root: string, episodeId: string): Promise<EpisodeDraft> {
  const { bundle, defaults } = await compileFor(root, episodeId);
  const draft: EpisodeDraft = {
    draftFormat: DRAFT_FORMAT_VERSION,
    episodeId,
    scriptRevision: "a".repeat(64),
    briefRevision: null,
    bundle,
    defaults,
    reviewedAgainst: await fingerprintEpisode(root, episodeId),
  };
  await writeDraft(root, draft);
  return draft;
}

// --- Compile ----------------------------------------------------------------

test("a compiled draft validates with its project and carries the script's own text", async () => {
  const root = await newProject();
  const { bundle, project } = await compileFor(root, "ep-002");

  assert.equal(validateProject(projectWithDraft(project, bundle)).valid, true);
  assert.deepEqual(
    bundle.cuts.map((cut) => cut.id),
    ["sc-001", "sc-002", "sc-003"],
  );
  assert.equal(bundle.cuts[0]?.imagePrompt, "The harbour before dawn, nets still wet.");
  // No lockstring, no story bible, no palette clause composed in.
  for (const cut of bundle.cuts) {
    assert.ok(!cut.imagePrompt.includes("teal coat"));
    assert.ok(!cut.imagePrompt.includes("Story context"));
  }
  assert.deepEqual(bundle.cuts[1]?.characters, ["mira", "sol"]);
  assert.equal(bundle.cuts[1]?.palette, "#9fb4c7");
  assert.equal(bundle.cuts[2]?.shotType, "close_up");
  // Render outputs stay empty: the compiler ran no render.
  for (const cut of bundle.cuts) {
    assert.equal(cut.image, null);
    assert.equal(cut.imageSeed, undefined);
    assert.equal(cut.imageWorkflow, undefined);
    assert.equal(cut.reviewStatus, undefined);
  }
  // Transitions only where the script states them, in sequence order.
  assert.deepEqual(
    bundle.episode.sequence.map((item) => `${item.type}:${item.id}`),
    ["cut:sc-001", "transition:tr-sc-001", "cut:sc-002", "transition:tr-sc-002", "cut:sc-003"],
  );
  assert.equal(bundle.transitions[1]?.type, "scene-break");
  assert.equal(bundle.transitions[1]?.gutterHeight, 120);
  assert.equal(bundle.transitions[1]?.text, "Noon");
  // Lettering: narration unattributed, speech by registry name, kind honoured.
  const overlays = bundle.lettering;
  assert.equal(overlays.length, 3);
  assert.deepEqual(
    overlays.map((o) => [o.cutId, o.kind, o.speaker, o.text]),
    [
      ["sc-001", "narration", "", "The tide keeps its own books."],
      ["sc-002", "speech", "Sol", "You are early."],
      ["sc-002", "whisper", "Mira", "You are late."],
    ],
  );
  assert.ok((overlays[2]?.geometry.y ?? 0) > (overlays[1]?.geometry.y ?? 0), "lines stack down");
});

test("every default the compiler filled is named, and nothing else is", async () => {
  const root = await newProject();
  const { bundle, defaults } = await compileFor(root, "ep-002");
  const keys = defaults.map((d) => `${d.kind} ${d.id} ${d.field}`).sort();
  const expected = [
    ...bundle.cuts.map((cut) => `cut ${cut.id} negativePrompt`),
    // The first transition stated no height; the second stated 120.
    "transition tr-sc-001 gutterHeight",
    ...bundle.lettering.flatMap((o) =>
      ["fill", "opacity", "border", "tail", "geometry"].map((f) => `overlay ${o.id} ${f}`),
    ),
    // The script stated no title and the episode does not exist yet.
    "episode ep-002 title",
  ].sort();
  assert.deepEqual(keys, expected);
  const gutter = defaults.find((d) => d.id === "tr-sc-001");
  assert.equal(gutter?.value, DRAFT_DEFAULT_GUTTER_HEIGHT);
  assert.equal(bundle.episode.title, "Episode ep-002");
});

test("a script title is used as stated; an existing episode keeps its title when the script states none", async () => {
  const root = await newProject();
  const loaded = await loadProject(root);
  const existingId = loaded.project.episodes[0]?.episode.id ?? "";
  const existingTitle = loaded.project.episodes[0]?.episode.title ?? "";
  const revision = await writeBrief(root, brief());
  const value = script(existingId, revision);
  const kept = compileEpisodeScript(value, loaded.project);
  assert.equal(kept.bundle.episode.title, existingTitle);
  assert.ok(kept.defaults.some((d) => d.kind === "episode" && d.field === "title"));
  value.title = "The Ledger";
  const stated = compileEpisodeScript(value, loaded.project);
  assert.equal(stated.bundle.episode.title, "The Ledger");
  assert.ok(!stated.defaults.some((d) => d.kind === "episode"));
});

test("a transition after the last cut is refused at the script field", async () => {
  const root = await newProject();
  const loaded = await loadProject(root);
  const value = script("ep-002", "b".repeat(64));
  const last = value.beats[1]?.cuts[0];
  assert.ok(last);
  last.transitionAfter = { type: "fade" };
  assert.throws(
    () => compileEpisodeScript(value, loaded.project),
    /beats\[1\]\.cuts\[0\]\.transitionAfter.*last cut/,
  );
});

test("compiling is deterministic and writes nothing into the project", async () => {
  const root = await newProject();
  await writeBrief(root, brief());
  const before = await snapshot(root, ["script"]);
  const a = await compileFor(root, "ep-002");
  const b = await compileFor(root, "ep-002");
  assert.deepEqual(a.bundle, b.bundle);
  assert.deepEqual(a.defaults, b.defaults);
  const diff = diffDraft(a.bundle, null);
  assert.equal(draftConflicts(diff).length, 0);
  assert.deepEqual(await snapshot(root, ["script"]), before);
});

test("the compiler carries the continuity hand-off onto the draft with whether the previous episode exists (#329)", async () => {
  const root = await newProject();
  const loaded = await loadProject(root);
  const existing = loaded.project.episodes[0]?.episode.id ?? "";
  const value = script("ep-002", "b".repeat(64));
  assert.equal(compileEpisodeScript(value, loaded.project).continuity, undefined);
  value.continuity = { previousEpisodeId: existing, startsFrom: "After the opening." };
  assert.deepEqual(compileEpisodeScript(value, loaded.project).continuity, {
    previousEpisodeId: existing,
    startsFrom: "After the opening.",
    previousExists: true,
  });
  value.continuity = { previousEpisodeId: "ep-009", startsFrom: "Later." };
  assert.equal(compileEpisodeScript(value, loaded.project).continuity?.previousExists, false);
  // The record is the script's, not a derived one: nothing else on the bundle changes.
  const withOut = compileEpisodeScript(script("ep-002", "b".repeat(64)), loaded.project);
  assert.deepEqual(compileEpisodeScript(value, loaded.project).bundle, withOut.bundle);
});

test("a theme letters compiled overlays and is named in the defaults (#334)", async () => {
  const root = await newProject();
  const loaded = await loadProject(root);
  const value = script("ep-002", "b".repeat(64));
  const theme = {
    themeFormat: 1,
    kinds: {
      narration: { fill: "#1b1b1b", textColor: "#f3f3f3" },
      whisper: { fontFamily: "patrick-hand" },
    },
  } as const;
  const { bundle, defaults } = compileEpisodeScript(value, loaded.project, { theme });
  const narration = bundle.lettering.find((o) => o.kind === "narration");
  const whisper = bundle.lettering.find((o) => o.kind === "whisper");
  assert.equal(narration?.fill, "#1b1b1b");
  assert.equal(narration?.textColor, "#f3f3f3");
  assert.equal(whisper?.fontFamily, "patrick-hand");
  assert.ok(
    defaults.some(
      (d) => d.id === narration?.id && d.field === "textColor" && d.value === "#f3f3f3",
    ),
  );
  assert.ok(defaults.some((d) => d.id === whisper?.id && d.field === "fontFamily"));
  const plain = compileEpisodeScript(value, loaded.project);
  assert.equal(plain.bundle.lettering.find((o) => o.kind === "narration")?.fill, "#ffffff");
  assert.deepEqual(plain.bundle.cuts, bundle.cuts, "a theme touches overlays only");
});

// --- Draft file -------------------------------------------------------------

test("a draft lives under .toony and is invisible to the project loader, malformed or not", async () => {
  const root = await newProject();
  const before = await loadProject(root);
  const beforeFiles = await snapshot(root, [".toony", "script"]);
  await draftFor(root, "ep-002");
  assert.ok(draftPath(root, "ep-002").includes(join(".toony", "drafts")));

  const after = await loadProject(root);
  assert.deepEqual(after.project, before.project);
  assert.deepEqual(validateProject(after.project), validateProject(before.project));
  assert.deepEqual(await snapshot(root, [".toony", "script"]), beforeFiles);

  await writeFile(draftPath(root, "ep-002"), "{ not json");
  assert.deepEqual((await loadProject(root)).project, before.project);
  await assert.rejects(readDraft(root, "ep-002"), (e: Error) => e.name === "ProjectIoError");
  await writeFile(draftPath(root, "ep-002"), encodeJson({ draftFormat: 1 }));
  const loaded = await readDraft(root, "ep-002");
  assert.equal(loaded.draft, null);
  assert.equal(loaded.validation.valid, false);
  assert.deepEqual((await loadProject(root)).project, before.project);
});

test("a draft reads back equal and an absent one is absent", async () => {
  const root = await newProject();
  assert.equal((await readDraft(root, "ep-002")).absent, true);
  const written = await draftFor(root, "ep-002");
  const loaded = await readDraft(root, "ep-002");
  assert.equal(loaded.absent, false);
  assert.deepEqual(loaded.draft, written);
});

// --- Diff and conflicts -----------------------------------------------------

test("the diff counts added, changed, removed and unchanged per kind, and names only differing fields", async () => {
  const root = await newProject();
  const { bundle } = await compileFor(root, "ep-002");
  const fresh = diffDraft(bundle, null);
  assert.equal(fresh.episodeExists, false);
  assert.deepEqual(fresh.counts.cut, { added: 3, changed: 0, removed: 0, unchanged: 0 });
  assert.equal(fresh.sequence.status, "new");

  // The same bundle against itself: everything unchanged.
  const same = diffDraft(bundle, bundle);
  assert.deepEqual(same.counts.cut, { added: 0, changed: 0, removed: 0, unchanged: 3 });
  assert.equal(same.sequence.status, "unchanged");
  assert.equal(draftConflicts(same).length, 0);

  // One prompt edited by hand, one cut dropped: two conflicts, each named.
  const edited = structuredClone(bundle);
  const target = edited.cuts[0];
  assert.ok(target);
  target.imagePrompt = "A hand-written prompt.";
  edited.cuts.pop();
  edited.episode.sequence = edited.episode.sequence.slice(0, -1);
  const diff = diffDraft(bundle, edited);
  assert.deepEqual(diff.counts.cut, { added: 1, changed: 1, removed: 0, unchanged: 1 });
  assert.equal(diff.changed[0]?.id, "sc-001");
  assert.deepEqual(diff.changed[0]?.changes, [
    {
      field: "imagePrompt",
      current: "A hand-written prompt.",
      drafted: bundle.cuts[0]?.imagePrompt,
    },
  ]);
  assert.equal(diff.sequence.status, "extended");
  const conflicts = draftConflicts(diff);
  assert.deepEqual(
    conflicts.map((c) => `${c.kind} ${c.id} ${c.field}`),
    ["cut sc-001 imagePrompt"],
  );
  // A cut carrying no review mark and no render inputs is still a conflict.
  assert.deepEqual(conflicts[0]?.marks, {
    imagePrompt: "A hand-written prompt.",
    negativePrompt: "",
  });
});

test("a record the project holds and the draft drops is a conflict, and so is a reordered sequence", async () => {
  const root = await newProject();
  const { bundle } = await compileFor(root, "ep-002");
  const extra = structuredClone(bundle);
  extra.cuts.push({ id: "sc-999", image: null, imagePrompt: "An extra cut.", negativePrompt: "" });
  extra.episode.sequence.push({ type: "cut", id: "sc-999" });
  const dropped = draftConflicts(diffDraft(bundle, extra));
  assert.ok(dropped.some((c) => c.kind === "cut" && c.id === "sc-999" && c.field === "(record)"));
  assert.ok(dropped.some((c) => c.kind === "episode" && c.field === "sequence"));

  const reordered = structuredClone(bundle);
  reordered.episode.sequence = [...bundle.episode.sequence].reverse();
  const order = draftConflicts(diffDraft(bundle, reordered));
  assert.deepEqual(
    order.map((c) => `${c.kind} ${c.field}`),
    ["episode sequence"],
  );
});

// --- Apply ------------------------------------------------------------------

test("apply creates an absent episode with its folders and leaves every other file byte-identical", async () => {
  const root = await newProject();
  const before = await snapshot(root, [".toony"]);
  await draftFor(root, "ep-002");

  const result = await applyDraft(root, "ep-002");
  assert.equal(result.applied, true, JSON.stringify(result.refusal));
  assert.equal(result.created, true);

  const loaded = await loadProject(root);
  assert.equal(loaded.validation.valid, true);
  const bundle = loaded.project.episodes.find((e) => e.episode.id === "ep-002");
  assert.ok(bundle);
  const draft = (await readDraft(root, "ep-002")).draft;
  assert.ok(draft);
  assert.deepEqual(bundle, draft.bundle);
  for (const dir of ["assets/clean", "assets/final", "exports/plotlink", "logs"]) {
    const entries = await readdir(join(episodeDir(root, "ep-002"), dir));
    assert.deepEqual(entries, []);
  }
  const after = await snapshot(root, [".toony"]);
  for (const [file, digest] of before) {
    assert.equal(after.get(file), digest, `${file} changed`);
  }
  // A second apply of the same draft changes nothing and is not a conflict.
  const again = await applyDraft(root, "ep-002");
  assert.equal(again.applied, false);
  assert.equal(again.refusal?.reason, "project-changed", "the apply itself moved the fingerprint");
});

test("apply refuses on every conflict with nothing written, and reports all of them", async () => {
  const root = await newProject();
  const loaded = await loadProject(root);
  const existing = loaded.project.episodes[0];
  assert.ok(existing);
  const id = existing.episode.id;
  // A hand-written prompt on a cut with no review mark, no seed, no workflow.
  const cuts = existing.cuts.map((cut, i) =>
    i === 0 ? { ...cut, imagePrompt: "Written by hand, never generated." } : cut,
  );
  await writeCuts(root, id, cuts);

  const revision = await writeBrief(root, brief());
  const value = script(id, revision);
  // Name the existing cut so the draft tries to change it, plus one new cut.
  const first = value.beats[0]?.cuts[0];
  assert.ok(first);
  first.id = cuts[0]?.id ?? "";
  await writeEpisodeScript(root, value);
  const project = (await loadProject(root)).project;
  const { bundle, defaults } = compileEpisodeScript(value, project);
  await writeDraft(root, {
    draftFormat: DRAFT_FORMAT_VERSION,
    episodeId: id,
    scriptRevision: "a".repeat(64),
    briefRevision: null,
    bundle,
    defaults,
    reviewedAgainst: await fingerprintEpisode(root, id),
  });

  const before = await snapshot(root, [".toony"]);
  const result = await applyDraft(root, id);
  assert.equal(result.applied, false);
  assert.equal(result.refusal?.reason, "conflicts");
  if (result.refusal?.reason !== "conflicts") return;
  const fields = result.refusal.conflicts.map((c) => `${c.kind} ${c.id} ${c.field}`);
  assert.ok(fields.includes(`cut ${first.id} imagePrompt`), fields.join("\n"));
  assert.ok(
    result.refusal.conflicts.length > 1,
    "the scaffold's other records are dropped too, and every conflict is listed",
  );
  const prompt = result.refusal.conflicts.find((c) => c.field === "imagePrompt");
  assert.equal(prompt?.marks.reviewStatus, undefined);
  assert.equal(prompt?.marks.imageSeed, undefined);
  assert.deepEqual(await snapshot(root, [".toony"]), before);
});

test("apply refuses when the project changed since the last report", async () => {
  const root = await newProject();
  const draft = await draftFor(root, "ep-002");
  // Any change to the files the fingerprint covers: here, the registry.
  const loaded = await loadProject(root);
  loaded.project.webtoon.characters = [...CAST, { id: "nell", name: "Nell", lockstring: "x" }];
  await writeWebtoon(root, loaded.project.webtoon);

  const before = await snapshot(root, [".toony"]);
  const result = await applyDraft(root, "ep-002");
  assert.equal(result.applied, false);
  assert.equal(result.refusal?.reason, "project-changed");
  assert.deepEqual(await snapshot(root, [".toony"]), before);

  // Re-reporting records the new state and the apply then goes through.
  await writeDraft(root, { ...draft, reviewedAgainst: await fingerprintEpisode(root, "ep-002") });
  assert.equal((await applyDraft(root, "ep-002")).applied, true);
});

test("apply refuses a project that does not validate, and an absent or malformed draft", async () => {
  const root = await newProject();
  assert.equal((await applyDraft(root, "ep-002")).refusal?.reason, "draft-missing");
  await mkdir(join(root, ".toony", "drafts"), { recursive: true });
  await writeFile(draftPath(root, "ep-002"), encodeJson({ draftFormat: 1 }));
  assert.equal((await applyDraft(root, "ep-002")).refusal?.reason, "draft-invalid");

  await draftFor(root, "ep-002");
  const loaded = await loadProject(root);
  const existing = loaded.project.episodes[0];
  assert.ok(existing);
  await writeFile(
    join(episodeDir(root, existing.episode.id), "cuts.yaml"),
    "- id: cut-001\n  panelAspect: '1.4'\n",
  );
  // The reviewed fingerprint no longer matches either, but the invalid project
  // is named first: it is the reason nothing can be written at all.
  const result = await applyDraft(root, "ep-002");
  assert.equal(result.applied, false);
  assert.equal(result.refusal?.reason, "project-invalid");
});

test("an apply interrupted at any rename leaves every reference on disk resolving", async () => {
  const root = await newProject();
  const loaded = await loadProject(root);
  const existing = loaded.project.episodes[0];
  assert.ok(existing);
  const id = existing.episode.id;
  // Extend the scaffold's own episode: every scaffold record kept, new ones added.
  const revision = await writeBrief(root, brief());
  const value = script(id, revision);
  const project = (await loadProject(root)).project;
  const { bundle } = compileEpisodeScript(value, project);
  const merged = {
    episode: {
      ...existing.episode,
      sequence: [...existing.episode.sequence, ...bundle.episode.sequence],
    },
    cuts: [...existing.cuts, ...bundle.cuts],
    transitions: [...existing.transitions, ...bundle.transitions],
    lettering: [...existing.lettering, ...bundle.lettering],
  };
  assert.equal(validateProject(projectWithDraft(project, merged)).valid, true);
  assert.equal(draftConflicts(diffDraft(merged, existing)).length, 0);

  const steps = draftCommitSteps(root, merged);
  assert.deepEqual(
    steps.map((s) => s.file.split("/").pop()),
    ["cuts.yaml", "transitions.yaml", "lettering.json", "episode.yaml"],
  );
  const dangling = new Set([
    "sequence.missing-cut",
    "sequence.missing-transition",
    "overlay.missing-cut",
  ]);
  for (let k = 0; k <= steps.length; k++) {
    const scratch = join(workdir, `window-${k}`);
    const copy = buildInitialProject("demo");
    copy.webtoon.characters = CAST;
    await writeProject(scratch, copy);
    await atomicWriteAll(draftCommitSteps(scratch, merged).slice(0, k));
    const window = await loadProject(scratch);
    const codes = window.validation.issues.map((issue) => issue.code);
    assert.ok(
      codes.every((code) => !dangling.has(code)),
      `window ${k}: ${codes.join(", ")}`,
    );
    // Re-running the whole apply from any window clears every orphan.
    await atomicWriteAll(draftCommitSteps(scratch, merged));
    assert.equal((await loadProject(scratch)).validation.valid, true, `window ${k} after re-run`);
  }
});
