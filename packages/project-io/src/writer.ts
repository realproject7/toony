// Write a Toony project to disk in the canonical hybrid format.
//
// Validates the in-memory model with `@toony/schema` before writing, then emits
// JSON structural files and YAML content files plus the documented asset/export/
// log folders and the story-bible/style-guide documents. Output is deterministic
// (stable key order), so re-writing an unchanged project is byte-stable.

import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type Cut,
  type Episode,
  IssueCollector,
  type LetteringOverlay,
  type Project,
  type Transition,
  validateCutValue,
  validateEpisodeValue,
  validateLetteringOverlayValue,
  validateProject,
  validateSequenceIntegrity,
  validateTransitionValue,
  validateWebtoonValue,
  type Webtoon,
} from "@toony/schema";
import { type AtomicFileWrite, atomicWrite } from "./atomic.js";
import { ProjectIoError } from "./errors.js";
import { decodeYaml, encodeJson, encodeYaml } from "./format.js";
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
  await atomicWrite(webtoonPath(root), encodeJson(project.webtoon));
  await atomicWrite(join(root, STORY_BIBLE_FILE), STORY_BIBLE_TEMPLATE);
  await atomicWrite(join(root, STYLE_GUIDE_FILE), STYLE_GUIDE_TEMPLATE);

  for (const bundle of project.episodes) {
    const id = bundle.episode.id;
    await mkdir(episodeDir(root, id), { recursive: true });
    for (const dir of EPISODE_DIRS) {
      await mkdir(join(episodeDir(root, id), dir), { recursive: true });
    }
    // Content files: YAML. Lettering: JSON.
    await atomicWrite(episodeFile(root, id), encodeYaml(bundle.episode));
    await atomicWrite(cutsFile(root, id), encodeYaml(bundle.cuts));
    await atomicWrite(transitionsFile(root, id), encodeYaml(bundle.transitions));
    await atomicWrite(letteringFile(root, id), encodeJson(bundle.lettering));
  }
}

/**
 * Persist the project root `webtoon.json`, validating it against `@toony/schema`
 * first and refusing to write if it is invalid. This is the surgical write path
 * the studio's character-registry UI (#102) uses to save `webtoon.characters`:
 * it touches only `webtoon.json` and leaves every episode file byte-stable.
 * Output is deterministic (sorted keys), so a no-op save re-emits identical bytes.
 *
 * Mirrors `writeCuts`/`writeLettering`: per-record schema conformance is enforced
 * here (the webtoon shape, including the character registry's id/name/lockstring
 * fields and unique character ids), which are the invariants `webtoon.json` alone
 * can own. Cross-file checks (e.g. whether a cut's character ref resolves) stay a
 * lint concern, not a write-time hard error.
 */
export async function writeWebtoon(root: string, webtoon: Webtoon): Promise<void> {
  const c = new IssueCollector();
  validateWebtoonValue(webtoon, "webtoon", c);
  const result = c.result();
  if (!result.valid) {
    const detail = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new ProjectIoError(`refusing to write invalid webtoon: ${detail}`, webtoon.projectId);
  }
  await atomicWrite(webtoonPath(root), encodeJson(webtoon));
}

/**
 * Persist one episode's lettering overlays to its `lettering.json`, validating
 * the full set against `@toony/schema` first and refusing to write if any
 * overlay is invalid. This is the surgical write path the focused cut editor
 * (#8) uses: it touches only the target episode's lettering file and leaves
 * every other file byte-stable. Output is deterministic (sorted keys), so a
 * no-op save re-emits identical bytes.
 *
 * Overlay ids must be unique within the set so edits target deterministically.
 * Callers are responsible for any cross-file checks (e.g. that each `cutId`
 * matches a real cut); this function enforces per-overlay schema conformance and
 * id uniqueness, which are the invariants the lettering file alone can own.
 */
export async function writeLettering(
  root: string,
  episodeId: string,
  overlays: LetteringOverlay[],
): Promise<void> {
  const c = new IssueCollector();
  const seen = new Set<string>();
  for (let i = 0; i < overlays.length; i++) {
    validateLetteringOverlayValue(overlays[i], `lettering[${i}]`, c);
    const id = overlays[i]?.id;
    if (typeof id === "string" && id.length > 0) {
      if (seen.has(id)) {
        c.add(`lettering[${i}].id`, "overlay.duplicate-id", `duplicate overlay id "${id}".`);
      }
      seen.add(id);
    }
  }
  const result = c.result();
  if (!result.valid) {
    const detail = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new ProjectIoError(`refusing to write invalid lettering: ${detail}`, episodeId);
  }
  await atomicWrite(letteringFile(root, episodeId), encodeJson(overlays));
}

/**
 * Persist one episode's cut records to its `cuts.yaml`, validating the full set
 * against `@toony/schema` first and refusing to write if any cut is invalid.
 * This is the surgical write path the focused cut editor (#8) uses to save
 * cut-level fields (e.g. `imagePrompt`/`negativePrompt`): it touches only the
 * target episode's cuts file and leaves every other file byte-stable. Output is
 * deterministic (sorted keys), so a no-op save re-emits identical bytes.
 *
 * Cut ids must be unique within the set so edits target deterministically.
 * Image-asset references are left as supplied; the editor only mutates cut-level
 * text fields, so the round-trip preserves existing image associations.
 */
