// Running a Toony tool for the agent. Every call:
//   1. shows an activity row in the panel (running, then done or failed);
//   2. checks its arguments by hand (`args.ts`);
//   3. reads the project, or writes it through lib/ops (actor "agent", the
//      conversation id attached) so the change is journaled, undoable and
//      published like any other;
//   4. answers the model with concise JSON text (titles where possible, the
//      ids it needs, never an absolute path).
// With "Let the agent make changes without asking" off, a write becomes a
// proposal card instead; replacing existing lettering is always a proposal.

import { constants } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { composeCut, encodeCanvas } from "@toony/export";
import { lintBubbleOverflow, lintCraft, lintPanelShape } from "@toony/lint";
import {
  type LoadedProject,
  loadProject,
  readBrief,
  readStoryBible,
  sortEpisodeIds,
} from "@toony/project-io";
import { type EpisodeBundle, parseExportOptions } from "@toony/schema";
import { getExportJob, startExportJob } from "../../export-jobs.js";
import { scopesOverlap } from "../../live/scope.js";
import {
  ARTWORK_BYTES_MAX,
  applyDialogueReplacement,
  contextFor,
  createEpisode,
  createWork,
  type DialogueReplacement,
  deleteEpisode,
  editCuts,
  importArtwork,
  type JournalEntry,
  type OpContext,
  readJournal,
  removeCharacter,
  renameEpisode,
  renameWork,
  setDialogue,
  setTransitions,
  undoChange,
  updateStory,
  upsertCharacters,
} from "../../ops/index.js";
import { cutNumber } from "../../ops/labels.js";
import { projectPath } from "../../ops/paths.js";
import {
  episodeName,
  newNoteId,
  normalizeTasks,
  readMemory,
  recoveryBrief,
  updateMemory,
} from "../memory.js";
import type {
  AgentPreferences,
  AgentTarget,
  ChangeScope,
  ConversationItem,
  ExportJobView,
  ProjectChange,
  ProposalPreview,
  TaskItem,
} from "../protocol.js";
import * as A from "./args.js";
import { ToolInputError } from "./args.js";
import { type ToolSpec, toolSpec } from "./catalog.js";

export interface ToolContent {
  type: "text" | "image";
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

/** A write the person approves later: everything needed to run it then. */
export interface StoredProposal {
  proposalId: string;
  turnId: string;
  tool: string;
  args: unknown;
  workId: string | null;
  scopes: ChangeScope[];
  /** The newest journal change id when the proposal was made. */
  journalHead: string | null;
  replacement?: DialogueReplacement;
}

export interface ResolvedWorkRef {
  id: string;
  root: string;
}

/** What a running turn offers its tools. The agent runtime implements it. */
export interface ToolHost {
  readonly workspace: string;
  readonly conversationId: string;
  readonly turnId: string;
  workId(): string | null;
  preferences(): AgentPreferences;
  resolveWork(id: string): Promise<ResolvedWorkRef | null>;
  listWorks(): Promise<Array<{ id: string; title: string; episodeCount: number }>>;
  /** Append a conversation item, or replace the one with the same id. */
  item(item: ConversationItem): void;
  /** Mark an earlier change item of this conversation as undone. */
  changeUndone(changeId: string): void;
  setTasks(tasks: TaskItem[]): Promise<void>;
  /** Tasks of a library conversation (a work's tasks live in its memory). */
  conversationTasks(): TaskItem[];
  /** Questions of this conversation still waiting for an answer. */
  openQuestions(): string[];
  /** When this conversation's previous turn ended. */
  since(): string | null;
  navigate(href: string, reason: "work-created" | "episode-created"): void;
  rebind(workId: string): Promise<void>;
  /** The turn ends in "waiting" (a question or a proposal is open). */
  waiting(): void;
  addProposal(proposal: StoredProposal): void;
  /** Keep the turn alive while a long tool runs. */
  touch(): void;
}

// ---------------------------------------------------------------------------
// Small helpers

let counter = 0;
export function itemId(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}-${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

const now = () => new Date().toISOString();

function textResult(value: unknown, isError = false): ToolResult {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
    ...(isError ? { isError: true } : {}),
  };
}

/** A refusal with a readable message: ops errors, argument errors. */
function readableError(error: unknown): string | null {
  if (error instanceof ToolInputError) return error.message;
  if (
    error instanceof Error &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { status?: unknown }).status === "number"
  ) {
    return error.message;
  }
  if (error instanceof Error && error.name === "ExportJobError") return error.message;
  return null;
}

const enc = encodeURIComponent;

export function workHref(workId: string): string {
  return `/w/${enc(workId)}`;
}
export function episodeHref(workId: string, episodeId: string): string {
  return `/w/${enc(workId)}/episodes/${enc(episodeId)}`;
}
export function cutHref(workId: string, episodeId: string, cutId: string): string {
  return `${episodeHref(workId, episodeId)}?item=${enc(`cut:${cutId}`)}`;
}

function workTarget(workId: string, label: string): AgentTarget {
  return { type: "work", workId, label, href: workHref(workId) };
}
function storyTarget(workId: string): AgentTarget {
  return { type: "story", workId, label: "Story", href: workHref(workId) };
}
function castTarget(workId: string): AgentTarget {
  return {
    type: "characters",
    workId,
    label: "Characters",
    href: `${workHref(workId)}/characters`,
  };
}
function episodeTarget(workId: string, episodeId: string, label: string): AgentTarget {
  return { type: "episode", workId, episodeId, label, href: episodeHref(workId, episodeId) };
}
function cutTarget(workId: string, episodeId: string, cutId: string, label: string): AgentTarget {
  return { type: "cut", workId, episodeId, cutId, label, href: cutHref(workId, episodeId, cutId) };
}
function exportTarget(workId: string, episodeId: string, label: string): AgentTarget {
  return {
    type: "export",
    workId,
    episodeId,
    label,
    href: `${episodeHref(workId, episodeId)}/export`,
  };
}

function findBundle(loaded: LoadedProject, episodeId: string): EpisodeBundle | undefined {
  return loaded.project.episodes.find((bundle) => bundle.episode.id === episodeId);
}

function epLabel(loaded: LoadedProject | null, episodeId: string): string {
  return (loaded && episodeName(loaded.project, episodeId)) ?? "the episode";
}

