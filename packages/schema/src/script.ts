// The authored planning artifacts a Toony project may carry: the project's
// production brief and one script per episode.
//
// These are AUTHORED INPUT, not derived state. The brief says what the work is;
// a script says what one episode does, beat by beat and cut by cut. Nothing in
// the repo reads or applies them on its own — a project without them behaves
// exactly as it always did, and a project with them behaves the same until
// something is explicitly asked to read them.
//
// THIS IS NOT THE EPISODE PLAN. `@toony/export` already ships `EpisodePlan`,
// which decides how tall a page is and nothing else. The artifacts here decide
// nothing about the page: they carry no panel aspect and no gutter height. A
// cut's shape stays on `Cut.panelAspect`, and `toony plan --episode` grades the
// real cuts once they exist. That is why the word "plan" is not used here, and
// why a `ScriptBeat` states a narrative beat while a `PlanBeat` measures one.
//
// The shapes are DATA, validated the way the geometry plan and a pack manifest
// are: a strict allowlist at every level, so a misspelled field is a reported
// issue rather than something quietly ignored and never read.
//
// Each artifact carries its OWN format version rather than `SCHEMA_VERSION`, so
// these files version independently of the project format.

import type { IssueCollector } from "./errors.js";
import { joinPath } from "./errors.js";
import { isArray, isNonEmptyString, isPlainObject } from "./guards.js";
import { isPathSafeId } from "./path-safe-id.js";

/** The format version a `script/brief.json` must declare. */
export const PRODUCTION_BRIEF_FORMAT_VERSION = 1;

/** The format version a `script/episodes/<id>.json` must declare. */
export const EPISODE_SCRIPT_FORMAT_VERSION = 1;

/**
 * Cuts one script may state, summed over its beats, and the most beats it may
 * hold.
 *
 * #233 measured two episodes of one title at 97 and 103 panels, and
 * `docs/CAPSTONE.md` records the wider sample as 67 to 103 panel bands — floors
 * on cut count, since a band can hold more than one panel. Two thousand is about
 * twenty times a real episode, so what it catches is a file that is wrong by an
 * order of magnitude, reported at the field where the message can name it. The
 * geometry plan reached the same number from the same measurement; that
 * constant is module-private to `@toony/export` and this one is derived again
 * rather than shared, so either may move on its own evidence.
 *
 * The same number bounds the beats array, because a beat states at least one
 * cut and a script therefore never holds more beats than cuts.
 */
export const SCRIPT_CUTS_MAX = 2000;

/** A persisted revision identity: the lowercase hex sha256 of an artifact's bytes. */
const REVISION_ID_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Whether `value` has the shape of a persisted revision identity. The identity
 * itself is computed by `@toony/project-io`, which owns the bytes; this package
 * only checks that a recorded one is well formed.
 */
export function isRevisionId(value: unknown): value is string {
  return typeof value === "string" && REVISION_ID_PATTERN.test(value);
}

// --- Production brief -------------------------------------------------------

/**
 * Story-level material about a character that is ALREADY in the project
 * registry (`webtoon.characters`). It does not mint a second identity and
 * carries no lockstring: the registry owns who the character is, and this says
 * what the character is for.
 */
export interface BriefCastNote {
  /** An id in the `webtoon.characters` namespace `Cut.characters` also uses. */
  characterId: string;
  /** What this character is for in the story. */
  role: string;
  /** Continuity the work must hold for this character. */
  continuity?: string;
}

/**
 * Constraints a later phase may apply when it compiles a script. Exactly the
 * three concerns a brief is permitted to constrain, stated in the author's own
 * words — no geometry number lives here, and the script itself states none.
 */
export interface BriefPlanningProfile {
  /** How the pages should be shaped, as a constraint rather than a measurement. */
  geometry?: string;
  /** Which transitions the work uses, and when. */
  transitions?: string;
  /** How the work letters: bubble vocabulary, density, placement habits. */
  lettering?: string;
}

/** The project-level `script/brief.json`: what the work is and what it is for. */
export interface ProductionBrief {
  briefFormat: number;
  /** What the work is and what it is trying to do. */
  intent: string;
  /** Who the work is for. */
  audience: string;
  /** Where and when the work is set. */
  world: string;
  /** What the story is going for, most important first. At least one. */
  storyGoals: string[];
  /** What the work must not contain. Absent means none are stated. */
  contentConstraints?: string[];
  /** Story-level notes keyed to the existing character registry. */
  cast?: BriefCastNote[];
  /** How this brief may be revised, for whoever proposes a revision. */
  revisionPolicy?: string;
  /** Constraints a later phase may apply when it compiles a script. */
  planningProfile?: BriefPlanningProfile;
}

// --- Episode script ---------------------------------------------------------

