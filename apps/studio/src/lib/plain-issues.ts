// Validation issues in plain words for the story page's "Needs attention"
// list. A schema issue carries a dotted path and a machine code; people need
// to know where (which episode, which cut) and what, without field names.
// Pure, so every mapping is unit tested.

import type { Project, ValidationIssue } from "@toony/schema";

export interface PlainIssue {
  /** Stable key for the list. */
  key: string;
  /** Where, in words: "Episode 2 · Cut 3". */
  where: string;
  /** What, in one sentence. */
  text: string;
  /** Where to fix it in the workspace, when there is a page for it. */
  href?: string;
}

type Matcher = (issue: ValidationIssue) => boolean;
const code =
  (pattern: RegExp): Matcher =>
  (issue) =>
    pattern.test(issue.code);

const MESSAGES: Array<[Matcher, string]> = [
  [(issue) => /\.speaker$/.test(issue.path), "A dialogue bubble has no speaker."],
  [code(/^overlay\.missing-cut$/), "A bubble belongs to a cut that is no longer in the episode."],
  [code(/^cut\.orphan$/), "A cut is not in the reading order."],
  [code(/^transition\.orphan$/), "A transition is not in the reading order."],
  [code(/^sequence\.empty$/), "The episode has no cuts."],
  [code(/^sequence\.(leading|trailing|adjacent)/), "A transition is not between two cuts."],
  [code(/^sequence\.(missing|duplicate)/), "The reading order lists a missing or repeated item."],
  [code(/^cut\.image/), "The artwork file is missing or cannot be read."],
  [code(/^cut\.character-ref$/), "A cut names a character who is not in the cast."],
  [code(/^character\.reference/), "A reference sheet is missing or in the wrong folder."],
  [code(/^character\.duplicate-id$/), "Two characters share the same folder."],
  [code(/^(geometry|tail|tail-target)\./), "A bubble sits outside its cut."],
  [code(/^(style|overlay|border)\./), "A bubble has a style Toony cannot draw."],
  [code(/^transition\./), "A transition has a setting Toony cannot draw."],
  [code(/^episode\.(duplicate-id|id-collision)$/), "Two episodes share the same folder."],
];

function sentence(text: string): string {
  const clean = text
    .replace(/`[^`]*`/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean === "") return "Something here needs a fix.";
  const first = clean.charAt(0).toUpperCase() + clean.slice(1);
  return /[.!?]$/.test(first) ? first : `${first}.`;
}

function messageFor(issue: ValidationIssue): string {
  for (const [matches, text] of MESSAGES) {
    if (matches(issue)) return text;
  }
  return sentence(issue.message);
}

function index(path: string, key: string): number | null {
  const match = new RegExp(`${key}\\[(\\d+)\\]`).exec(path);
  return match?.[1] === undefined ? null : Number(match[1]);
}

interface Place {
  where: string;
  href?: string;
}

function placeOf(issue: ValidationIssue, project: Project | null, workHref: string): Place {
  const path = issue.path;
  const e = index(path, "episodes");
  if (e !== null) {
    const bundle = project?.episodes[e];
    const title = bundle?.episode.title?.trim() || `Episode ${e + 1}`;
    if (!bundle) return { where: title };
    const base = `${workHref}/episodes/${encodeURIComponent(bundle.episode.id)}`;
    const order = bundle.episode.sequence.filter((i) => i.type === "cut").map((i) => i.id);
    const cutPlace = (cutId: string | undefined): Place => {
      const n = cutId === undefined ? 0 : order.indexOf(cutId) + 1;
      return n > 0 && cutId !== undefined
        ? {
            where: `${title} · Cut ${n}`,
            href: `${base}?item=${encodeURIComponent(`cut:${cutId}`)}`,
          }
        : { where: title, href: base };
    };
    const c = index(path, "cuts");
    if (c !== null) return cutPlace(bundle.cuts[c]?.id);
    const l = index(path, "lettering");
    if (l !== null) return cutPlace(bundle.lettering[l]?.cutId);
    const t = index(path, "transitions");
    if (t !== null) {
      const id = bundle.transitions[t]?.id;
      return {
        where: `${title} · a transition`,
        href: id ? `${base}?item=${encodeURIComponent(`transition:${id}`)}` : base,
      };
    }
    return { where: title, href: base };
  }
  const ch = index(path, "characters");
  if (ch !== null) {
    const name = project?.webtoon.characters?.[ch]?.name;
    return { where: name ? `Characters · ${name}` : "Characters", href: `${workHref}/characters` };
  }
  return { where: "Story settings" };
}

/** Plain, de-duplicated issues for the story page. */
export function plainIssues(
  issues: readonly ValidationIssue[],
  project: Project | null,
  workHref: string,
): PlainIssue[] {
  const seen = new Set<string>();
  const out: PlainIssue[] = [];
  for (const issue of issues) {
    const place = placeOf(issue, project, workHref);
    const text = messageFor(issue);
    const key = `${place.where}|${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, where: place.where, text, ...(place.href ? { href: place.href } : {}) });
  }
  return out;
}
