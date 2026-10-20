// The Toony tools the agent calls: hand-written argument checks with messages
// the model can act on, and a happy path for every tool over a fresh
// project through the same write path the person's edits use.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { listWorkspace, loadProject } from "@toony/project-io";
import type { AgentPreferences, ConversationItem, TaskItem } from "../agent/protocol.js";
import * as A from "../agent/tools/args.js";
import { TOOL_CATALOG } from "../agent/tools/catalog.js";
import {
  applyProposal,
  pathNamedByPerson,
  runTool,
  type StoredProposal,
  type ToolHost,
  type ToolResult,
} from "../agent/tools/run.js";
import { readJournal } from "../ops/index.js";

// Named fixture: a real 1x1 PNG.
const PNG_FIXTURE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n5sAAAAASUVORK5CYII=",
  "base64",
);

class FakeHost implements ToolHost {
  readonly conversationId = "11111111-2222-3333-4444-555555555555";
  turnId = "turn-1";
  items: ConversationItem[] = [];
  tasks: TaskItem[] = [];
  proposals: StoredProposal[] = [];
  navigations: string[] = [];
  rebinds: string[] = [];
  undone: string[] = [];
  isWaiting = false;
  prefs: AgentPreferences = {
    provider: "codex",
    model: "",
    autoApply: true,
    viewArtwork: true,
    retainHistory: true,
  };
  constructor(
    readonly workspace: string,
    public work: string | null,
  ) {}
  workId() {
    return this.work;
  }
  preferences() {
    return this.prefs;
  }
  async resolveWork(id: string) {
    const works = await listWorkspace(this.workspace);
    return works.some((w) => w.id === id) ? { id, root: join(this.workspace, id) } : null;
  }
  async listWorks() {
    return (await listWorkspace(this.workspace)).map((w) => ({
      id: w.id,
      title: w.title,
      episodeCount: w.episodeCount,
    }));
  }
  item(item: ConversationItem) {
    const index = this.items.findIndex((i) => i.id === item.id);
    if (index === -1) this.items.push(item);
    else this.items[index] = item;
  }
  changeUndone(changeId: string) {
    this.undone.push(changeId);
  }
  async setTasks(tasks: TaskItem[]) {
    this.tasks = tasks;
  }
  conversationTasks() {
    return this.tasks;
  }
  texts: string[] = [];
  openQuestions() {
    return [];
  }
  userTexts() {
    return this.texts;
  }
  since() {
    return null;
  }
  navigate(href: string) {
    this.navigations.push(href);
  }
  async rebind(workId: string) {
    this.work = workId;
    this.rebinds.push(workId);
  }
  waiting() {
    this.isWaiting = true;
  }
  addProposal(proposal: StoredProposal) {
    this.proposals.push(proposal);
  }
  touch() {}
}

function json(result: ToolResult): Record<string, unknown> {
  assert.equal(result.isError, undefined, JSON.stringify(result.content));
  return JSON.parse(result.content[0]?.text ?? "null");
}

function errorText(result: ToolResult): string {
  assert.equal(result.isError, true, JSON.stringify(result.content));
  return result.content[0]?.text ?? "";
}

async function workspace(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), "toony-tools-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const SCRIPT = {
  beats: [
    {
      purpose: "Mina finds the letter.",
      cuts: [
        {
          intent: "Open on the harbor.",
          scene: "A quiet harbor at dawn, gulls over the water.",
          dialogue: [{ speaker: null, text: "The harbor was quiet that morning." }],
        },
        {
          intent: "Mina sees the letter.",
          scene: "Mina kneels by a wet envelope on the pier.",
          characters: ["mina"],
          dialogue: [{ speaker: "mina", text: "A letter? Out here?" }],
          transitionAfter: { type: "beat" },
        },
        {
          intent: "She reads it.",
          scene: "Close on Mina's face as she reads.",
          characters: ["mina"],
        },
      ],
    },
  ],
};

