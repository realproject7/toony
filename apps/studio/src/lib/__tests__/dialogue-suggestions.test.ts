// Dialogue suggestions (TXT-01): the agent's suggest_dialogue tool stores a few
// alternatives beside a cut without touching its lettering; the editor reads
// them with flags and a stale mark; inserting one is the person's explicit act.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadProject } from "@toony/project-io";
import { AGENT_RULES } from "../agent/rules.js";
import { runTool, type ToolResult } from "../agent/tools/run.js";
import { newOverlay } from "../new-overlay.js";
import { suggestionOverlay, suggestionReplacePatch } from "../suggestions/insert.js";
import { readCutSuggestions, SUGGESTIONS_DIR } from "../suggestions/store.js";
import { FakeHost } from "./fake-tool-host.js";

const SCRIPT = {
  beats: [
    {
      purpose: "Mina finds the letter.",
      cuts: [
        {
          intent: "Mina sees it.",
          scene: "미나가 편지를 본다.",
          characters: ["mina"],
          dialogue: [{ speaker: "mina", text: "이게 뭐지?" }],
        },
        { intent: "Open on the harbor.", scene: "부두의 새벽." },
      ],
    },
  ],
};

function json(result: ToolResult): Record<string, unknown> {
  assert.equal(result.isError, undefined, JSON.stringify(result.content));
  return JSON.parse(result.content[0]?.text ?? "null");
}

function errorText(result: ToolResult): string {
  assert.equal(result.isError, true, JSON.stringify(result.content));
  return result.content[0]?.text ?? "";
}

async function work(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), "toony-suggest-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const host = new FakeHost(dir, null);
  const created = json(await runTool(host, "create_work", { title: "Letter", language: "ko" }));
  json(
    await runTool(host, "save_characters", {
      characters: [
        { id: "mina", name: "Mina" },
        { id: "joon", name: "Joon" },
      ],
    }),
  );
  json(await runTool(host, "create_episode", { title: "The Letter", script: SCRIPT }));
  return { host, root: join(dir, String(created.workId)) };
}

async function cutOf(root: string, cutId: string) {
  const loaded = await loadProject(root);
  const bundle = loaded.project.episodes[0];
  const cut = bundle?.cuts.find((c) => c.id === cutId);
  assert.ok(bundle && cut);
  return { loaded, bundle, cut, cast: loaded.project.webtoon.characters ?? [] };
}

test("suggest_dialogue stores alternatives beside the cut and never letters it", async (t) => {
  const { host, root } = await work(t);
  const before = await cutOf(root, "cut-001");
  const lettering = JSON.stringify(before.bundle.lettering);
  const result = json(
    await runTool(host, "suggest_dialogue", {
      episodeId: "ep-001",
      cutId: "cut-001",
      options: [
        { kind: "speech", speaker: "mina", text: "누가 놓고 갔지?", note: "curiosity" },
        { kind: "thought", speaker: "joon", text: "그 편지다." },
        { kind: "narration", text: "새벽 다섯 시, 아무도 없는 부두.".repeat(4) },
        { kind: "silent", note: "the art carries it" },
      ],
    }),
  );
  assert.equal(result.suggested, 4);
  assert.equal((result.flagged as unknown[]).length, 2, "the off-cut speaker and the long line");
  const after = await cutOf(root, "cut-001");
  assert.equal(JSON.stringify(after.bundle.lettering), lettering, "lettering is untouched");

  const view = await readCutSuggestions(root, "ep-001", after.cut, after.cast);
  assert.ok(view);
  assert.equal(view.stale, false);
  assert.deepEqual(
    view.options.map((o) => [o.kind, o.speakerName ?? null, o.flags]),
    [
      ["speech", "Mina", []],
      ["thought", "Joon", ["speaker-not-in-cut"]],
      ["narration", null, ["long"]],
      ["silent", null, []],
    ],
  );
  assert.equal(view.options[3]?.text, undefined);
  const row = host.items.filter((item) => item.kind === "activity").at(-1);
  assert.ok(row?.kind === "activity" && row.title === "Suggested lines");

  // New suggestions for the cut replace the earlier ones; a scene change marks them stale.
  json(
    await runTool(host, "suggest_dialogue", {
      episodeId: "ep-001",
      cutId: "cut-001",
      options: [{ kind: "speech", speaker: "mina", text: "편지?" }],
    }),
  );
  json(
    await runTool(host, "edit_cuts", {
      episodeId: "ep-001",
      operations: [{ op: "update", cutId: "cut-001", scene: "미나가 편지를 집어 든다." }],
    }),
  );
  const changed = await cutOf(root, "cut-001");
  const stale = await readCutSuggestions(root, "ep-001", changed.cut, changed.cast);
  assert.equal(stale?.options.length, 1);
  assert.equal(stale?.stale, true);
  assert.equal(
    await readCutSuggestions(root, "ep-001", (await cutOf(root, "cut-002")).cut, []),
    null,
  );
});