export async function writeCuts(root: string, episodeId: string, cuts: Cut[]): Promise<void> {
  const c = new IssueCollector();
  const seen = new Set<string>();
  for (let i = 0; i < cuts.length; i++) {
    validateCutValue(cuts[i], `cuts[${i}]`, c);
    const id = cuts[i]?.id;
    if (typeof id === "string" && id.length > 0) {
      if (seen.has(id)) {
        c.add(`cuts[${i}].id`, "cut.duplicate-id", `duplicate cut id "${id}".`);
      }
      seen.add(id);
    }
  }
  const result = c.result();
  if (!result.valid) {
    const detail = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new ProjectIoError(`refusing to write invalid cuts: ${detail}`, episodeId);
  }
  await atomicWrite(cutsFile(root, episodeId), encodeYaml(cuts));
}

/**
 * Persist one episode's transitions and its reading sequence together: writes
 * the episode's `transitions.yaml` and the updated `episode.yaml`. This is the
 * surgical write path the transition editor (#9) uses — transitions are
 * first-class objects that live in `episode.sequence` between cuts, so the
 * transition records and the sequence that references them must be written as a
 * single consistent unit. Output is deterministic (sorted keys), so a no-op save
 * re-emits identical bytes, and only the two target files are touched.
 *
 * Both files are fully validated against `@toony/schema` BEFORE any byte is
 * written, and nothing is written if validation fails:
 *   - per-transition schema conformance (type, gutter range, nullable strings,
 *     project-relative image path, review status);
 *   - unique transition ids;
 *   - well-formed episode (schema version, id/title, sequence item shape);
 *   - sequence integrity against the supplied cuts AND transitions: every
 *     sequence entry references a real record, no record is referenced twice,
 *     no record is orphaned;
 *   - canonical sequence shape: a transition must sit BETWEEN two cuts (no
 *     leading/trailing transition, no two adjacent transitions).
 *
 * `cuts` is supplied (not written) so the sequence's `cut` references can be
 * checked without re-reading disk; the cuts file itself is left byte-stable.
 *
 * The two files are committed in a crash-safe order derived from the edit (see
 * `transitionCommitPlan`): after ANY single interrupted rename the persisted
 * episode sequence references only transition ids present in the persisted
 * `transitions.yaml`. The worst case is an orphaned record, which validation
 * reports non-fatally — never a dangling reference to a record that isn't on
 * disk. This is not a transaction (a crash can still leave the pair mid-commit),
 * but every reachable window is the benign direction.
 */
export async function writeTransitions(
  root: string,
  episodeId: string,
  episode: Episode,
  transitions: Transition[],
  cuts: Cut[],
): Promise<void> {
  const c = new IssueCollector();

  // Per-transition schema conformance + unique ids.
  const transitionIds = new Set<string>();
  for (let i = 0; i < transitions.length; i++) {
    validateTransitionValue(transitions[i], `transitions[${i}]`, c);
    const id = transitions[i]?.id;
    if (typeof id === "string" && id.length > 0) {
      if (transitionIds.has(id)) {
        c.add(
          `transitions[${i}].id`,
          "transition.duplicate-id",
          `duplicate transition id "${id}".`,
        );
      }
      transitionIds.add(id);
    }
  }

  // Well-formed episode (sequence item shapes, schema version, id/title).
  validateEpisodeValue(episode, "episode", c);

  // Cross-reference + canonical shape of the sequence against the real records.
  // Single-sourced from `@toony/schema` (#146): cut and transition ids are
  // independent namespaces, so a cut and a transition may share an id string —
  // the shared check keys duplicate-reference detection by kind, and this writer
  // no longer maintains its own (previously divergent) copy of the logic.
  const cutIds = new Set<string>();
  for (const cut of cuts) {
    if (typeof cut?.id === "string" && cut.id.length > 0) cutIds.add(cut.id);
  }
  validateSequenceIntegrity(episode, cutIds, transitionIds, "episode", c);

  const result = c.result();
  if (!result.valid) {
    const detail = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new ProjectIoError(`refusing to write invalid transitions: ${detail}`, episodeId);
  }

  // Validation passed. Commit the record file and the sequence file in the
  // crash-safe order this edit requires. Two independent renames cannot be
  // referentially safe for an edit that both ADDS and DELETES ids (either order
  // leaves one crash window with a dangling reference), so the order is derived
  // from the ids already on disk and may stage through a union record file. The
  // read below refuses the save (leaving every file intact) rather than guess an
  // ordering when the current records cannot be trusted — a wrong guess is what
  // would dangle. See `buildTransitionCommitSteps` / `transitionCommitPlan`.
  const transitionsPath = transitionsFile(root, episodeId);
  const episodePath = episodeFile(root, episodeId);
  const oldTransitions = await readTransitionsOnDisk(transitionsPath);

  const steps = buildTransitionCommitSteps({
    oldTransitions,
    transitions,
    episode,
    transitionsPath,
    episodePath,
  });
  for (const step of steps) {
    await atomicWrite(step.file, step.data);
  }
}

