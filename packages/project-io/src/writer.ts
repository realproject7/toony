// Write a Toony project to disk in the canonical hybrid format.
//
// Validates the in-memory model with `@toony/schema` before writing, then emits
// JSON structural files and YAML content files plus the documented asset/export/
// log folders and the story-bible/style-guide documents. Output is deterministic
// (stable key order), so re-writing an unchanged project is byte-stable.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Project, validateProject } from "@toony/schema";
import { encodeJson, encodeYaml } from "./format.js";
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
 * to write if it would not pass schema validation. Callers must ensure \`root\`
 * does not already exist (this creates it non-recursively).
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

  // Structural files: JSON.
  await writeFile(webtoonPath(root), encodeJson(project.webtoon), "utf8");
  await writeFile(join(root, STORY_BIBLE_FILE), STORY_BIBLE_TEMPLATE, "utf8");
  await writeFile(join(root, STYLE_GUIDE_FILE), STYLE_GUIDE_TEMPLATE, "utf8");

  for (const bundle of project.episodes) {
    const id = bundle.episode.id;
    await mkdir(episodeDir(root, id), { recursive: true });
    for (const dir of EPISODE_DIRS) {
      await mkdir(join(episodeDir(root, id), dir), { recursive: true });
    }
    // Content files: YAML. Lettering: JSON.
    await writeFile(episodeFile(root, id), encodeYaml(bundle.episode), "utf8");
    await writeFile(cutsFile(root, id), encodeYaml(bundle.cuts), "utf8");
    await writeFile(transitionsFile(root, id), encodeYaml(bundle.transitions), "utf8");
    await writeFile(letteringFile(root, id), encodeJson(bundle.lettering), "utf8");
  }
}