function cutLabelOf(loaded: LoadedProject | null, episodeId: string, cutId: string): string {
  const bundle = loaded ? findBundle(loaded, episodeId) : undefined;
  const n = cutNumber(bundle, cutId);
  return `${n > 0 ? `Cut ${n}` : "A cut"} of ${epLabel(loaded, episodeId)}`;
}

async function load(root: string): Promise<LoadedProject | null> {
  try {
    return await loadProject(root);
  } catch {
    return null;
  }
}

function clip(text: string | undefined | null, max: number): string | undefined {
  if (typeof text !== "string") return undefined;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// ---------------------------------------------------------------------------
// Work context

async function requireWork(host: ToolHost): Promise<ResolvedWorkRef> {
  const workId = host.workId();
  if (workId === null) {
    throw new ToolInputError(
      "This chat is not tied to a webtoon yet. Create one with create_work, or ask the person to open a webtoon.",
    );
  }
  const work = await host.resolveWork(workId);
  if (work === null) throw new ToolInputError("This chat's webtoon is no longer in the workspace.");
  return work;
}

function opContext(host: ToolHost, work: ResolvedWorkRef): OpContext {
  return contextFor(work.root, {
    actor: "agent",
    conversationId: host.conversationId,
    workId: work.id,
  });
}

// ---------------------------------------------------------------------------
// Writes: a description (for proposals) and a perform step

interface Performed {
  /** JSON for the model. */
  result: Record<string, unknown>;
  changes: Array<ProjectChange | null>;
  targets: AgentTarget[];
  detail?: string;
  /** A lettering replacement that must become a proposal. */
  replacement?: { replacement: DialogueReplacement; title: string; targets: AgentTarget[] };
}

interface Described {
  title: string;
  summary: string;
  preview?: ProposalPreview;
  targets: AgentTarget[];
  scopes: ChangeScope[];
}

interface WriteTool {
  parse: (raw: unknown) => unknown;
  /** Library chats may only run create_work. */
  library?: boolean;
  describe: (host: ToolHost, args: never) => Promise<Described>;
  perform: (host: ToolHost, args: never) => Promise<Performed>;
}

function changeIds(changes: ReadonlyArray<ProjectChange | null>): string[] {
  return changes.filter((c): c is ProjectChange => c !== null).map((c) => c.changeId);
}

const WRITES: Record<string, WriteTool> = {
  create_work: {
    parse: A.createWorkArgs,
    library: true,
    describe: async (_host, args: ReturnType<typeof A.createWorkArgs>) => ({
      title: "Create a webtoon",
      summary: `Create "${args.title}"`,
      ...(args.logline ? { preview: { kind: "text", text: args.logline } } : {}),
      targets: [],
      scopes: [{ kind: "work" }],
    }),
    perform: async (host, args: ReturnType<typeof A.createWorkArgs>) => {
      if (host.workId() !== null) {
        throw new ToolInputError(
          "This chat belongs to a webtoon already. The person can start a new webtoon from the library.",
        );
      }
      const created = await createWork(host.workspace, args.title, {
        ...(args.logline ? { logline: args.logline } : {}),
        ...(args.language ? { language: args.language } : {}),
        info: { actor: "agent", conversationId: host.conversationId },
      });
      await host.rebind(created.workId);
      host.navigate(workHref(created.workId), "work-created");
      return {
        result: {
          workId: created.workId,
          title: created.title,
          episodes: 0,
          note: "This chat now belongs to the new webtoon. It has no episodes yet.",
        },
        changes: [{ ...created.change, undoable: false }],
        targets: [workTarget(created.workId, created.title)],
        detail: created.title,
      };
    },
  },
  update_story: {
    parse: A.updateStoryArgs,
    describe: async (host, args: ReturnType<typeof A.updateStoryArgs>) => {
      const work = await requireWork(host);
      const fields = [...(args.title ? ["title"] : []), ...Object.keys(args.patch)];
      return {
        title: "Update the story",
        summary: `Change ${fields.join(", ")}`,
        preview: {
          kind: "text",
          text:
            clip(
              args.title ??
                args.patch.logline ??
                args.patch.synopsis ??
                args.patch.intent ??
                args.patch.storyBible ??
                "",
              600,
            ) ?? "",
        },
        targets: [storyTarget(work.id)],
        scopes: [{ kind: "story" }, ...(args.title ? [{ kind: "work" } as ChangeScope] : [])],
      };
    },
    perform: async (host, args: ReturnType<typeof A.updateStoryArgs>) => {
      const work = await requireWork(host);
      const ctx = opContext(host, work);
      const changes: Array<ProjectChange | null> = [];
      if (args.title) changes.push(await renameWork(ctx, args.title));
      if (Object.keys(args.patch).length > 0) changes.push(await updateStory(ctx, args.patch));
      const ids = changeIds(changes);
      return {
        result: { updated: ids.length > 0, changeIds: ids },
        changes,
        targets: [storyTarget(work.id)],
        detail: ids.length > 0 ? undefined : "Nothing changed",
      };
    },
  },
  save_characters: {
    parse: A.saveCharactersArgs,
    describe: async (host, args: ReturnType<typeof A.saveCharactersArgs>) => {
      const work = await requireWork(host);
      const names = args.characters.map((c) => c.name ?? c.id ?? "a character");
      return {
        title: "Update the cast",
        summary: `Save ${names.join(", ")}`,
        preview: {
          kind: "text",
          text: args.characters
            .map(
              (c) =>
                `${c.name ?? c.id}: ${c.lockstring ?? c.visualIdentity ?? c.development?.role ?? ""}`,
            )
            .join("\n"),
        },
        targets: [castTarget(work.id)],
        scopes: [{ kind: "characters" }],
      };
    },
    perform: async (host, args: ReturnType<typeof A.saveCharactersArgs>) => {
      const work = await requireWork(host);
      const { characters, change } = await upsertCharacters(opContext(host, work), args.characters);
      return {
        result: { characters, changeId: change?.changeId ?? null },
        changes: [change],
        targets: [castTarget(work.id)],
        detail: characters.map((c) => c.name).join(", "),
      };
    },
  },
  remove_character: {
    parse: A.removeCharacterArgs,
    describe: async (host, args: ReturnType<typeof A.removeCharacterArgs>) => {
      const work = await requireWork(host);
      const loaded = await load(work.root);
      const name =
        loaded?.project.webtoon.characters?.find((c) => c.id === args.characterId)?.name ??
        args.characterId;
      return {
        title: "Remove a character",
        summary: `Remove ${name} from the cast`,
        targets: [castTarget(work.id)],
        scopes: [{ kind: "characters" }],
      };
    },
    perform: async (host, args: ReturnType<typeof A.removeCharacterArgs>) => {
      const work = await requireWork(host);
      const change = await removeCharacter(opContext(host, work), args.characterId);
      return {
        result: { removed: args.characterId, changeId: change?.changeId ?? null },
        changes: [change],
        targets: [castTarget(work.id)],
      };
    },
  },
  create_episode: {
    parse: A.createEpisodeArgs,
    describe: async (host, args: ReturnType<typeof A.createEpisodeArgs>) => {
      const work = await requireWork(host);
      const cuts = args.script.beats.reduce((n, beat) => n + beat.cuts.length, 0);
      return {
        title: "Create an episode",
        summary: `Create "${args.title}" with ${cuts} ${cuts === 1 ? "cut" : "cuts"}`,
        preview: {
          kind: "text",
          text: args.script.beats
            .flatMap((beat) => beat.cuts.map((cut) => `- ${clip(cut.scene, 140)}`))
            .slice(0, 30)
            .join("\n"),
        },
        targets: [workTarget(work.id, "Episodes")],
        scopes: [{ kind: "episodes" }],
      };
    },
    perform: async (host, args: ReturnType<typeof A.createEpisodeArgs>) => {
      const work = await requireWork(host);
      const created = await createEpisode(opContext(host, work), {
        title: args.title,
        script: args.script,
      });
      const loaded = await load(work.root);
      const label = epLabel(loaded, created.episodeId);
      host.navigate(episodeHref(work.id, created.episodeId), "episode-created");
      const lettered = loaded
        ? (findBundle(loaded, created.episodeId)?.lettering.length ?? 0)
        : undefined;
      return {
        result: {
          episodeId: created.episodeId,
          title: created.title,
          episode: label,
          cutIds: created.cutIds,
          bubbles: lettered,
          notes: created.notes.slice(0, 12),
          changeId: created.change?.changeId ?? null,
        },
        changes: [created.change],
        targets: [episodeTarget(work.id, created.episodeId, label)],
        detail: `${label} · ${created.cutIds.length} ${created.cutIds.length === 1 ? "cut" : "cuts"}`,
      };
    },
  },
  rename_episode: {
    parse: A.renameEpisodeArgs,
    describe: async (host, args: ReturnType<typeof A.renameEpisodeArgs>) => {
      const work = await requireWork(host);
      const loaded = await load(work.root);
      return {
        title: "Rename an episode",
        summary: `Rename ${epLabel(loaded, args.episodeId)} to "${args.title}"`,
        targets: [episodeTarget(work.id, args.episodeId, epLabel(loaded, args.episodeId))],
        scopes: [{ kind: "episode", episodeId: args.episodeId }],
      };
    },
    perform: async (host, args: ReturnType<typeof A.renameEpisodeArgs>) => {
      const work = await requireWork(host);
      const change = await renameEpisode(opContext(host, work), args.episodeId, args.title);
      const loaded = await load(work.root);
      const label = epLabel(loaded, args.episodeId);
      return {
        result: {
          episodeId: args.episodeId,
          title: args.title,
          changeId: change?.changeId ?? null,
        },
        changes: [change],
        targets: [episodeTarget(work.id, args.episodeId, label)],
      };
    },
  },
  delete_episode: {
    parse: A.episodeArgs,
    describe: async (host, args: ReturnType<typeof A.episodeArgs>) => {
      const work = await requireWork(host);
      const loaded = await load(work.root);
      return {
        title: "Delete an episode",
        summary: `Delete ${epLabel(loaded, args.episodeId)} with its cuts and lettering`,
        targets: [workTarget(work.id, "Episodes")],
        scopes: [{ kind: "episodes" }, { kind: "episode", episodeId: args.episodeId }],
      };
    },
    perform: async (host, args: ReturnType<typeof A.episodeArgs>) => {
      const work = await requireWork(host);
      const before = await load(work.root);
      const label = epLabel(before, args.episodeId);
      const change = await deleteEpisode(opContext(host, work), args.episodeId);
      return {
        result: { deleted: args.episodeId, changeId: change?.changeId ?? null },
        changes: [change],
        targets: [workTarget(work.id, "Episodes")],
        detail: label,
      };
    },
  },
  edit_cuts: {
    parse: A.editCutsArgs,
    describe: async (host, args: ReturnType<typeof A.editCutsArgs>) => {
      const work = await requireWork(host);
      const loaded = await load(work.root);
      const label = epLabel(loaded, args.episodeId);
      const counts = args.operations.reduce<Record<string, number>>((acc, op) => {
        acc[op.op] = (acc[op.op] ?? 0) + 1;
        return acc;
      }, {});
      const words = Object.entries(counts).map(([op, n]) => `${op} ${n}`);
      return {
        title: "Edit cuts",
        summary: `${label}: ${words.join(", ")}`,
        preview: {
          kind: "text",
          text: args.operations
            .map((op) =>
              op.op === "add"
                ? `Add a cut: ${clip(op.scene ?? "", 120)}`
                : op.op === "update"
                  ? `Update ${cutLabelOf(loaded, args.episodeId, op.cutId)}${op.scene ? `: ${clip(op.scene, 120)}` : ""}`
                  : op.op === "remove"
                    ? `Remove ${cutLabelOf(loaded, args.episodeId, op.cutId)}`
                    : `Move ${cutLabelOf(loaded, args.episodeId, op.cutId)}`,
            )
            .join("\n"),
        },
        targets: [episodeTarget(work.id, args.episodeId, label)],
        scopes: [{ kind: "episode", episodeId: args.episodeId }],
      };
    },
    perform: async (host, args: ReturnType<typeof A.editCutsArgs>) => {
      const work = await requireWork(host);
      const edited = await editCuts(opContext(host, work), args.episodeId, args.operations);
      const loaded = await load(work.root);
      const label = epLabel(loaded, args.episodeId);
      return {
        result: {
          cuts: edited.cuts,
          added: edited.added,
          removed: edited.removed,
          changeId: edited.change?.changeId ?? null,
        },
        changes: [edited.change],
        targets: [episodeTarget(work.id, args.episodeId, label)],
        detail: `${label} · ${edited.cuts.length} cuts`,
      };
    },
  },
  set_dialogue: {
    parse: A.setDialogueArgs,
    describe: async (host, args: ReturnType<typeof A.setDialogueArgs>) => {
      const work = await requireWork(host);
      const loaded = await load(work.root);
      const label = cutLabelOf(loaded, args.episodeId, args.cutId);
      const names = new Map((loaded?.project.webtoon.characters ?? []).map((c) => [c.id, c.name]));
      return {
        title: "Letter a cut",
        summary: `Add ${args.lines.length} ${args.lines.length === 1 ? "line" : "lines"} to ${label}`,
        preview: {
          kind: "lettering",
          before: [],
          after: args.lines.map((line) => ({
            speaker: line.speaker === null ? "" : (names.get(line.speaker) ?? line.speaker),
            text: line.text,
          })),
        },
        targets: [cutTarget(work.id, args.episodeId, args.cutId, label)],
        scopes: [{ kind: "lettering", episodeId: args.episodeId, cutId: args.cutId }],
      };
    },
    perform: async (host, args: ReturnType<typeof A.setDialogueArgs>) => {
      const work = await requireWork(host);
      const outcome = await setDialogue(
        opContext(host, work),
        args.episodeId,
        args.cutId,
        args.lines,
      );
      const loaded = await load(work.root);
      const label = cutLabelOf(loaded, args.episodeId, args.cutId);
      const targets = [cutTarget(work.id, args.episodeId, args.cutId, label)];
      if (outcome.mode === "replacement") {
        return {
          result: {},
          changes: [],
          targets,
          replacement: { replacement: outcome.replacement, title: label, targets },
        };
      }
      return {
        result: { bubbleIds: outcome.overlayIds, changeId: outcome.change?.changeId ?? null },
        changes: [outcome.change],
        targets,
        detail: `${label} · ${outcome.overlayIds.length} ${outcome.overlayIds.length === 1 ? "bubble" : "bubbles"}`,
      };
    },
  },
  set_transitions: {
    parse: A.setTransitionsArgs,
    describe: async (host, args: ReturnType<typeof A.setTransitionsArgs>) => {
      const work = await requireWork(host);
      const loaded = await load(work.root);
      const label = epLabel(loaded, args.episodeId);
      return {
        title: "Set transitions",
        summary: `${label}: ${args.items.length} ${args.items.length === 1 ? "transition" : "transitions"}`,
        preview: {
          kind: "text",
          text: args.items
            .map(
              (item) =>
                `After ${cutLabelOf(loaded, args.episodeId, item.afterCut).replace(/ of .*$/, "")}: ${item.type}`,
            )
            .join("\n"),
        },
        targets: [episodeTarget(work.id, args.episodeId, label)],
        scopes: [{ kind: "sequence", episodeId: args.episodeId }],
      };
    },
    perform: async (host, args: ReturnType<typeof A.setTransitionsArgs>) => {
      const work = await requireWork(host);
      const change = await setTransitions(opContext(host, work), args.episodeId, args.items);
      const loaded = await load(work.root);
      const label = epLabel(loaded, args.episodeId);
      return {
        result: { changeId: change?.changeId ?? null },
        changes: [change],
        targets: [episodeTarget(work.id, args.episodeId, label)],
      };
    },
  },
  import_artwork: {
    parse: A.importArtworkArgs,
    describe: async (host, args: ReturnType<typeof A.importArtworkArgs>) => {
      const work = await requireWork(host);
      const loaded = await load(work.root);
      const label = cutLabelOf(loaded, args.episodeId, args.cutId);
      return {
        title: "Add artwork",
        summary: `Use an image file as the artwork of ${label}`,
        targets: [cutTarget(work.id, args.episodeId, args.cutId, label)],
        scopes: [{ kind: "artwork", episodeId: args.episodeId, cutId: args.cutId }],
      };
    },
    perform: async (host, args: ReturnType<typeof A.importArtworkArgs>) => {
      const work = await requireWork(host);
      const bytes = await readImageFile(args.path);
      const imported = await importArtwork(
        opContext(host, work),
        args.episodeId,
        args.cutId,
        bytes,
      );
      const loaded = await load(work.root);
      const label = cutLabelOf(loaded, args.episodeId, args.cutId);
      return {
        result: {
          image: imported.image,
          slot: imported.slot,
          changeId: imported.change?.changeId ?? null,
        },
        changes: [imported.change],
        targets: [cutTarget(work.id, args.episodeId, args.cutId, label)],
        detail: label,
      };
    },
  },
  export_episode: {
    parse: A.exportArgs,
    describe: async (host, args: ReturnType<typeof A.exportArgs>) => {
      const work = await requireWork(host);
      const loaded = await load(work.root);
      const label = epLabel(loaded, args.episodeId);
      return {
        title: "Export an episode",
        summary: `Export ${label} as ${args.output}`,
        targets: [exportTarget(work.id, args.episodeId, `Export ${label}`)],
        scopes: [{ kind: "export", episodeId: args.episodeId }],
      };
    },
    perform: async (host, args: ReturnType<typeof A.exportArgs>) => runExport(host, args),
  },
  undo_change: {
    parse: A.undoArgs,
    describe: async (host, args: ReturnType<typeof A.undoArgs>) => {
      const work = await requireWork(host);
      const journal = await readJournal(work.root, 500);
      const entry = journal.find((e) => e.changeId === args.changeId);
      return {
        title: "Undo a change",
        summary: entry ? `Undo: ${entry.summary}` : "Undo an earlier change",
        targets: [workTarget(work.id, "Webtoon")],
        scopes: entry?.scopes ?? [{ kind: "work" }],
      };
    },
    perform: async (host, args: ReturnType<typeof A.undoArgs>) => {
      const work = await requireWork(host);
      const change = await undoChange(opContext(host, work), args.changeId);
      host.changeUndone(args.changeId);
      return {
        result: { undone: args.changeId, summary: change.summary, changeId: change.changeId },
        changes: [],
        targets: [workTarget(work.id, "Webtoon")],
        detail: change.summary,
      };
    },
  },
};

async function readImageFile(path: string): Promise<Uint8Array> {
  const absolute = path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new ToolInputError(
      "That image file could not be opened. Check the path with the person.",
    );
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new ToolInputError("That path is not an image file.");
    if (info.size > ARTWORK_BYTES_MAX) throw new ToolInputError("Images can be up to 30 MB.");
    return new Uint8Array(await handle.readFile());
  } finally {
    await handle.close();
  }
}

