// The agent's memory of a work, so a new agent session can pick up where the
// last one stopped:
//   - `<project>/.toony/agent/memory.json` (0600): remembered notes and the
//     task list, written by the agent's `remember`, `forget` and `update_tasks`;
//   - the change journal Studio's write path keeps beside it;
//   - the recovery brief built from both plus the project itself (at most
//     8 KB), which opens every new native session and answers `get_status`;
//   - the focus line: what the person is looking at, in words.

import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { type LoadedProject, sortEpisodeIds } from "@toony/project-io";
import type { EpisodeBundle, Project } from "@toony/schema";
import type { JournalEntry } from "../ops/index.js";
import { cutNumber } from "../ops/labels.js";
import type { AgentFocus, MemoryNote, TaskItem } from "./protocol.js";
import { privateDir, readPrivateJson, serialized, writePrivateJson } from "./storage.js";

export const MEMORY_FILE = ".toony/agent/memory.json";
export const NOTES_MAX = 100;
export const NOTE_TEXT_MAX = 500;
export const TASKS_MAX = 30;
export const TASK_TITLE_MAX = 200;
export const BRIEF_MAX_BYTES = 8 * 1024;

export interface AgentMemory {
  version: 1;
  notes: MemoryNote[];
  tasks: TaskItem[];
  updatedAt: string;
}

export function emptyMemory(): AgentMemory {
  return { version: 1, notes: [], tasks: [], updatedAt: new Date(0).toISOString() };
}

const NOTE_KINDS: readonly MemoryNote["kind"][] = ["decision", "preference", "note"];
const TASK_STATES: readonly TaskItem["status"][] = ["pending", "in_progress", "done"];

/** Keep only well-formed notes and tasks from a file someone may have edited. */
export function cleanMemory(value: unknown): AgentMemory {
  const memory = emptyMemory();
  if (!value || typeof value !== "object" || Array.isArray(value)) return memory;
  const v = value as Record<string, unknown>;
  if (Array.isArray(v.notes)) {
    for (const raw of v.notes.slice(-NOTES_MAX)) {
      const n = raw as Record<string, unknown>;
      if (
        n &&
        typeof n.id === "string" &&
        /^[A-Za-z0-9-]{1,40}$/.test(n.id) &&
        NOTE_KINDS.includes(n.kind as MemoryNote["kind"]) &&
        typeof n.text === "string" &&
        n.text.trim() &&
        typeof n.at === "string"
      ) {
        memory.notes.push({
          id: n.id,
          kind: n.kind as MemoryNote["kind"],
          text: n.text.slice(0, NOTE_TEXT_MAX),
          at: n.at,
        });
      }
    }
  }
  if (Array.isArray(v.tasks)) {
    for (const raw of v.tasks.slice(0, TASKS_MAX)) {
      const t = raw as Record<string, unknown>;
      if (
        t &&
        typeof t.id === "string" &&
        typeof t.title === "string" &&
        t.title.trim() &&
        TASK_STATES.includes(t.status as TaskItem["status"])
      ) {
        memory.tasks.push({
          id: t.id.slice(0, 40),
          title: t.title.slice(0, TASK_TITLE_MAX),
          status: t.status as TaskItem["status"],
        });
      }
    }
  }
  if (typeof v.updatedAt === "string") memory.updatedAt = v.updatedAt;
  return memory;
}

export async function readMemory(root: string): Promise<AgentMemory> {
  try {
    return cleanMemory(await readPrivateJson(join(root, MEMORY_FILE), 1024 * 1024));
  } catch {
    return emptyMemory();
  }
}

/** Change the memory under a per-project queue and save it atomically. */
export async function updateMemory(
  root: string,
  change: (memory: AgentMemory) => AgentMemory | undefined,
): Promise<AgentMemory> {
  return serialized(`memory:${root}`, async () => {
    const current = await readMemory(root);
    const next = change(structuredClone(current)) ?? current;
    next.updatedAt = new Date().toISOString();
    await privateDir(join(root, ".toony", "agent"));
    await writePrivateJson(join(root, MEMORY_FILE), next);
    return next;
  });
}

