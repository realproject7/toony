import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { projectAgentContext, readContextFile } from "../agent/context.js";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "agent-context-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (name: string, value: unknown) => {
    const path = join(root, name);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, JSON.stringify(value));
  };
  await put("webtoon.json", {
    title: "A quiet morning",
    languages: { dialogueLanguage: "ko" },
    imageProviders: { credentials: "TEST_PRIVATE_MARKER" },
    characters: [
      {
        id: "hero",
        name: "Hana",
        lockstring: "short hair",
        references: ["TEST_PRIVATE_MARKER"],
        wardrobe: [{ id: "coat", description: "green coat" }],
      },
    ],
  });
  await put("script/brief.json", {
    intent: "Find an old friend",
    world: "A small town",
    storyGoals: ["Reconciliation"],
    debug: "TEST_PRIVATE_MARKER",
  });
  await put("episodes/ep-1/episode.yaml", {
    id: "ep-1",
    title: "Arrival",
    sequence: [{ type: "cut", id: "cut-1" }],
  });
  await put("episodes/ep-1/cuts.yaml", [
    {
      id: "cut-1",
      characters: ["hero"],
      imagePrompt: "TEST_PRIVATE_MARKER",
      image: { path: "TEST_PRIVATE_MARKER" },
      shotType: "wide",
    },
  ]);
  await put("episodes/ep-1/lettering.json", [
    { id: "b1", cutId: "cut-1", speaker: "hero", text: "안녕" },
    { id: "b2", cutId: "cut-2", text: "unselected dialogue" },
  ]);
  await put("script/episodes/ep-1.json", {
    continuity: { startsFrom: "At the station" },
    beats: [
      {
        id: "beat",
        purpose: "Recognition",
        cuts: [{ id: "cut-1", scene: "A wave", dialogue: [{ speaker: "hero", text: "Welcome" }] }],
      },
    ],
  });
  return { root, put };
}
test("context includes saved authored text but excludes provider data, paths and unselected dialogue", async (t) => {
  const { root } = await fixture(t);
  const raw = await projectAgentContext(root, { episodeId: "ep-1", cutId: "cut-1" });
  for (const expected of ["안녕", "green coat", "Recognition", "At the station", "Welcome"])
    assert.ok(raw.includes(expected), expected);
  assert.ok(!raw.includes("TEST_PRIVATE_MARKER"));
  assert.ok(!raw.includes("unselected dialogue"));
  assert.match(JSON.parse(raw).revision, /^[a-f0-9]{64}$/);
});
test("context revisions change with authored data and reject missing scene selection", async (t) => {
  const { root, put } = await fixture(t);
  const before = await projectAgentContext(root, {});
  await put("script/brief.json", { intent: "A different story" });
  assert.notEqual(
    JSON.parse(before).revision,
    JSON.parse(await projectAgentContext(root, {})).revision,
  );
  await assert.rejects(
    projectAgentContext(root, { episodeId: "ep-1", cutId: "missing" }),
    /no longer available/,
  );
});
test("project context rejects symlinked files and directories before reading", async (t) => {
  const { root } = await fixture(t);
  await symlink(join(root, "webtoon.json"), join(root, "link.json"));
  await assert.rejects(readContextFile(root, "link.json"), /safely/);
  await symlink(join(root, "episodes"), join(root, "linked"));
  await assert.rejects(readContextFile(root, "linked/ep-1/cuts.yaml"), /safely/);
  await assert.rejects(readContextFile(root, "../outside.json"), /safely/);
});
test("context reads have byte limits and optional absence does not mask invalid files", async (t) => {
  const { root } = await fixture(t);
  assert.equal(await readContextFile(root, "missing.json", true), null);
  await writeFile(join(root, "large.json"), "x".repeat(2_000_001));
  await assert.rejects(readContextFile(root, "large.json", true), /safely/);
  await assert.rejects(readContextFile(root, "episodes", true), /safely/);
});