test("argument checks name the field and what is expected", () => {
  const message = (fn: () => unknown) => {
    try {
      fn();
    } catch (error) {
      assert.ok(error instanceof A.ToolInputError, String(error));
      return error.message;
    }
    assert.fail("expected a refusal");
  };
  assert.match(
    message(() => A.noArgs({ extra: 1 })),
    /Unknown arguments: extra/,
  );
  assert.match(
    message(() => A.episodeArgs({})),
    /episodeId must be an episode id/,
  );
  assert.match(
    message(() => A.episodeArgs({ episodeId: "../x" })),
    /episodeId/,
  );
  assert.match(
    message(() => A.cutArgs({ episodeId: "ep-001", cutId: "a/b" })),
    /cutId/,
  );
  assert.match(
    message(() => A.createWorkArgs({ title: "" })),
    /title must be non-empty/,
  );
  assert.match(
    message(() => A.createWorkArgs({ title: "X", language: "Korean" })),
    /language/,
  );
  assert.match(
    message(() => A.updateStoryArgs({})),
    /at least one of/,
  );
  assert.match(
    message(() => A.updateStoryArgs({ storyGoals: [] })),
    /storyGoals/,
  );
  assert.match(
    message(() => A.saveCharactersArgs({ characters: [] })),
    /at least 1/,
  );
  assert.match(
    message(() => A.saveCharactersArgs({ characters: [{ lockstring: "x" }] })),
    /needs a name/,
  );
  assert.match(
    message(() =>
      A.saveCharactersArgs({ characters: [{ name: "A", development: { mood: "x" } }] }),
    ),
    /development/,
  );
  assert.match(
    message(() => A.createEpisodeArgs({ title: "T" })),
    /script/,
  );
  assert.match(
    message(() => A.createEpisodeArgs({ title: "T", script: { beats: [] } })),
    /script.beats/,
  );
  assert.match(
    message(() =>
      A.createEpisodeArgs({
        title: "T",
        script: { beats: [{ purpose: "p", cuts: [{ intent: "i" }] }] },
      }),
    ),
    /cuts\[0\]\.scene/,
  );
  assert.match(
    message(() =>
      A.createEpisodeArgs({
        title: "T",
        script: {
          beats: [{ purpose: "p", cuts: [{ intent: "i", scene: "s", shotType: "wide" }] }],
        },
      }),
    ),
    /shotType must be one of/,
  );
  assert.match(
    message(() => A.editCutsArgs({ episodeId: "ep-001", operations: [{ op: "zap" }] })),
    /op must be/,
  );
  assert.match(
    message(() =>
      A.editCutsArgs({ episodeId: "ep-001", operations: [{ op: "move", cutId: "cut-001" }] }),
    ),
    /after is required/,
  );
  assert.match(
    message(() =>
      A.setDialogueArgs({ episodeId: "ep-001", cutId: "cut-001", lines: [{ speaker: "a" }] }),
    ),
    /lines\[0\]\.text/,
  );
  assert.match(
    message(() =>
      A.setDialogueArgs({
        episodeId: "ep-001",
        cutId: "cut-001",
        lines: [{ speaker: null, text: "x", kind: "yell" }],
      }),
    ),
    /kind must be one of/,
  );
  assert.match(
    message(() =>
      A.setTransitionsArgs({ episodeId: "ep-001", items: [{ afterCut: "cut-001", type: "wipe" }] }),
    ),
    /type must be one of/,
  );
  assert.match(
    message(() =>
      A.importArtworkArgs({ episodeId: "ep-001", cutId: "cut-001", path: "relative.png" }),
    ),
    /absolute path/,
  );
  assert.match(
    message(() => A.exportArgs({ episodeId: "ep-001", output: "pdf" })),
    /output must be one of/,
  );
  assert.match(
    message(() => A.undoArgs({ changeId: "nope" })),
    /changeId/,
  );
  assert.match(
    message(() => A.tasksArgs({ tasks: [{ title: "x", status: "later" }] })),
    /status/,
  );
  assert.match(
    message(() => A.askArgs({ question: "Q?", options: [{ label: "Only" }] })),
    /at least 2/,
  );
  assert.match(
    message(() => A.askArgs({ question: "Q?", options: [{ label: "A" }, { label: "a" }] })),
    /different/,
  );
  assert.match(
    message(() => A.rememberArgs({ text: "x", kind: "secret" })),
    /kind/,
  );
  assert.match(
    message(() => A.forgetArgs({ noteId: "../x" })),
    /noteId/,
  );
  // Every catalog tool has a schema the model can read.
  for (const tool of TOOL_CATALOG) {
    assert.equal(tool.inputSchema.type, "object", tool.name);
    assert.ok(tool.description.length > 10, tool.name);
  }
});