const EXPORT_WAIT_MS = 5 * 60_000;

async function runExport(
  host: ToolHost,
  args: ReturnType<typeof A.exportArgs>,
): Promise<Performed> {
  const work = await requireWork(host);
  const parsed = parseExportOptions(args.options);
  if (parsed.problems.length > 0) {
    throw new ToolInputError(`options: ${parsed.problems.map((p) => p.message).join("; ")}.`);
  }
  const loaded = await load(work.root);
  if (loaded && !findBundle(loaded, args.episodeId))
    throw new ToolInputError("This episode does not exist.");
  const label = epLabel(loaded, args.episodeId);
  const activityId = itemId("act");
  const progress = (view: ExportJobView) => {
    host.touch();
    if (view.state === "running" && view.progress.total > 0) {
      host.item({
        kind: "activity",
        id: activityId,
        at: now(),
        turnId: host.turnId,
        tool: "export_progress",
        title: `Exporting ${label}`,
        status: "running",
        detail: `${view.progress.done} of ${view.progress.total}`,
      });
    }
  };
  const started = await startExportJob(
    {
      workId: work.id,
      workRoot: work.root,
      episodeId: args.episodeId,
      output: args.output,
      options: parsed.options,
    },
    progress,
  );
  const deadline = Date.now() + EXPORT_WAIT_MS;
  let view: ExportJobView | null = started;
  while (view && view.state !== "completed" && view.state !== "failed" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    host.touch();
    view = getExportJob(started.id);
  }
  const target = exportTarget(work.id, args.episodeId, `Export ${label}`);
  if (view === null || (view.state !== "completed" && view.state !== "failed")) {
    host.item({
      kind: "activity",
      id: activityId,
      at: now(),
      turnId: host.turnId,
      tool: "export_progress",
      title: `Exporting ${label}`,
      status: "running",
      detail: "Still running on the export page",
      targets: [target],
    });
    return {
      result: {
        state: "running",
        note: "The export is still running. The person can follow it on the export page.",
      },
      changes: [],
      targets: [target],
    };
  }
  if (view.state === "failed") {
    throw new ToolInputError(view.message ?? "The export failed.");
  }
  // The progress row is replaced by the tool's own done row.
  host.item({
    kind: "activity",
    id: activityId,
    at: now(),
    turnId: host.turnId,
    tool: "export_progress",
    title: `Exported ${label}`,
    status: "done",
    detail: `${view.files?.length ?? 0} files`,
    targets: [target],
  });
  return {
    result: {
      output: view.output,
      files: (view.files ?? []).slice(0, 60).map((file) => ({
        name: file.name,
        width: file.width,
        height: file.height,
        bytes: file.bytes,
      })),
      warnings: (view.warnings ?? []).map((warning) => warning.message),
      page: target.href,
    },
    changes: [],
    targets: [target],
    detail: `${view.files?.length ?? 0} files`,
  };
}

