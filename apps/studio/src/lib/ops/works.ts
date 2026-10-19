// Creating and renaming a work.
//
// A new work keeps the title exactly as typed. Its folder (and so its id) is a
// separate, safe slug: the title's Latin slug when there is one, `webtoon`
// otherwise, numbered (`-2`, `-3`) when the folder is taken. Created works have
// no starter episode unless a starter is asked for, in which case the project
// is seeded exactly like `toony init --genre <id>`.

import { mkdir, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import {
  buildInitialProject,
  buildSeededProject,
  slugify,
  writeProject,
  writeWebtoon,
} from "@toony/project-io";
import type { Project } from "@toony/schema";
import type { ProjectChange } from "../agent/protocol.js";
import { liveBus } from "../live/bus.js";
import { discoverStudioPacks } from "../packs.js";
import type { ActorInfo } from "./context.js";
import { OpError } from "./errors.js";
import { appendJournal } from "./journal.js";
import { withLock } from "./lock.js";
import { newChangeId, type OpContext, withProjectWrite } from "./write.js";

export const TITLE_MAX = 200;

/** A title as it will be saved: trimmed, single-line, bounded. */
export function cleanTitle(title: string, what = "title"): string {
  const clean = title.replace(/\s+/g, " ").trim();
  if (clean === "") throw new OpError("invalid", `Enter a ${what}.`);
  if (clean.length > TITLE_MAX) {
    throw new OpError("invalid", `Keep the ${what} under ${TITLE_MAX} characters.`);
  }
  return clean;
}

/**
 * A folder name for a new work. Titles with no Latin letters or digits (for
 * example Korean or Japanese titles) become `webtoon`; a taken name gets the
 * next free number. Folder names are compared case-insensitively, because the
 * default macOS and Windows file systems do.
 */
export function workFolderSlug(title: string, taken: readonly string[]): string {
  const slug = slugify(title);
  const base = slug === "untitled" ? "webtoon" : slug.slice(0, 60).replace(/-+$/, "") || "webtoon";
  const used = new Set(taken.map((name) => name.toLowerCase()));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

const LANGUAGE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

export interface CreateWorkOptions {
  /** A starter genre id (built-in or from an installed pack). Absent: no episode. */
  genre?: string;
  logline?: string;
  /** The dialogue language, for example `ko`. Prompts stay in English. */
  language?: string;
  info?: ActorInfo;
}

export interface CreatedWork {
  workId: string;
  title: string;
  change: ProjectChange;
}

/** Create a work in `workspace`. Not undoable: removing a work is the person's call. */
export async function createWork(
  workspace: string,
  title: string,
  options: CreateWorkOptions = {},
): Promise<CreatedWork> {
  const clean = cleanTitle(title);
  const language = options.language?.trim();
  if (language !== undefined && language !== "" && !LANGUAGE.test(language)) {
    throw new OpError("invalid", "Use a language code such as en, ko or ja.");
  }
  await mkdir(workspace, { recursive: true });
  const root = await realpath(workspace);
  return withLock(`workspace:${root}`, async () => {
    const taken = (await readdir(root, { withFileTypes: true })).map((entry) => entry.name);
    const workId = workFolderSlug(clean, taken);
    let project: Project | null;
    if (options.genre !== undefined && options.genre.trim() !== "") {
      const packs = await discoverStudioPacks(root);
      project = await buildSeededProject(clean, options.genre, packs.content.genres);
      if (project === null) {
        throw new OpError(
          "invalid",
          `Starter "${options.genre}" is no longer available. Choose another starter or Blank story.`,
        );
      }
    } else {
      project = buildInitialProject(clean);
      project.episodes = [];
    }
    project.webtoon = { ...project.webtoon, projectId: workId, title: clean };
    const logline = options.logline?.trim();
    if (logline) project.webtoon.logline = logline;
    if (language) {
      project.webtoon.languages = {
        defaultLanguage: language,
        supportedLanguages: language === "en" ? ["en"] : [language, "en"],
        dialogueLanguage: language,
        promptLanguage: "en",
      };
    }
    const target = join(root, workId);
    try {
      await writeProject(target, project);
    } catch (cause) {
      throw new OpError("failed", "Toony could not create the webtoon folder.", { cause });
    }
    const changeId = newChangeId();
    const at = new Date().toISOString();
    const info = options.info ?? {};
    const actor = info.actor ?? "human";
    const summary = `Created "${clean}"`;
    await appendJournal(target, {
      changeId,
      at,
      actor,
      summary,
      scopes: [{ kind: "work" }],
      files: [],
      ...(info.conversationId === undefined ? {} : { conversationId: info.conversationId }),
    });
    const change: ProjectChange = {
      workId,
      changeId,
      actor,
      summary,
      scopes: [{ kind: "work" }, { kind: "episodes" }],
      at,
      undoable: false,
      ...(info.conversationId === undefined ? {} : { conversationId: info.conversationId }),
      ...(info.clientId === undefined ? {} : { clientId: info.clientId }),
    };
    liveBus().publish({ type: "project", change });
    return { workId, title: clean, change };
  });
}

/** Rename a work. Only the title changes; the folder and id stay. */
export async function renameWork(ctx: OpContext, title: string): Promise<ProjectChange | null> {
  const clean = cleanTitle(title);
  const { change } = await withProjectWrite(
    ctx,
    {
      summary: `Renamed the webtoon to "${clean}"`,
      scopes: [{ kind: "work" }],
      files: ["webtoon.json"],
    },
    async (tx) => {
      if (tx.before.project.webtoon.title === clean) return;
      await writeWebtoon(tx.root, { ...tx.before.project.webtoon, title: clean });
    },
  );
  return change;
}