/** One line a cut says, in reading order. */
export interface ScriptLine {
  /** The character id who says it, or null for narration. */
  speaker: string | null;
  /** What is said. */
  text: string;
}

/** What one character wants in a beat. */
export interface ScriptGoal {
  /** An id in the `webtoon.characters` namespace. */
  characterId: string;
  /** What the character is after in this beat. */
  goal: string;
}

/**
 * One cut a script states: what it is for, what is in it, who is in it, and
 * what is said. It states NO geometry — no panel aspect, no gutter height — and
 * no prompt, seed, workflow, provider, asset reference or render record.
 */
export interface ScriptCut {
  /** Unique within its script. Nothing here requires it to match a real `Cut`. */
  id: string;
  /** What this cut does for the story. */
  intent: string;
  /** What the reader sees: place, moment, action. */
  scene: string;
  /** Character ids present in the cut. A script may name any subset. */
  characters?: string[];
  /** Lines the cut carries, in reading order. */
  dialogue?: ScriptLine[];
  /** How the lettering should read, in the author's words. */
  letteringIntent?: string;
}

/** One narrative beat: what it is for, what its characters want, and its cuts. */
export interface ScriptBeat {
  /** Unique within its script. */
  id: string;
  /** What this beat is for. */
  purpose: string;
  /** What each character in the beat wants. */
  goals?: ScriptGoal[];
  /** The beat's cuts, in reading order. At least one. */
  cuts: ScriptCut[];
}

/**
 * One episode's `script/episodes/<episode-id>.json`.
 *
 * `episodeId` need not name an episode that exists yet: compiling a script into
 * a new episode is what a later phase is for. It must be path safe, and it must
 * agree with the filename, so a copied or renamed file cannot silently describe
 * a different episode.
 *
 * `briefRevision` is the identity of the brief this script was written against.
 * It is what makes a stale script detectable instead of silently meaning
 * something new after the brief is edited.
 *
 * Order is array order, the way `Episode.sequence` and the records in
 * `cuts.yaml` already carry it: there is no separate order field to disagree
 * with the array, and so no contiguity rule to check.
 */
export interface EpisodeScript {
  scriptFormat: number;
  episodeId: string;
  briefRevision: string;
  beats: ScriptBeat[];
}

// --- Validators -------------------------------------------------------------
//
// Written in the `IssueCollector` idiom every validator in this package uses: a
// value, a path and a collector, and nothing else. They hold no filename and no
// character registry, so the filename agreement and character-ref resolution
// are the reader's job in `@toony/project-io`, not theirs.

function allowlistKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  code: string,
  c: IssueCollector,
): void {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue;
    c.add(joinPath(path, key), code, `unknown key: ${key}`);
  }
}

function requireText(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  c: IssueCollector,
): void {
  if (!isNonEmptyString(obj[key])) {
    c.add(joinPath(path, key), "field.required", `${key} must be a non-empty string.`);
  }
}

function optionalText(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  c: IssueCollector,
): void {
  if (obj[key] !== undefined && !isNonEmptyString(obj[key])) {
    c.add(joinPath(path, key), "field.type", `${key} must be a non-empty string.`);
  }
}

/** An array of non-empty strings under `key`; `required` rejects an empty list. */
function validateTextArray(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  code: string,
  required: boolean,
  c: IssueCollector,
): void {
  const value = obj[key];
  if (!isArray(value) || (required && value.length === 0) || !value.every(isNonEmptyString)) {
    c.add(
      joinPath(path, key),
      code,
      required
        ? `${key} must be a non-empty array of non-empty strings.`
        : `${key} must be an array of non-empty strings.`,
    );
  }
}

const BRIEF_KEYS = [
  "briefFormat",
  "intent",
  "audience",
  "world",
  "storyGoals",
  "contentConstraints",
  "cast",
  "revisionPolicy",
  "planningProfile",
] as const;
const BRIEF_CAST_KEYS = ["characterId", "role", "continuity"] as const;
const BRIEF_PROFILE_KEYS = ["geometry", "transitions", "lettering"] as const;

function validateCastNote(value: unknown, path: string, c: IssueCollector): void {
  if (!isPlainObject(value)) {
    c.add(path, "brief.cast-note", "a cast note must be an object.");
    return;
  }
  allowlistKeys(value, BRIEF_CAST_KEYS, path, "brief.unknown-key", c);
  requireText(value, "characterId", path, c);
  requireText(value, "role", path, c);
  optionalText(value, "continuity", path, c);
}

function validatePlanningProfile(value: unknown, path: string, c: IssueCollector): void {
  if (!isPlainObject(value)) {
    c.add(path, "brief.planning-profile", "planningProfile must be an object.");
    return;
  }
  allowlistKeys(value, BRIEF_PROFILE_KEYS, path, "brief.unknown-key", c);
  for (const key of BRIEF_PROFILE_KEYS) optionalText(value, key, path, c);
}