// ---------------------------------------------------------------------------
// Reads

async function getStatus(host: ToolHost): Promise<string> {
  const workId = host.workId();
  if (workId === null) {
    const works = await host.listWorks();
    return recoveryBrief({
      project: null,
      works,
      memory: { version: 1, notes: [], tasks: [], updatedAt: now() },
      journal: [],
      since: host.since(),
      openQuestions: host.openQuestions(),
      tasks: host.conversationTasks(),
    });
  }
  const work = await requireWork(host);
  const [loaded, memory, journal] = await Promise.all([
    loadProject(work.root),
    readMemory(work.root),
    readJournal(work.root, 200),
  ]);
  return recoveryBrief({
    project: loaded.project,
    memory,
    journal,
    since: host.since(),
    openQuestions: host.openQuestions(),
    tasks: memory.tasks,
  });
}

async function readStory(host: ToolHost): Promise<Record<string, unknown>> {
  const work = await requireWork(host);
  const loaded = await loadProject(work.root);
  const w = loaded.project.webtoon;
  const brief = await readBrief(work.root).catch(() => null);
  const bible = await readStoryBible(work.root).catch(() => "");
  return {
    title: w.title,
    logline: w.logline ?? null,
    synopsis: w.synopsis ?? null,
    dialogueLanguage: w.languages?.dialogueLanguage ?? "en",
    brief: brief?.brief
      ? {
          intent: brief.brief.intent,
          audience: brief.brief.audience,
          world: brief.brief.world,
          storyGoals: brief.brief.storyGoals,
          contentConstraints: brief.brief.contentConstraints ?? [],
        }
      : null,
    storyBible: clip(bible, 20_000) ?? "",
  };
}

