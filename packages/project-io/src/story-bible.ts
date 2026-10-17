import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ProjectIoError } from "./errors.js";
import { STORY_BIBLE_FILE } from "./paths.js";

export const STORY_BIBLE_TEMPLATE = `# Story Bible

One-paragraph premise, the core cast, and the world rules that every episode
must stay consistent with. Keep this in the project's prompt language.
`;

/** Authored context only. An absent, blank or untouched scaffold is neutral. */
export async function readStoryBible(root: string): Promise<string> {
  const file = join(root, STORY_BIBLE_FILE);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw new ProjectIoError(`could not read ${STORY_BIBLE_FILE}.`, file);
  }
  const context = text.trim();
  return context.replace(/\r\n/g, "\n") === STORY_BIBLE_TEMPLATE.trim() ? "" : context;
}