test("a library chat creates a work, then every tool works on it", async (t) => {
  const dir = await workspace(t);
  const host = new FakeHost(dir, null);

  // Library: only create_work and list_works make sense.
  assert.match(errorText(await runTool(host, "read_story", {})), /not tied to a webtoon/);
  assert.match(errorText(await runTool(host, "nope", {})), /no Toony tool/);
  const status = await runTool(host, "get_status", {});
  assert.match(status.content[0]?.text ?? "", /library/);
  const created = json(
    await runTool(host, "create_work", { title: "Harbor Letters", language: "en" }),
  );
  assert.equal(created.title, "Harbor Letters");
  const workId = String(created.workId);
  assert.deepEqual(host.rebinds, [workId]);
  assert.deepEqual(host.navigations, [`/w/${workId}`]);
  assert.ok(host.items.some((i) => i.kind === "change"));
  assert.match(
    errorText(await runTool(host, "create_work", { title: "Another" })),
    /belongs to a webtoon/,
  );
  assert.deepEqual(
    (json(await runTool(host, "list_works", {})).works as Array<{ id: string }>).map((w) => w.id),
    [workId],
  );

  json(
    await runTool(host, "update_story", {
      logline: "A girl answers letters the sea brings.",
      intent: "A gentle mystery.",
      audience: "Teens",
      world: "A small harbor town",
      storyGoals: ["Warmth", "A quiet twist"],
    }),
  );
  const story = json(await runTool(host, "read_story", {}));
  assert.equal(story.logline, "A girl answers letters the sea brings.");
  assert.equal((story.brief as { world: string }).world, "A small harbor town");

  const cast = json(
    await runTool(host, "save_characters", {
      characters: [
        {
          id: "mina",
          name: "Mina",
          lockstring: "girl, short black hair, yellow raincoat",
          development: {
            role: "lead",
            desire: "answers",
            flaw: "shy",
            voice: "soft",
            arc: "opens up",
          },
        },
        { name: "Old Jo" },
      ],
    }),
  );
  assert.equal((cast.characters as unknown[]).length, 2);
  const characters = json(await runTool(host, "read_characters", {}));
  assert.deepEqual(
    (characters.characters as Array<{ id: string }>).map((c) => c.id),
    ["mina", "old-jo"],
  );
  json(await runTool(host, "remove_character", { characterId: "old-jo" }));

  const episode = json(
    await runTool(host, "create_episode", { title: "The Letter", script: SCRIPT }),
  );
  assert.equal(episode.episodeId, "ep-001");
  assert.deepEqual(episode.cutIds, ["cut-001", "cut-002", "cut-003"]);
  assert.equal(episode.bubbles, 2);
  assert.ok(host.navigations.includes(`/w/${workId}/episodes/ep-001`));
  const done = host.items.find(
    (i) => i.kind === "activity" && i.tool === "create_episode" && i.status === "done",
  );
  assert.ok(
    done && done.kind === "activity" && done.targets?.[0]?.href === `/w/${workId}/episodes/ep-001`,
  );

  const read = json(await runTool(host, "read_episode", { episodeId: "ep-001" }));
  const cuts = read.cuts as Array<{ number: number; dialogue: unknown[]; hasArtwork: boolean }>;
  assert.equal(cuts.length, 3);
  assert.equal(cuts[1]?.dialogue.length, 1);
  assert.equal((read.transitions as Array<{ type: string }>)[0]?.type, "beat");

  // Dialogue on a cut with none is created; on a lettered cut it becomes a proposal.
  const created3 = json(
    await runTool(host, "set_dialogue", {
      episodeId: "ep-001",
      cutId: "cut-003",
      lines: [{ speaker: "Mina", text: "It's addressed to me." }],
    }),
  );
  assert.equal((created3.bubbleIds as unknown[]).length, 1);
  const replaced = json(
    await runTool(host, "set_dialogue", {
      episodeId: "ep-001",
      cutId: "cut-002",
      lines: [{ speaker: "mina", text: "Who left this here?" }],
    }),
  );
  assert.equal(replaced.proposed, true);
  assert.equal(host.isWaiting, true);
  const proposal = host.items.find((i) => i.kind === "proposal");
  assert.ok(proposal && proposal.kind === "proposal" && proposal.preview?.kind === "lettering");
  assert.equal(proposal.preview.before[0]?.text, "A letter? Out here?");

  json(
    await runTool(host, "edit_cuts", {
      episodeId: "ep-001",
      operations: [{ op: "add", after: "cut-003", scene: "Mina runs home." }],
    }),
  );
  json(
    await runTool(host, "set_transitions", {
      episodeId: "ep-001",
      items: [{ afterCut: "cut-001", type: "gutter", gutterHeight: 120 }],
    }),
  );
  const rename = json(
    await runTool(host, "rename_episode", { episodeId: "ep-001", title: "The Wet Letter" }),
  );
  assert.ok(typeof rename.changeId === "string");

  const imagePath = join(dir, "sketch.png");
  await writeFile(imagePath, PNG_FIXTURE);
  assert.match(
    errorText(
      await runTool(host, "import_artwork", {
        episodeId: "ep-001",
        cutId: "cut-001",
        path: imagePath,
      }),
    ),
    /Ask the person for the image file first/,
    "a path the person never wrote is refused",
  );
  host.texts.push(`Please use ${imagePath} for the first cut.`);
  const art = json(
    await runTool(host, "import_artwork", {
      episodeId: "ep-001",
      cutId: "cut-001",
      path: imagePath,
    }),
  );
  assert.match(String(art.image), /^episodes\/ep-001\//);
  assert.ok(!JSON.stringify(art).includes(dir), "no absolute path in a tool result");
  assert.match(
    errorText(
      await runTool(host, "import_artwork", {
        episodeId: "ep-001",
        cutId: "cut-001",
        path: join(dir, "none.png"),
      }),
    ),
    /Ask the person for the image file first/,
  );
  host.texts.push(`The other images are in ${dir} too.`);
  assert.match(
    errorText(
      await runTool(host, "import_artwork", {
        episodeId: "ep-001",
        cutId: "cut-001",
        path: join(dir, "none.png"),
      }),
    ),
    /could not be opened/,
  );

  const view = await runTool(host, "view_cut", { episodeId: "ep-001", cutId: "cut-002" });
  assert.equal(view.isError, undefined, JSON.stringify(view.content));
  const image = view.content.find((c) => c.type === "image");
  assert.equal(image?.mimeType, "image/png");
  const png = Buffer.from(image?.data ?? "", "base64");
  assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
  const meta = JSON.parse(view.content[0]?.text ?? "{}");
  assert.ok(meta.width <= 768 && meta.height <= 768);
  host.prefs = { ...host.prefs, viewArtwork: false };
  const textView = json(await runTool(host, "view_cut", { episodeId: "ep-001", cutId: "cut-002" }));
  assert.match(String(textView.note), /Artwork viewing is off/);
  host.prefs = { ...host.prefs, viewArtwork: true };

  const check = json(await runTool(host, "check_episode", { episodeId: "ep-001" }));
  assert.ok(Array.isArray(check.errors) && Array.isArray(check.warnings));
  assert.equal(check.cutsWithoutArt, 3);

  const exported = json(
    await runTool(host, "export_episode", { episodeId: "ep-001", output: "cuts" }),
  );
  assert.equal((exported.files as unknown[]).length, 4);
  assert.equal(exported.page, `/w/${workId}/episodes/ep-001/export`);
  assert.match(
    errorText(
      await runTool(host, "export_episode", {
        episodeId: "ep-001",
        output: "strip",
        options: { bogus: 1 },
      }),
    ),
    /options/,
  );

  json(
    await runTool(host, "update_tasks", { tasks: [{ title: "Write episode 1", status: "done" }] }),
  );
  assert.deepEqual(host.tasks, [{ id: "t1", title: "Write episode 1", status: "done" }]);
  const note = json(
    await runTool(host, "remember", { text: "Keep the tone gentle.", kind: "preference" }),
  );
  const statusText = (await runTool(host, "get_status", {})).content[0]?.text ?? "";
  assert.match(statusText, /Keep the tone gentle/);
  assert.match(statusText, /The Wet Letter/);
  json(await runTool(host, "forget", { noteId: note.remembered }));
  assert.match(errorText(await runTool(host, "forget", { noteId: "n-missing" })), /no note/);

  host.isWaiting = false;
  const asked = json(
    await runTool(host, "ask_user", {
      question: "Which ending?",
      options: [{ label: "Hopeful" }, { label: "Open" }],
    }),
  );
  assert.equal(asked.asked, true);
  assert.equal(host.isWaiting, true);
  const question = host.items.find((i) => i.kind === "question");
  assert.ok(
    question && question.kind === "question" && question.allowOther && !question.multiSelect,
  );

  // Undo the rename through the agent's own tool.
  json(await runTool(host, "undo_change", { changeId: rename.changeId }));
  assert.deepEqual(host.undone, [rename.changeId]);
  const loaded = await loadProject(join(dir, workId));
  assert.equal(loaded.project.episodes[0]?.episode.title, "The Letter");

  // Every write was journaled as the agent's, with this conversation.
  const journal = await readJournal(join(dir, workId));
  assert.ok(journal.length >= 8);
  assert.ok(
    journal
      .filter((e) => !e.undoes)
      .every((e) => e.actor === "agent" && e.conversationId === host.conversationId),
  );

  // delete_episode, last, and undoable from its change card.
  json(await runTool(host, "delete_episode", { episodeId: "ep-001" }));
  assert.equal((await loadProject(join(dir, workId))).project.episodes.length, 0);
});

test("with changes off, writes become proposals that apply later or go stale", async (t) => {
  const dir = await workspace(t);
  const host = new FakeHost(dir, null);
  const created = json(await runTool(host, "create_work", { title: "Quiet Rooms" }));
  const root = join(dir, String(created.workId));
  json(await runTool(host, "save_characters", { characters: [{ id: "mina", name: "Mina" }] }));
  host.prefs = { ...host.prefs, autoApply: false };

  const proposed = json(await runTool(host, "create_episode", { title: "First", script: SCRIPT }));
  assert.equal(proposed.proposed, true);
  assert.equal((await loadProject(root)).project.episodes.length, 0, "nothing written yet");
  const stored = host.proposals[0];
  assert.ok(stored);
  const applied = await applyProposal(host, stored);
  assert.equal(applied.applied, true);
  assert.equal((await loadProject(root)).project.episodes.length, 1);

  json(
    await runTool(host, "rename_episode", { episodeId: "ep-001", title: "Renamed by proposal" }),
  );
  const rename = host.proposals[1];
  assert.ok(rename);
  // The person edits the same episode before applying: the proposal is stale.
  host.prefs = { ...host.prefs, autoApply: true };
  json(
    await runTool(host, "rename_episode", { episodeId: "ep-001", title: "Renamed by the person" }),
  );
  const outcome = await applyProposal(host, rename);
  assert.equal(outcome.applied, false);
  assert.equal(
    (await loadProject(root)).project.episodes[0]?.episode.title,
    "Renamed by the person",
  );

  // A lettering replacement is always a proposal and refuses when the lettering moved on.
  json(
    await runTool(host, "set_dialogue", {
      episodeId: "ep-001",
      cutId: "cut-002",
      lines: [{ speaker: "mina", text: "Replaced line." }],
    }),
  );
  const replacement = host.proposals.at(-1);
  assert.ok(replacement?.replacement);
  const ok = await applyProposal(host, replacement);
  assert.equal(ok.applied, true);
  const lettering = JSON.parse(
    await readFile(join(root, "episodes/ep-001/lettering.json"), "utf8"),
  );
  assert.ok(JSON.stringify(lettering).includes("Replaced line."));
  const again = await applyProposal(host, replacement);
  assert.equal(again.applied, false);
});

test("artwork import accepts only image paths the person wrote, never hidden ones", () => {
  const home = "/srv/people/writer";
  const said = ["Use ~/Pictures/toony/cut1.png please", "Everything is in /srv/art/episode one"];
  assert.equal(pathNamedByPerson("~/Pictures/toony/cut1.png", said, home), true);
  assert.equal(pathNamedByPerson("/srv/people/writer/Pictures/toony/cut1.png", said, home), true);
  assert.equal(pathNamedByPerson("~/Pictures/toony/cut2.png", said, home), false);
  assert.equal(pathNamedByPerson("/srv/art/episode one/a.png", said, home), true);
  assert.equal(pathNamedByPerson("/srv/art/a.png", said, home), false);
  assert.equal(pathNamedByPerson("/srv/art/b.png", ["See /srv/art/"], home), true);
  assert.equal(pathNamedByPerson("/srv/artwork/b.png", ["See /srv/art"], home), false);
  assert.equal(pathNamedByPerson("~/.ssh/id.png", ["~/.ssh/id.png"], home), false);
  assert.equal(pathNamedByPerson("/srv/art/.cache/b.png", ["/srv/art/.cache"], home), false);
  assert.equal(pathNamedByPerson("/srv/art/notes.txt", ["/srv/art/notes.txt"], home), false);
  assert.equal(pathNamedByPerson("relative/a.png", ["relative/a.png"], home), false);
  assert.equal(pathNamedByPerson("/a.png", ["/a.png"], home), true);
  assert.equal(pathNamedByPerson("/srv/art/b.png", ["See /mnt/srv/art/b.png"], home), false);
  assert.equal(pathNamedByPerson("/srv/art/b.png", ['Use "/srv/art/b.png"'], home), true);
});