/** Validate an untrusted value as a production brief. */
export function validateProductionBriefValue(
  value: unknown,
  path: string,
  c: IssueCollector,
): void {
  if (!isPlainObject(value)) {
    c.add(path, "brief.type", "a production brief must be an object.");
    return;
  }
  allowlistKeys(value, BRIEF_KEYS, path, "brief.unknown-key", c);
  if (value.briefFormat !== PRODUCTION_BRIEF_FORMAT_VERSION) {
    c.add(
      joinPath(path, "briefFormat"),
      "brief.format",
      `briefFormat must be ${PRODUCTION_BRIEF_FORMAT_VERSION}.`,
    );
  }
  requireText(value, "intent", path, c);
  requireText(value, "audience", path, c);
  requireText(value, "world", path, c);
  optionalText(value, "revisionPolicy", path, c);
  validateTextArray(value, "storyGoals", path, "brief.story-goals", true, c);
  if (value.contentConstraints !== undefined) {
    validateTextArray(value, "contentConstraints", path, "brief.content-constraints", false, c);
  }
  if (value.cast !== undefined) {
    const cast = value.cast;
    if (!isArray(cast)) {
      c.add(joinPath(path, "cast"), "brief.cast", "cast must be an array.");
    } else {
      const ids = new Set<string>();
      for (let i = 0; i < cast.length; i++) {
        const notePath = joinPath(joinPath(path, "cast"), i);
        validateCastNote(cast[i], notePath, c);
        const note = cast[i];
        if (isPlainObject(note) && isNonEmptyString(note.characterId)) {
          if (ids.has(note.characterId)) {
            c.add(
              joinPath(notePath, "characterId"),
              "brief.cast.duplicate-id",
              `duplicate cast note for character "${note.characterId}".`,
            );
          }
          ids.add(note.characterId);
        }
      }
    }
  }
  if (value.planningProfile !== undefined) {
    validatePlanningProfile(value.planningProfile, joinPath(path, "planningProfile"), c);
  }
}

const SCRIPT_KEYS = ["scriptFormat", "episodeId", "briefRevision", "beats"] as const;
const SCRIPT_BEAT_KEYS = ["id", "purpose", "goals", "cuts"] as const;
const SCRIPT_GOAL_KEYS = ["characterId", "goal"] as const;
const SCRIPT_CUT_KEYS = [
  "id",
  "intent",
  "scene",
  "characters",
  "dialogue",
  "letteringIntent",
] as const;
const SCRIPT_LINE_KEYS = ["speaker", "text"] as const;

function validateScriptGoal(value: unknown, path: string, c: IssueCollector): void {
  if (!isPlainObject(value)) {
    c.add(path, "script.goal", "a beat goal must be an object.");
    return;
  }
  allowlistKeys(value, SCRIPT_GOAL_KEYS, path, "script.unknown-key", c);
  requireText(value, "characterId", path, c);
  requireText(value, "goal", path, c);
}

function validateScriptLine(value: unknown, path: string, c: IssueCollector): void {
  if (!isPlainObject(value)) {
    c.add(path, "script.line", "a dialogue line must be an object.");
    return;
  }
  allowlistKeys(value, SCRIPT_LINE_KEYS, path, "script.unknown-key", c);
  // Narration has no speaker, so null is the stated absence rather than a
  // missing key — the same shape the nullable fields on a transition take.
  if (value.speaker !== null && !isNonEmptyString(value.speaker)) {
    c.add(
      joinPath(path, "speaker"),
      "script.line-speaker",
      "speaker must be a character id or null for narration.",
    );
  }
  requireText(value, "text", path, c);
}

function validateScriptCut(value: unknown, path: string, c: IssueCollector): void {
  if (!isPlainObject(value)) {
    c.add(path, "script.cut", "a script cut must be an object.");
    return;
  }
  allowlistKeys(value, SCRIPT_CUT_KEYS, path, "script.unknown-key", c);
  requireText(value, "id", path, c);
  requireText(value, "intent", path, c);
  requireText(value, "scene", path, c);
  optionalText(value, "letteringIntent", path, c);
  if (value.characters !== undefined) {
    validateTextArray(value, "characters", path, "script.cut-characters", false, c);
  }
  if (value.dialogue !== undefined) {
    const dialogue = value.dialogue;
    if (!isArray(dialogue)) {
      c.add(joinPath(path, "dialogue"), "script.cut-dialogue", "dialogue must be an array.");
    } else {
      for (let i = 0; i < dialogue.length; i++) {
        validateScriptLine(dialogue[i], joinPath(joinPath(path, "dialogue"), i), c);
      }
    }
  }
}

