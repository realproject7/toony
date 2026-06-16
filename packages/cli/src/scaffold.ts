// Project scaffolder for `toony init`.
//
// Builds a valid in-memory `Project` (one starter episode with a canonical
// sequence) and writes it to disk as a folder of deterministic JSON + Markdown
// files plus the documented asset/export/log directories. The output is
// guaranteed to pass `toony validate`: the same `@toony/schema` validators run
// here before any file is written.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type Cut,
  type Episode,
  type EpisodeBundle,
  type LetteringOverlay,
  type Project,
  SCHEMA_VERSION,
  type Transition,
  validateProject,
  type Webtoon,
} from "@toony/schema";
import {
  cutsFile,
  EPISODE_DIRS,
  episodeDir,
  episodeFile,
  letteringFile,
  PROJECT_DIRS,
  STORY_BIBLE_FILE,
  STYLE_GUIDE_FILE,
  transitionsFile,
  webtoonPath,
} from "./paths.js";

/** Lowercase, hyphenate, and trim a name into a safe folder/project id. */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "untitled";
}

/** Title-case a slug back into a human-readable display title. */
function titleize(slug: string): string {
  return slug
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

/** A starter episode bundle with one cut, one transition, one more cut. */
function starterEpisode(): EpisodeBundle {
  const episode: Episode = {
    schemaVersion: SCHEMA_VERSION,
    id: "ep-001",
    title: "Episode 1",
    sequence: [
      { type: "cut", id: "cut-001" },
      { type: "transition", id: "tr-001" },
      { type: "cut", id: "cut-002" },
    ],
  };
  const cuts: Cut[] = [
    { id: "cut-001", image: null },
    { id: "cut-002", image: null },
  ];
  const transitions: Transition[] = [
    {
      id: "tr-001",
      type: "gutter",
      gutterHeight: 48,
      text: null,
      sfx: null,
      agentNote: null,
      humanNote: null,
      image: null,
      reviewStatus: "draft",
    },
  ];
  const lettering: LetteringOverlay[] = [];
  return { episode, cuts, transitions, lettering };
}

/** Build the full in-memory project model for a new project. */
export function buildInitialProject(name: string): Project {
  const projectId = slugify(name);
  const webtoon: Webtoon = {
    schemaVersion: SCHEMA_VERSION,
    projectId,
    title: titleize(projectId),
    languages: {
      defaultLanguage: "en",
      supportedLanguages: ["en"],
      dialogueLanguage: "en",
      promptLanguage: "en",
    },
    imageProviders: {
      defaultProvider: "manual",
      providers: [],
    },
  };
  return { webtoon, episodes: [starterEpisode()] };
}

/** Deterministic JSON encoding (sorted keys, trailing newline). */
function toJson(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) sorted[key] = sortKeys(source[key]);
    return sorted;
  }
  return value;
}

const STORY_BIBLE_TEMPLATE = `# Story Bible

One-paragraph premise, the core cast, and the world rules that every episode
must stay consistent with. Keep this in the project's prompt language.
`;

const STYLE_GUIDE_TEMPLATE = `# Style Guide

Visual direction: linework, palette, lettering fonts, and panel rhythm. Asset
files live under each episode's \`assets/\` folder and are referenced by
project-relative path only.
`;

/**
 * Write a fully-formed project to \`root\`. Validates the model first and refuses
 * to write if it would not pass \`toony validate\`. Callers must ensure \`root\`
 * does not already exist.
 */
export async function writeProject(root: string, project: Project): Promise<void> {
  const result = validateProject(project);
  if (!result.valid) {
    const detail = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new Error(`refusing to write an invalid project: ${detail}`);
  }

  await mkdir(root, { recursive: false });
  for (const dir of PROJECT_DIRS) {
    await mkdir(join(root, dir), { recursive: true });
  }

  await writeFile(webtoonPath(root), toJson(project.webtoon), "utf8");
  await writeFile(join(root, STORY_BIBLE_FILE), STORY_BIBLE_TEMPLATE, "utf8");
  await writeFile(join(root, STYLE_GUIDE_FILE), STYLE_GUIDE_TEMPLATE, "utf8");

  for (const bundle of project.episodes) {
    const id = bundle.episode.id;
    await mkdir(episodeDir(root, id), { recursive: true });
    for (const dir of EPISODE_DIRS) {
      await mkdir(join(episodeDir(root, id), dir), { recursive: true });
    }
    await writeFile(episodeFile(root, id), toJson(bundle.episode), "utf8");
    await writeFile(cutsFile(root, id), toJson(bundle.cuts), "utf8");
    await writeFile(transitionsFile(root, id), toJson(bundle.transitions), "utf8");
    await writeFile(letteringFile(root, id), toJson(bundle.lettering), "utf8");
  }
}