/** One rename in a transitions+episode commit: which file, with which records. */
export type TransitionCommitPhase = "transitions:new" | "transitions:union" | "episode";

/**
 * Decide the crash-safe rename order for a transitions+episode save from the
 * transition ids currently on disk (`oldIds`) versus the ids in the new record
 * set (`newIds`). Each returned phase is one atomic rename, executed in order.
 *
 * Invariant (the testable claim): after ANY single interrupted rename the
 * episode sequence references only transition ids present in the current
 * `transitions.yaml`; the worst case is an orphan record, reported non-fatally.
 *
 *   - Additions only (or a no-op): records first, then the sequence — the
 *     record file stays a superset of the OLD sequence's refs until the sequence
 *     catches up.
 *   - Deletions only: the sequence first, then prune the records — the record
 *     file stays a superset of the NEW sequence's refs until the prune.
 *   - Mixed add+delete: no two-rename order is safe (one window always drops an
 *     id the live sequence still references), so stage through a union: write
 *     records = old ∪ new, then the new sequence, then prune records to new.
 *     Every window sees a record file covering whichever sequence is live.
 */
export function transitionCommitPlan(
  oldIds: ReadonlySet<string>,
  newIds: ReadonlySet<string>,
): TransitionCommitPhase[] {
  let hasAdditions = false;
  let hasDeletions = false;
  for (const id of newIds) if (!oldIds.has(id)) hasAdditions = true;
  for (const id of oldIds) if (!newIds.has(id)) hasDeletions = true;

  if (hasAdditions && hasDeletions) return ["transitions:union", "episode", "transitions:new"];
  if (hasDeletions) return ["episode", "transitions:new"];
  return ["transitions:new", "episode"];
}

/**
 * Build the ordered, concrete atomic writes that commit a transitions+episode
 * save, given the transition records currently on disk. Pure (no IO):
 * `writeTransitions` runs each returned step as its own atomic rename, in order.
 * The order — and, for a mixed add+delete, the union staging step — comes from
 * `transitionCommitPlan`, so every interrupted-rename window is crash-safe.
 */
export function buildTransitionCommitSteps(input: {
  oldTransitions: readonly unknown[];
  transitions: Transition[];
  episode: Episode;
  transitionsPath: string;
  episodePath: string;
}): AtomicFileWrite[] {
  const { oldTransitions, transitions, episode, transitionsPath, episodePath } = input;
  const oldIds = collectTransitionIds(oldTransitions);
  const newIds = collectTransitionIds(transitions);
  const plan = transitionCommitPlan(oldIds, newIds);

  const newTransitionsData = encodeYaml(transitions);
  const episodeData = encodeYaml(episode);

  return plan.map((phase) => {
    if (phase === "episode") return { file: episodePath, data: episodeData };
    if (phase === "transitions:new") return { file: transitionsPath, data: newTransitionsData };
    // Union pass (mixed edits only): old ∪ new records, so the record file
    // covers whichever sequence — old or new — is live during a crash window.
    const deletedOld = oldTransitions.filter((t) => {
      const id = (t as { id?: unknown }).id;
      return typeof id === "string" && !newIds.has(id);
    });
    return { file: transitionsPath, data: encodeYaml([...transitions, ...deletedOld]) };
  });
}

/** Collect the non-empty string ids from a raw transition record list. */
function collectTransitionIds(records: readonly unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const record of records) {
    const id = (record as { id?: unknown }).id;
    if (typeof id === "string" && id.length > 0) ids.add(id);
  }
  return ids;
}

/** True when `cause` is a Node filesystem error carrying `code`. */
function hasErrnoCode(cause: unknown, code: string): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause as { code?: unknown }).code === code
  );
}

/**
 * Read the transition records currently on disk, used to classify the edit for
 * the crash-safe commit order. This must be TRUSTWORTHY, so it fails closed: a
 * genuinely absent file (`ENOENT`) is the one proven "first write" and yields
 * `[]` (every id is an addition → the safe records-first order). Any other read
 * error, or an unparseable / non-array file, throws `ProjectIoError` so the save
 * is refused with every file left intact — guessing `[]` there could pick a
 * records-first order for what is actually a deletion and dangle on a crash.
 */
async function readTransitionsOnDisk(file: string): Promise<unknown[]> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (cause) {
    if (hasErrnoCode(cause, "ENOENT")) return [];
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new ProjectIoError(
      `cannot read existing ${file} to choose a crash-safe write order: ${reason}`,
      file,
    );
  }

  let parsed: unknown;
  try {
    parsed = decodeYaml(text);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new ProjectIoError(
      `existing ${file} is unparseable, cannot choose a crash-safe write order: ${reason}`,
      file,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new ProjectIoError(
      `existing ${file} is not a transition list, cannot choose a crash-safe write order`,
      file,
    );
  }
  return parsed;
}