function validateScriptBeat(
  value: unknown,
  path: string,
  cutIds: Set<string>,
  c: IssueCollector,
): number {
  if (!isPlainObject(value)) {
    c.add(path, "script.beat", "a beat must be an object.");
    return 0;
  }
  allowlistKeys(value, SCRIPT_BEAT_KEYS, path, "script.unknown-key", c);
  requireText(value, "id", path, c);
  requireText(value, "purpose", path, c);
  if (value.goals !== undefined) {
    const goals = value.goals;
    if (!isArray(goals)) {
      c.add(joinPath(path, "goals"), "script.beat-goals", "goals must be an array.");
    } else {
      for (let i = 0; i < goals.length; i++) {
        validateScriptGoal(goals[i], joinPath(joinPath(path, "goals"), i), c);
      }
    }
  }
  const cuts = value.cuts;
  if (!isArray(cuts) || cuts.length === 0) {
    c.add(
      joinPath(path, "cuts"),
      "script.beat-cuts",
      "cuts must be a non-empty array. A beat with no cuts states nothing.",
    );
    return 0;
  }
  for (let i = 0; i < cuts.length; i++) {
    const cutPath = joinPath(joinPath(path, "cuts"), i);
    validateScriptCut(cuts[i], cutPath, c);
    // Cut ids are unique across the WHOLE script, not just within a beat, so a
    // later phase can name one cut without also naming its beat.
    const cut = cuts[i];
    if (isPlainObject(cut) && isNonEmptyString(cut.id)) {
      if (cutIds.has(cut.id)) {
        c.add(
          joinPath(cutPath, "id"),
          "script.cut.duplicate-id",
          `duplicate script cut id "${cut.id}".`,
        );
      }
      cutIds.add(cut.id);
    }
  }
  return cuts.length;
}

/** Validate an untrusted value as an episode script. */
export function validateEpisodeScriptValue(value: unknown, path: string, c: IssueCollector): void {
  if (!isPlainObject(value)) {
    c.add(path, "script.type", "an episode script must be an object.");
    return;
  }
  allowlistKeys(value, SCRIPT_KEYS, path, "script.unknown-key", c);
  if (value.scriptFormat !== EPISODE_SCRIPT_FORMAT_VERSION) {
    c.add(
      joinPath(path, "scriptFormat"),
      "script.format",
      `scriptFormat must be ${EPISODE_SCRIPT_FORMAT_VERSION}.`,
    );
  }
  if (!isNonEmptyString(value.episodeId)) {
    c.add(joinPath(path, "episodeId"), "field.required", "episodeId must be a non-empty string.");
  } else if (!isPathSafeId(value.episodeId)) {
    // The id becomes `script/episodes/<id>.json` on disk, so it must be a single
    // safe path segment — the same rule `Episode.id` is held to.
    c.add(
      joinPath(path, "episodeId"),
      "script.episode-id.unsafe",
      "episodeId must be a path-safe segment (no /, \\, NUL, or . / .. traversal).",
    );
  }
  if (!isRevisionId(value.briefRevision)) {
    c.add(
      joinPath(path, "briefRevision"),
      "script.brief-revision",
      "briefRevision must be the 64-character lowercase hex identity of the brief this script was written against.",
    );
  }
  const beats = value.beats;
  if (!isArray(beats) || beats.length === 0 || beats.length > SCRIPT_CUTS_MAX) {
    c.add(
      joinPath(path, "beats"),
      "script.beats",
      `beats must be an array of 1 to ${SCRIPT_CUTS_MAX} beats. A script with no beats describes no episode.`,
    );
    return;
  }
  const cutIds = new Set<string>();
  const beatIds = new Set<string>();
  let cuts = 0;
  for (let i = 0; i < beats.length; i++) {
    const beatPath = joinPath(joinPath(path, "beats"), i);
    cuts += validateScriptBeat(beats[i], beatPath, cutIds, c);
    const beat = beats[i];
    if (isPlainObject(beat) && isNonEmptyString(beat.id)) {
      if (beatIds.has(beat.id)) {
        c.add(
          joinPath(beatPath, "id"),
          "script.beat.duplicate-id",
          `duplicate beat id "${beat.id}".`,
        );
      }
      beatIds.add(beat.id);
    }
  }
  if (cuts > SCRIPT_CUTS_MAX) {
    c.add(
      joinPath(path, "beats"),
      "script.cuts",
      `a script may state ${SCRIPT_CUTS_MAX} cuts in all and this one states ${cuts}. A measured episode runs about a hundred panels.`,
    );
  }
}

/** Narrow a value that already passed `validateProductionBriefValue`. */
export function asProductionBrief(value: Record<string, unknown>): ProductionBrief {
  return value as unknown as ProductionBrief;
}

/** Narrow a value that already passed `validateEpisodeScriptValue`. */
export function asEpisodeScript(value: Record<string, unknown>): EpisodeScript {
  return value as unknown as EpisodeScript;
}