export function newNoteId(): string {
  return `n-${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
}

/** Tasks as the agent sent them, with stable ids by position. */
export function normalizeTasks(
  tasks: ReadonlyArray<{ title: string; status: TaskItem["status"] }>,
): TaskItem[] {
  return tasks.slice(0, TASKS_MAX).map((task, index) => ({
    id: `t${index + 1}`,
    title: task.title.trim().slice(0, TASK_TITLE_MAX),
    status: task.status,
  }));
}

// ---------------------------------------------------------------------------
// Labels

/** "Episode 2" or "Episode 2 (The Letter)", numbered by reading order of episodes. */
export function episodeName(project: Project, episodeId: string): string | null {
  const ids = sortEpisodeIds(project.episodes.map((bundle) => bundle.episode.id));
  const index = ids.indexOf(episodeId);
  if (index === -1) return null;
  const bundle = project.episodes.find((b) => b.episode.id === episodeId);
  const number = `Episode ${index + 1}`;
  const title = bundle?.episode.title?.trim();
  return title && title !== number ? `${number} (${title})` : number;
}

function short(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function findBundle(project: Project, episodeId: string): EpisodeBundle | undefined {
  return project.episodes.find((bundle) => bundle.episode.id === episodeId);
}

/** What the person is looking at, in words, for the turn prompt. */
export function focusLine(project: Project | null, focus: AgentFocus | undefined): string {
  if (!focus || focus.route === "library" || project === null) {
    return "The person is in the library.";
  }
  if (focus.route === "settings") return "The person is on the settings page.";
  if (focus.route === "story") return "The person is looking at the story page.";
  if (focus.route === "characters") {
    const character = focus.characterId
      ? project.webtoon.characters?.find((c) => c.id === focus.characterId)
      : undefined;
    return character
      ? `The person is looking at the cast, at ${character.name}.`
      : "The person is looking at the cast.";
  }
  if (!focus.episodeId) return "The person is looking at the episode list.";
  const name = episodeName(project, focus.episodeId);
  if (name === null) return "The person is on a page for a new episode that does not exist yet.";
  const bundle = findBundle(project, focus.episodeId);
  const place =
    focus.route === "preview"
      ? `reading ${name}`
      : focus.route === "export"
        ? `exporting ${name}`
        : `looking at ${name}`;
  const parts = [`The person is ${place}`];
  if (focus.cutId && bundle) {
    const n = cutNumber(bundle, focus.cutId);
    if (n > 0) parts[0] += `, Cut ${n}`;
  }
  if (focus.transitionId && bundle) {
    const sequence = bundle.episode.sequence;
    const index = sequence.findIndex(
      (item) => item.type === "transition" && item.id === focus.transitionId,
    );
    const before = index > 0 ? sequence[index - 1] : undefined;
    if (before?.type === "cut")
      parts[0] += `, the transition after Cut ${cutNumber(bundle, before.id)}`;
  }
  let line = `${parts[0]}.`;
  if (focus.bubbleIds && focus.bubbleIds.length > 0 && bundle) {
    const texts = focus.bubbleIds
      .map((id) => bundle.lettering.find((overlay) => overlay.id === id)?.text)
      .filter((text): text is string => typeof text === "string" && text.trim() !== "")
      .slice(0, 3)
      .map((text) => `"${short(text, 40)}"`);
    line += ` Selected bubbles: ${focus.bubbleIds.length}${texts.length ? ` (${texts.join(", ")})` : ""}.`;
  }
  return line;
}

// ---------------------------------------------------------------------------
// Recovery brief

export interface BriefInput {
  /** The work, or null for a library conversation. */
  project: Project | null;
  /** Works in the workspace, for a library conversation. */
  works?: ReadonlyArray<{ id: string; title: string }>;
  memory: AgentMemory;
  /** Journal entries, oldest first. */
  journal: readonly JournalEntry[];
  /** When this conversation's last turn ended; entries after it are "changed since". */
  since: string | null;
  openQuestions: readonly string[];
  /** Tasks to show (the work's, or the library conversation's). */
  tasks: readonly TaskItem[];
}

function when(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime())
    ? at
    : `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function journalLine(entry: JournalEntry): string {
  const who = entry.actor === "agent" ? "agent" : "person";
  return `- ${when(entry.at)} (${who}) ${short(entry.summary, 160)} [change ${entry.changeId}]`;
}

interface Section {
  title: string;
  lines: string[];
  /** Lower numbers are trimmed first when the brief is too long. */
  keep: number;
  /** Lines kept until every section is down to its minimum. */
  min: number;
}

function sizeOf(sections: readonly Section[]): number {
  return Buffer.byteLength(render(sections));
}

function render(sections: readonly Section[]): string {
  return sections
    .filter((section) => section.lines.length > 0)
    .map((section) =>
      section.title ? `## ${section.title}\n${section.lines.join("\n")}` : section.lines.join("\n"),
    )
    .join("\n\n");
}

function episodeProgress(
  bundle: EpisodeBundle,
  project: Project,
  journal: readonly JournalEntry[],
): string {
  const cuts = bundle.cuts.length;
  const withArt = bundle.cuts.filter((cut) => cut.image?.final || cut.image?.clean).length;
  const bubbles = bundle.lettering.length;
  const last = [...journal]
    .reverse()
    .find((entry) =>
      entry.scopes.some((scope) => "episodeId" in scope && scope.episodeId === bundle.episode.id),
    );
  const name = episodeName(project, bundle.episode.id) ?? bundle.episode.id;
  return `- ${name} [${bundle.episode.id}]: ${cuts} ${cuts === 1 ? "cut" : "cuts"}, ${withArt} with art, ${bubbles} ${bubbles === 1 ? "bubble" : "bubbles"}${last ? `; last change ${when(last.at)}: ${short(last.summary, 80)}` : ""}`;
}

/** The recovery brief: what a fresh agent session needs, at most 8 KB. */
export function recoveryBrief(input: BriefInput): string {
  const sections: Section[] = [];
  const { project } = input;
  if (project === null) {
    const works = input.works ?? [];
    sections.push({
      title: "",
      keep: 100,
      min: 2,
      lines: [
        "# Toony status",
        "This chat is in the library: it is not tied to a webtoon yet. create_work starts a new one, and the chat then belongs to it.",
      ],
    });
    sections.push({
      title: "Webtoons in this workspace",
      keep: 40,
      min: 10,
      lines: works.length
        ? works.slice(0, 40).map((work) => `- ${short(work.title, 80)} [${work.id}]`)
        : ["- None yet."],
    });
  } else {
    const w = project.webtoon;
    const head = [`# ${short(w.title, 120)}`];
    if (w.logline) head.push(`Logline: ${short(w.logline, 300)}`);
    if (w.synopsis) head.push(`Synopsis: ${short(w.synopsis, 700)}`);
    head.push(`Dialogue language: ${w.languages?.dialogueLanguage ?? "en"}`);
    sections.push({ title: "", keep: 100, min: head.length, lines: head });
    const cast = (w.characters ?? []).slice(0, 30).map((c) => {
      const role = c.development?.role ? `: ${short(c.development.role, 60)}` : "";
      const look = c.visualIdentity ?? c.lockstring;
      return `- ${short(c.name, 40)} [${c.id}]${role}${look ? `; ${short(look, 90)}` : ""}`;
    });
    sections.push({
      title: "Cast",
      keep: 70,
      min: 8,
      lines: cast.length ? cast : ["- No characters yet."],
    });
    const ordered = sortEpisodeIds(project.episodes.map((b) => b.episode.id))
      .map((id) => findBundle(project, id))
      .filter((b): b is EpisodeBundle => b !== undefined);
    const episodes = ordered
      .slice(0, 40)
      .map((bundle) => episodeProgress(bundle, project, input.journal));
    if (ordered.length > 40) episodes.push(`- and ${ordered.length - 40} more episodes`);
    sections.push({
      title: "Episodes",
      keep: 80,
      min: 12,
      lines: episodes.length
        ? episodes
        : ["- No episodes yet. create_episode adds one from a script."],
    });
  }
  if (input.tasks.length > 0) {
    const mark = { pending: "[ ]", in_progress: "[>]", done: "[x]" } as const;
    sections.push({
      title: "Your task list",
      keep: 90,
      min: 30,
      lines: input.tasks.map((task) => `- ${mark[task.status]} ${short(task.title, 120)}`),
    });
  }
  if (input.openQuestions.length > 0) {
    sections.push({
      title: "Open question (waiting for the person)",
      keep: 95,
      min: 3,
      lines: input.openQuestions.slice(-3).map((q) => `- ${short(q, 200)}`),
    });
  }
  if (input.memory.notes.length > 0) {
    sections.push({
      title: "Remembered notes",
      keep: 60,
      min: 8,
      lines: input.memory.notes
        .slice(-30)
        .map((n) => `- (${n.kind}) ${short(n.text, 200)} [note ${n.id}]`),
    });
  }
  if (input.since !== null) {
    const since = input.since;
    const changed = input.journal.filter((entry) => entry.at > since);
    sections.push({
      title: "Changed since your last turn",
      keep: 85,
      min: 5,
      lines: changed.length ? changed.slice(-15).map(journalLine) : ["- Nothing."],
    });
  }
  if (input.journal.length > 0) {
    sections.push({
      title: "Recent changes",
      keep: 20,
      min: 3,
      lines: input.journal.slice(-15).map(journalLine),
    });
  }
  // Trim the least important sections line by line until the brief fits.
  while (sizeOf(sections) > BRIEF_MAX_BYTES) {
    const aboveMin = sections.filter((section) => section.lines.length > section.min);
    const candidates = aboveMin.length > 0 ? aboveMin : sections.filter((s) => s.lines.length > 1);
    if (candidates.length === 0) break;
    const victim = candidates.reduce((a, b) => (b.keep < a.keep ? b : a));
    // Drop the oldest entry of a change list, the last entry of other lists.
    if (victim.title === "Recent changes" || victim.title === "Remembered notes")
      victim.lines.splice(0, 1);
    else victim.lines.pop();
  }
  let text = render(sections);
  while (Buffer.byteLength(text) > BRIEF_MAX_BYTES) text = text.slice(0, -256);
  return text;
}

/** Work title for messages, or null. */
export function workTitle(loaded: LoadedProject | null): string | null {
  return loaded?.project.webtoon.title ?? null;
}