async function readCharacters(host: ToolHost): Promise<Record<string, unknown>> {
  const work = await requireWork(host);
  const loaded = await loadProject(work.root);
  return {
    characters: (loaded.project.webtoon.characters ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      lockstring: c.lockstring,
      ...(c.visualIdentity ? { visualIdentity: clip(c.visualIdentity, 1500) } : {}),
      ...(c.development ? { development: c.development } : {}),
      ...(c.wardrobe ? { wardrobe: c.wardrobe } : {}),
    })),
  };
}

function orderedCuts(bundle: EpisodeBundle): string[] {
  const ids = bundle.episode.sequence.filter((item) => item.type === "cut").map((item) => item.id);
  return ids.length > 0 ? ids : bundle.cuts.map((cut) => cut.id);
}

async function readEpisode(host: ToolHost, episodeId: string): Promise<Record<string, unknown>> {
  const work = await requireWork(host);
  const loaded = await loadProject(work.root);
  const bundle = findBundle(loaded, episodeId);
  if (!bundle)
    throw new ToolInputError("This episode does not exist. get_status lists the episodes.");
  const names = new Map((loaded.project.webtoon.characters ?? []).map((c) => [c.id, c.name]));
  const order = orderedCuts(bundle);
  const sceneMax = order.length > 60 ? 300 : 1000;
  const cuts = order.map((cutId, index) => {
    const cut = bundle.cuts.find((c) => c.id === cutId);
    return {
      number: index + 1,
      id: cutId,
      scene: clip(cut?.imagePrompt ?? "", sceneMax),
      ...(cut?.shotType ? { shotType: cut.shotType } : {}),
      ...(cut?.characters?.length ? { characters: cut.characters } : {}),
      hasArtwork: Boolean(cut?.image?.final || cut?.image?.clean),
      markedFinal: cut?.reviewStatus === "final",
      dialogue: bundle.lettering
        .filter((overlay) => overlay.cutId === cutId)
        .map((overlay) => ({
          bubbleId: overlay.id,
          speaker: names.get(overlay.speaker) ?? overlay.speaker,
          text: overlay.text,
          kind: overlay.kind,
        })),
    };
  });
  const transitions: Array<Record<string, unknown>> = [];
  const sequence = bundle.episode.sequence;
  sequence.forEach((item, index) => {
    if (item.type !== "transition") return;
    const before = sequence
      .slice(0, index)
      .reverse()
      .find((entry) => entry.type === "cut");
    const t = bundle.transitions.find((tr) => tr.id === item.id);
    if (!before || !t) return;
    transitions.push({
      afterCut: before.id,
      afterCutNumber: order.indexOf(before.id) + 1,
      type: t.type,
      gutterHeight: t.gutterHeight,
      ...(t.text ? { text: t.text } : {}),
    });
  });
  return {
    episode: {
      id: episodeId,
      title: bundle.episode.title,
      name: episodeName(loaded.project, episodeId),
    },
    cuts,
    transitions,
  };
}

