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

export interface StyleLexicon {
  lexiconFormat: number;
  name?: string;
  /** Appended to every composed prompt, after the palette clause. */
  styleClause: string;
  /** Put before the cut's own negative prompt. May be empty. */
  negativeBase: string;
}

const LEXICON_KEYS = ["lexiconFormat", "name", "styleClause", "negativeBase"] as const;

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
