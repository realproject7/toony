// Write a Toony project to disk in the canonical hybrid format.
//
// Validates the in-memory model with `@toony/schema` before writing, then emits
// JSON structural files and YAML content files plus the documented asset/export/
// log folders and the story-bible/style-guide documents. Output is deterministic
// (stable key order), so re-writing an unchanged project is byte-stable.

import { mkdir, writeFile } from "node:fs/promises";
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
  validateTransitionValue,
  validateWebtoonValue,
  type Webtoon,
} from "@toony/schema";
import { ProjectIoError } from "./errors.js";
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
  await writeFile(webtoonPath(root), encodeJson(webtoon), "utf8");
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
  await writeFile(letteringFile(root, episodeId), encodeJson(overlays), "utf8");
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
  await writeFile(cutsFile(root, episodeId), encodeYaml(cuts), "utf8");
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
  const cutIds = new Set<string>();
  for (const cut of cuts) {
    if (typeof cut?.id === "string" && cut.id.length > 0) cutIds.add(cut.id);
  }
  validateSequenceConsistency(episode.sequence, cutIds, transitionIds, "episode.sequence", c);

  const result = c.result();
  if (!result.valid) {
    const detail = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new ProjectIoError(`refusing to write invalid transitions: ${detail}`, episodeId);
  }

  // Validation passed: write both files (deterministic YAML).
  await writeFile(transitionsFile(root, episodeId), encodeYaml(transitions), "utf8");
  await writeFile(episodeFile(root, episodeId), encodeYaml(episode), "utf8");
}

/**
 * Enforce the sequence invariants the transition editor owns: every reference
 * resolves to a real record, no record is referenced twice or orphaned, and a
 * transition sits between two cuts (canonical webtoon reading rhythm). Mirrors
 * the cross-file checks `validateProject` runs, scoped to one episode so the
 * surgical writer can reject a bad edit before touching disk.
 */
function validateSequenceConsistency(
  sequence: Episode["sequence"],
  cutIds: Set<string>,
  transitionIds: Set<string>,
  path: string,
  c: IssueCollector,
): void {
  const seen = new Set<string>();
  const referencedCutIds = new Set<string>();
  const referencedTransitionIds = new Set<string>();
  const types: string[] = [];

  for (let i = 0; i < sequence.length; i++) {
    const item = sequence[i];
    const itemPath = `${path}[${i}]`;
    types.push(item?.type ?? "invalid");
    if (!item) continue;
    const id = item.id;
    if (typeof id !== "string" || id.length === 0) continue;

    if (seen.has(id)) {
      c.add(
        itemPath,
        "sequence.duplicate-reference",
        `sequence references id "${id}" more than once.`,
      );
    }
    seen.add(id);

    if (item.type === "cut") {
      referencedCutIds.add(id);
      if (!cutIds.has(id)) {
        c.add(
          itemPath,
          "sequence.missing-cut",
          `sequence references cut "${id}" with no matching cut record.`,
        );
      }
    } else if (item.type === "transition") {
      referencedTransitionIds.add(id);
      if (!transitionIds.has(id)) {
        c.add(
          itemPath,
          "sequence.missing-transition",
          `sequence references transition "${id}" with no matching transition record.`,
        );
      }
    }
  }

  for (const cutId of cutIds) {
    if (!referencedCutIds.has(cutId)) {
      c.add(path, "cut.orphan", `cut "${cutId}" is not referenced by the episode sequence.`);
    }
  }
  for (const transitionId of transitionIds) {
    if (!referencedTransitionIds.has(transitionId)) {
      c.add(
        path,
        "transition.orphan",
        `transition "${transitionId}" is not referenced by the episode sequence.`,
      );
    }
  }

  // Canonical shape: a transition must sit between two cuts.
  if (types.length === 0) {
    c.add(path, "sequence.empty", "episode sequence must contain at least one cut.");
    return;
  }
  if (types[0] === "transition") {
    c.add(
      path,
      "sequence.leading-transition",
      "episode sequence must not begin with a transition.",
    );
  }
  if (types[types.length - 1] === "transition") {
    c.add(path, "sequence.trailing-transition", "episode sequence must not end with a transition.");
  }
  for (let i = 1; i < types.length; i++) {
    if (types[i] === "transition" && types[i - 1] === "transition") {
      c.add(
        `${path}[${i}]`,
        "sequence.adjacent-transitions",
        "two transitions cannot be adjacent; a transition must sit between cuts.",
      );
    }
  }
}