async function readBounded(root: string, ref: string): Promise<Uint8Array | null> {
  try {
    const file = projectPath(root, ref);
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > ARTWORK_BYTES_MAX) return null;
      return new Uint8Array(await handle.readFile());
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

export const VIEW_MAX_PX = 768;

async function viewCut(host: ToolHost, episodeId: string, cutId: string): Promise<ToolResult> {
  const work = await requireWork(host);
  const loaded = await loadProject(work.root);
  const bundle = findBundle(loaded, episodeId);
  const cut = bundle?.cuts.find((c) => c.id === cutId);
  if (!bundle || !cut)
    throw new ToolInputError("This cut is not in the episode. read_episode lists the cuts.");
  const label = cutLabelOf(loaded, episodeId, cutId);
  const ref = cut.image?.final ?? cut.image?.clean ?? null;
  const overlays = bundle.lettering.filter((overlay) => overlay.cutId === cutId);
  if (!host.preferences().viewArtwork) {
    return textResult({
      cut: label,
      note: "Artwork viewing is off in the agent settings, so here is the cut as text.",
      scene: clip(cut.imagePrompt, 1000),
      hasArtwork: ref !== null,
      dialogue: overlays.map((o) => ({ speaker: o.speaker, text: o.text, kind: o.kind })),
    });
  }
  const bytes = ref ? await readBounded(work.root, ref) : null;
  const w = loaded.project.webtoon;
  const options = {
    imageLabel: label,
    dialogueLanguage: w.languages?.dialogueLanguage,
    gutterBandWidth: w.gutterBandWidth,
    panelAspect: cut.panelAspect,
  };
  let composed = await composeCut(overlays, bytes, VIEW_MAX_PX, options);
  if (composed.height > VIEW_MAX_PX) {
    const width = Math.max(64, Math.floor((VIEW_MAX_PX * VIEW_MAX_PX) / composed.height));
    composed = await composeCut(overlays, bytes, width, options);
  }
  const png = encodeCanvas(composed.canvas, "png");
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          cut: label,
          width: composed.width,
          height: composed.height,
          hasArtwork: bytes !== null,
          bubbles: overlays.length,
        }),
      },
      { type: "image", data: Buffer.from(png).toString("base64"), mimeType: "image/png" },
    ],
  };
}

async function checkEpisode(host: ToolHost, episodeId: string): Promise<Record<string, unknown>> {
  const work = await requireWork(host);
  const loaded = await loadProject(work.root);
  const index = loaded.project.episodes.findIndex((b) => b.episode.id === episodeId);
  const bundle = loaded.project.episodes[index];
  if (!bundle)
    throw new ToolInputError("This episode does not exist. get_status lists the episodes.");
  const order = orderedCuts(bundle);
  const where = (id: string) => {
    const n = order.indexOf(id);
    return n === -1 ? "" : `Cut ${n + 1}: `;
  };
  const errors = loaded.validation.issues
    .filter((issue) => issue.path.startsWith(`episodes[${index}]`))
    .map((issue) => issue.message);
  const images = new Map<string, Uint8Array | null>();
  for (const cut of bundle.cuts) {
    const ref = cut.image?.final ?? cut.image?.clean ?? null;
    images.set(cut.id, ref ? await readBounded(work.root, ref) : null);
  }
  const imageFor = (id: string) => images.get(id) ?? null;
  const findings = [
    ...lintCraft(bundle, loaded.project.webtoon.characters ?? []),
    ...lintBubbleOverflow(bundle, imageFor, {
      gutterBandWidth: loaded.project.webtoon.gutterBandWidth,
    }),
    ...lintPanelShape(bundle, imageFor),
  ];
  const sentence = (f: { targetId: string; message: string }) => `${where(f.targetId)}${f.message}`;
  const withoutArt = bundle.cuts.filter((cut) => !(cut.image?.final || cut.image?.clean)).length;
  return {
    episode: episodeName(loaded.project, episodeId),
    errors: [...errors, ...findings.filter((f) => f.severity === "error").map(sentence)].slice(
      0,
      30,
    ),
    warnings: findings
      .filter((f) => f.severity === "warning")
      .map(sentence)
      .slice(0, 30),
    notes: findings
      .filter((f) => f.severity === "info")
      .map(sentence)
      .slice(0, 15),
    cutsWithoutArt: withoutArt,
  };
}

// ---------------------------------------------------------------------------
// Dispatch

/** Tools that show no activity row (they have their own card or pinned list). */
const QUIET = new Set(["update_tasks", "ask_user"]);

