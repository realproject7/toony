// A style lexicon (#335): the words a pack's prompts share. A pack's workflow
// was tuned with a style clause and a base negative prompt; today each cut
// repeats them or forgets them. A lexicon states them once. It is DATA a pack
// contributes and a project selects by id in `webtoon.json`, and it is read at
// generation only: `toony generate` composes the clause after the palette
// clause and puts the negative base before the cut's own negative prompt, and
// records both as submitted. Planning, drafting and the script reader never
// read it, per the 2026-09-22 ruling that pack text supplies no semantics
// during planning.

import type { ValidationResult } from "./errors.js";
import { IssueCollector, joinPath } from "./errors.js";
import { isNonEmptyString, isPlainObject, isString } from "./guards.js";

/** The format version a lexicon file must declare. */
export const STYLE_LEXICON_FORMAT_VERSION = 1;

/**
 * Whether a run under this lexicon wraps the scene in the project's story bible
 * (#351): `wrap` is what every run did before the field existed; `none` sends
 * the scene alone, for a workflow tuned on a checkpoint that reads prose as
 * noise. The bible file is untouched either way.
 */
export const STORY_CONTEXTS = ["wrap", "none"] as const;
export type StoryContext = (typeof STORY_CONTEXTS)[number];

export interface StyleLexicon {
  lexiconFormat: number;
  name?: string;
  /** Appended to every composed prompt, after the palette clause. */
  styleClause: string;
  /** Put before the cut's own negative prompt. May be empty. */
  negativeBase: string;
  /**
   * Put at the very start of the composed prompt, before the character
   * lockstrings (#351): the quality and register words a tag-style checkpoint
   * reads first. Absent means none, and the prompt opens as it always did.
   */
  stylePrefix?: string;
  /** See {@link STORY_CONTEXTS}. Absent means `wrap`. */
  storyContext?: StoryContext;
}

const LEXICON_KEYS = [
  "lexiconFormat",
  "name",
  "styleClause",
  "negativeBase",
  "stylePrefix",
  "storyContext",
] as const;

/** Validate an untrusted value as a style lexicon file. */
export function validateStyleLexiconValue(value: unknown): ValidationResult {
  const c = new IssueCollector();
  const path = "lexicon";
  if (!isPlainObject(value)) {
    c.add(path, "lexicon.type", "a style lexicon must be an object.");
    return c.result();
  }
  for (const key of Object.keys(value)) {
    if (!LEXICON_KEYS.includes(key as (typeof LEXICON_KEYS)[number])) {
      c.add(joinPath(path, key), "lexicon.unknown-key", `unknown key: ${key}`);
    }
  }
  if (value.lexiconFormat !== STYLE_LEXICON_FORMAT_VERSION) {
    c.add(
      joinPath(path, "lexiconFormat"),
      "lexicon.format",
      `lexiconFormat must be ${STYLE_LEXICON_FORMAT_VERSION}.`,
    );
  }
  if (value.name !== undefined && !isNonEmptyString(value.name)) {
    c.add(joinPath(path, "name"), "lexicon.name", "name must be a non-empty string.");
  }
  if (!isNonEmptyString(value.styleClause)) {
    c.add(
      joinPath(path, "styleClause"),
      "lexicon.style-clause",
      "styleClause must be a non-empty string.",
    );
  }
  if (!isString(value.negativeBase)) {
    c.add(
      joinPath(path, "negativeBase"),
      "lexicon.negative-base",
      "negativeBase must be a string (it may be empty).",
    );
  }
  if (value.stylePrefix !== undefined && !isNonEmptyString(value.stylePrefix)) {
    c.add(
      joinPath(path, "stylePrefix"),
      "lexicon.style-prefix",
      "stylePrefix must be a non-empty string when stated; leave it out for none.",
    );
  }
  if (
    value.storyContext !== undefined &&
    !STORY_CONTEXTS.includes(value.storyContext as StoryContext)
  ) {
    c.add(
      joinPath(path, "storyContext"),
      "lexicon.story-context",
      `storyContext must be one of: ${STORY_CONTEXTS.join(", ")}.`,
    );
  }
  return c.result();
}

/** Narrow a value that already passed `validateStyleLexiconValue`. */
export function asStyleLexicon(value: Record<string, unknown>): StyleLexicon {
  return value as unknown as StyleLexicon;
}

/**
 * The negative prompt a run submits: the lexicon's base, then the cut's own,
 * joined by a comma. With no base the cut's own string is returned UNTOUCHED,
 * whitespace and all, so a project that selects no lexicon submits byte for
 * byte what it always did; with a base and an empty own, the base alone.
 */
export function composeNegativePrompt(own: string, negativeBase: string | undefined): string {
  const base = (negativeBase ?? "").trim();
  if (base.length === 0) return own;
  if (own.trim().length === 0) return base;
  return `${base}, ${own}`;
}