test("suggestions refuse unknown speakers and mismatched kinds; a bad file reads as none", async (t) => {
  const { host, root } = await work(t);
  const suggest = (options: unknown[]) =>
    runTool(host, "suggest_dialogue", { episodeId: "ep-001", cutId: "cut-001", options });
  assert.match(
    errorText(await suggest([{ kind: "speech", speaker: "nobody", text: "Hi" }])),
    /not in the cast.*mina, joon/,
  );
  assert.match(
    errorText(await suggest([{ kind: "silent", text: "..." }])),
    /silent option has no text/,
  );
  assert.match(
    errorText(await suggest([{ kind: "narration", speaker: "mina", text: "x" }])),
    /narration has no speaker/,
  );
  assert.match(errorText(await suggest([{ kind: "speech", text: "x" }])), /speaker must be/);
  assert.match(errorText(await suggest([])), /at least 1/);
  assert.match(
    errorText(
      await runTool(host, "suggest_dialogue", {
        episodeId: "ep-001",
        cutId: "cut-404",
        options: [{ kind: "narration", text: "x" }],
      }),
    ),
    /not in the episode/,
  );

  const file = join(root, SUGGESTIONS_DIR, "ep-001.json");
  await mkdir(join(root, SUGGESTIONS_DIR), { recursive: true });
  await writeFile(file, "{not json");
  const { cut, cast } = await cutOf(root, "cut-001");
  assert.equal(await readCutSuggestions(root, "ep-001", cut, cast), null);
  await writeFile(
    file,
    JSON.stringify({
      version: 1,
      episodeId: "ep-001",
      cuts: {
        "cut-001": {
          basis: "x",
          createdAt: "2026-10-20T00:00:00.000Z",
          options: [
            { id: "a", kind: "speech", speaker: "mina", text: `from ${join(root, "secret")}` },
            { id: "b", kind: "shout", text: "unknown kind" },
            { id: "c", kind: "speech", speaker: "mina" },
          ],
        },
      },
    }),
  );
  const view = await readCutSuggestions(root, "ep-001", cut, cast);
  assert.equal(view?.options.length, 1, "only well-formed options are shown");
  assert.ok(!view?.options[0]?.text?.includes(root), "paths are not shown");
  assert.equal(view?.stale, true);
  assert.ok((await readFile(file, "utf8")).length > 0);
});

test("inserting a suggestion is a new bubble of its kind or the selected bubble's text", () => {
  const base = newOverlay("cut-001", 0);
  const narration = suggestionOverlay(base, { id: "n", kind: "narration", text: "x" }, "새벽.");
  assert.equal(narration.kind, "narration");
  assert.equal(narration.text, "새벽.");
  assert.equal(narration.speaker, "");
  const thought = suggestionOverlay(
    base,
    { id: "t", kind: "thought", speaker: "mina" },
    "음.",
    "Mina",
  );
  assert.equal(thought.kind, "thought");
  assert.equal(thought.speaker, "Mina");

  const styled = { ...base, text: "old line", textRanges: [] };
  const patch = suggestionReplacePatch(
    styled,
    { id: "s", kind: "speech", speaker: "joon" },
    "new",
    "Joon",
  );
  assert.deepEqual(patch, { text: "new", textRanges: [], speaker: "Joon" });
  const free = { ...base, kind: "narration" as const };
  assert.deepEqual(
    suggestionReplacePatch(free, { id: "s", kind: "speech", speaker: "joon" }, "new", "Joon"),
    { text: "new", textRanges: [] },
    "a narration box keeps no speaker",
  );
  assert.match(AGENT_RULES, /suggest_dialogue/);
  assert.ok(AGENT_RULES.length < 4096);
});