function activity(
  host: ToolHost,
  id: string,
  spec: ToolSpec,
  status: "running" | "done" | "failed",
  extra: { title?: string; detail?: string; targets?: AgentTarget[] } = {},
): void {
  if (QUIET.has(spec.name)) return;
  host.item({
    kind: "activity",
    id,
    at: now(),
    turnId: host.turnId,
    tool: spec.name,
    title: extra.title ?? spec.step,
    status,
    ...(extra.detail ? { detail: extra.detail } : {}),
    ...(extra.targets?.length ? { targets: extra.targets } : {}),
  });
}

const DONE_TITLES: Record<string, string> = {
  get_status: "Checked the project",
  list_works: "Looked at the library",
  read_story: "Read the story",
  read_characters: "Read the cast",
  read_episode: "Read the episode",
  view_cut: "Looked at a cut",
  check_episode: "Checked the episode",
  create_work: "Created the webtoon",
  update_story: "Updated the story",
  save_characters: "Updated the cast",
  remove_character: "Removed a character",
  create_episode: "Created an episode",
  rename_episode: "Renamed an episode",
  delete_episode: "Deleted an episode",
  edit_cuts: "Edited cuts",
  set_dialogue: "Lettered a cut",
  set_transitions: "Set transitions",
  import_artwork: "Added artwork",
  export_episode: "Exported",
  undo_change: "Undid a change",
  remember: "Remembered a note",
  forget: "Forgot a note",
};

async function journalHead(root: string | null): Promise<string | null> {
  if (root === null) return null;
  const entries = await readJournal(root, 1);
  return entries.at(-1)?.changeId ?? null;
}

function changeItem(
  host: ToolHost,
  change: ProjectChange,
  targets: AgentTarget[],
): ConversationItem {
  return {
    kind: "change",
    id: itemId("chg"),
    at: now(),
    turnId: host.turnId,
    changeId: change.changeId,
    actor: "agent",
    summary: change.summary,
    targets,
    undoable: change.undoable !== false,
  };
}

/** Post the change cards of a performed write. */
function postChanges(host: ToolHost, performed: Performed): void {
  for (const change of performed.changes) {
    if (change !== null) host.item(changeItem(host, change, performed.targets));
  }
}

async function propose(
  host: ToolHost,
  tool: string,
  args: unknown,
  described: Described,
  workRoot: string | null,
  replacement?: DialogueReplacement,
): Promise<string> {
  const proposalId = itemId("prop");
  host.addProposal({
    proposalId,
    turnId: host.turnId,
    tool,
    args,
    workId: host.workId(),
    scopes: described.scopes,
    journalHead: await journalHead(workRoot),
    ...(replacement ? { replacement } : {}),
  });
  host.item({
    kind: "proposal",
    id: itemId("item"),
    at: now(),
    turnId: host.turnId,
    proposalId,
    title: described.title,
    summary: described.summary,
    ...(described.preview ? { preview: described.preview } : {}),
    targets: described.targets,
    state: "pending",
  });
  host.waiting();
  return proposalId;
}

function replacementDescription(
  replacement: DialogueReplacement,
  title: string,
  targets: AgentTarget[],
): Described {
  return {
    title: "Replace lettering",
    summary: `Replace the dialogue of ${title}`,
    preview: {
      kind: "lettering",
      before: replacement.before.map((line) => ({ speaker: line.speaker, text: line.text })),
      after: replacement.after.map((line) => ({ speaker: line.speaker, text: line.text })),
    },
    targets,
    scopes: [{ kind: "lettering", episodeId: replacement.episodeId, cutId: replacement.cutId }],
  };
}

/** Run one tool call for the agent. Never throws. */
export async function runTool(host: ToolHost, name: string, rawArgs: unknown): Promise<ToolResult> {
  const spec = toolSpec(name);
  if (spec === undefined) {
    return textResult(`There is no Toony tool named "${String(name).slice(0, 60)}".`, true);
  }
  const rowId = itemId("act");
  activity(host, rowId, spec, "running");
  try {
    const write = WRITES[name];
    if (write) {
      const args = write.parse(rawArgs);
      if (host.workId() === null && !write.library) await requireWork(host);
      const work = host.workId() === null ? null : await requireWork(host);
      if (!host.preferences().autoApply) {
        const described = await write.describe(host, args as never);
        const proposalId = await propose(host, name, args, described, work?.root ?? null);
        activity(host, rowId, spec, "done", {
          title: `Proposed: ${described.title.toLowerCase()}`,
          detail: "Waiting for your OK",
          targets: described.targets,
        });
        return textResult({
          proposed: true,
          proposalId,
          note: "Not applied yet. It is shown to the person as a proposal to apply or dismiss. Do not repeat it; finish your reply and end the turn. You will hear what they decide.",
        });
      }
      const performed = await write.perform(host, args as never);
      if (performed.replacement) {
        const { replacement, title, targets } = performed.replacement;
        const proposalId = await propose(
          host,
          name,
          args,
          replacementDescription(replacement, title, targets),
          work?.root ?? null,
          replacement,
        );
        activity(host, rowId, spec, "done", {
          title: "Proposed new lettering",
          detail: "Waiting for your OK",
          targets,
        });
        return textResult({
          proposed: true,
          proposalId,
          note: "This cut already has lettering, so the new lines are shown to the person as a proposal (before and after). Do not repeat it; finish your reply and end the turn.",
        });
      }
      postChanges(host, performed);
      activity(host, rowId, spec, "done", {
        title: DONE_TITLES[name] ?? spec.step,
        ...(performed.detail ? { detail: performed.detail } : {}),
        targets: performed.targets,
      });
      return textResult(performed.result);
    }
    const result = await runRead(host, name, rawArgs);
    activity(host, rowId, spec, "done", {
      title: DONE_TITLES[name] ?? spec.step,
      ...(result.detail ? { detail: result.detail } : {}),
    });
    return result.result;
  } catch (error) {
    const message =
      readableError(error) ?? "Toony could not finish this tool. Nothing was changed.";
    activity(host, rowId, spec, "failed", { detail: message });
    return textResult(message, true);
  }
}

async function runRead(
  host: ToolHost,
  name: string,
  rawArgs: unknown,
): Promise<{ result: ToolResult; detail?: string }> {
  switch (name) {
    case "get_status":
      A.noArgs(rawArgs);
      return { result: textResult(await getStatus(host)) };
    case "list_works": {
      A.noArgs(rawArgs);
      const works = await host.listWorks();
      return { result: textResult({ works, current: host.workId() }) };
    }
    case "read_story":
      A.noArgs(rawArgs);
      return { result: textResult(await readStory(host)) };
    case "read_characters":
      A.noArgs(rawArgs);
      return { result: textResult(await readCharacters(host)) };
    case "read_episode": {
      const { episodeId } = A.episodeArgs(rawArgs);
      const data = await readEpisode(host, episodeId);
      return {
        result: textResult(data),
        detail: String((data.episode as { name?: string }).name ?? ""),
      };
    }
    case "view_cut": {
      const { episodeId, cutId } = A.cutArgs(rawArgs);
      return { result: await viewCut(host, episodeId, cutId) };
    }
    case "check_episode": {
      const { episodeId } = A.episodeArgs(rawArgs);
      const data = await checkEpisode(host, episodeId);
      const errors = (data.errors as unknown[]).length;
      const warnings = (data.warnings as unknown[]).length;
      return {
        result: textResult(data),
        detail: errors + warnings === 0 ? "No problems" : `${errors} errors, ${warnings} warnings`,
      };
    }
    case "update_tasks": {
      const { tasks } = A.tasksArgs(rawArgs);
      const normalized = normalizeTasks(tasks);
      await host.setTasks(normalized);
      return { result: textResult({ tasks: normalized.length }) };
    }
    case "ask_user": {
      const ask = A.askArgs(rawArgs);
      const questionId = itemId("q");
      host.item({
        kind: "question",
        id: itemId("item"),
        at: now(),
        turnId: host.turnId,
        questionId,
        ...(ask.header ? { header: ask.header } : {}),
        prompt: ask.question,
        options: ask.options,
        multiSelect: ask.multiSelect,
        allowOther: ask.allowOther,
      });
      host.waiting();
      return {
        result: textResult({
          asked: true,
          questionId,
          note: "The question is shown to the person. End your turn now; their answer arrives as your next message.",
        }),
      };
    }
    case "remember": {
      const { text, kind } = A.rememberArgs(rawArgs);
      const work = await requireWork(host);
      const id = newNoteId();
      await updateMemory(work.root, (memory) => {
        memory.notes.push({ id, kind, text, at: now() });
        if (memory.notes.length > 100) memory.notes.splice(0, memory.notes.length - 100);
        return memory;
      });
      return { result: textResult({ remembered: id }), detail: text.slice(0, 80) };
    }
    case "forget": {
      const { noteId } = A.forgetArgs(rawArgs);
      const work = await requireWork(host);
      let found = false;
      await updateMemory(work.root, (memory) => {
        found = memory.notes.some((note) => note.id === noteId);
        memory.notes = memory.notes.filter((note) => note.id !== noteId);
        return memory;
      });
      if (!found)
        throw new ToolInputError("There is no note with that id. get_status lists the notes.");
      return { result: textResult({ forgotten: noteId }) };
    }
    default:
      throw new ToolInputError(`There is no Toony tool named "${name}".`);
  }
}

// ---------------------------------------------------------------------------
// Proposals the person applies later

export type ApplyOutcome =
  | { applied: true; changes: ProjectChange[]; targets: AgentTarget[]; summary: string }
  | { applied: false; stale: true; message: string };

/**
 * Apply a stored proposal for the person. Refused as stale when the project
 * changed where the proposal would write after it was made, or when ops says
 * so (lettering edited since, a cut that is gone).
 */
export async function applyProposal(host: ToolHost, stored: StoredProposal): Promise<ApplyOutcome> {
  const work = stored.workId === null ? null : await host.resolveWork(stored.workId);
  if (stored.workId !== null && work === null) {
    return { applied: false, stale: true, message: "This webtoon is no longer in the workspace." };
  }
  if (work !== null && !stored.replacement) {
    const journal = await readJournal(work.root, 500);
    let later: JournalEntry[] | null = journal;
    if (stored.journalHead !== null) {
      const index = journal.findIndex((entry) => entry.changeId === stored.journalHead);
      later = index === -1 ? null : journal.slice(index + 1);
    }
    const touched =
      later === null ||
      later.some((entry) =>
        entry.scopes.some((scope) => stored.scopes.some((own) => scopesOverlap(own, scope))),
      );
    if (touched) {
      return {
        applied: false,
        stale: true,
        message: "The project changed here after this was proposed. Ask the agent again.",
      };
    }
  }
  try {
    if (stored.replacement) {
      if (work === null) throw new ToolInputError("This webtoon is no longer in the workspace.");
      const { change } = await applyDialogueReplacement(
        contextFor(work.root, {
          actor: "agent",
          conversationId: host.conversationId,
          workId: work.id,
        }),
        stored.replacement,
      );
      const loaded = await load(work.root);
      const label = cutLabelOf(loaded, stored.replacement.episodeId, stored.replacement.cutId);
      const targets = [
        cutTarget(work.id, stored.replacement.episodeId, stored.replacement.cutId, label),
      ];
      if (change) host.item(changeItem(host, change, targets));
      return {
        applied: true,
        changes: change ? [change] : [],
        targets,
        summary: `Replaced the dialogue of ${label}`,
      };
    }
    const write = WRITES[stored.tool];
    if (!write)
      return { applied: false, stale: true, message: "This proposal can no longer be applied." };
    const performed = await write.perform(host, stored.args as never);
    if (performed.replacement) {
      return {
        applied: false,
        stale: true,
        message: "The cut has lettering now, so this proposal is out of date. Ask the agent again.",
      };
    }
    postChanges(host, performed);
    const changes = performed.changes.filter((c): c is ProjectChange => c !== null);
    return {
      applied: true,
      changes,
      targets: performed.targets,
      summary: changes.map((c) => c.summary).join("; ") || "Applied",
    };
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    const message = readableError(error) ?? "This proposal could not be applied.";
    if (
      code === "stale" ||
      code === "not-found" ||
      code === "conflict" ||
      error instanceof ToolInputError
    ) {
      return { applied: false, stale: true, message };
    }
    throw error;
  }
}

/** Read a file inside the project for tests and the brief. */
export async function readProjectText(root: string, relative: string): Promise<string> {
  return readFile(projectPath(root, relative), "utf8");
}

/** Sorted episode ids of a project, for callers that list episodes. */
export function episodeOrder(loaded: LoadedProject): string[] {
  return sortEpisodeIds(loaded.project.episodes.map((bundle) => bundle.episode.id));
}
