// Compile an authored episode script into an episode draft, show what applying
// it would change, and apply it as a separate explicit step (#312).
//
// A draft is one complete, schema-valid `EpisodeBundle` plus the list of every
// required field the compiler filled from a default rather than from an authored
// artifact. It lives under `.toony/drafts/<episode-id>.json`, which is project
// local and NOT project data: `loadProject` walks only `episodes/`, so a draft
// is invisible to every shipped read path until it is applied.
//
// Three properties this module holds, each pinned by a test:
//
// - Compiling and reporting write nothing into the project. Only `applyDraft`
//   writes project data.
// - A conflict is a field apply would CHANGE on a record the project already
//   holds, or a record it would remove. Presence in the project is what makes a
//   record authored, because presence is the one thing the project always
//   records; the review marks and the recorded render inputs are reported as
//   the reason a conflict cannot be cleared by redrafting, not used to detect it.
// - Apply only ever adds records, so its writes go cuts, transitions,
//   lettering, sequence: after any single interrupted rename every reference on
//   disk resolves, and the worst window is an orphan the next apply clears.

import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  type Character,
  type Cut,
  type Episode,
  type EpisodeBundle,
  type EpisodeScript,
  IssueCollector,
  isPathSafeId,
  joinPath,
  type LetteringOverlay,
  type Project,
  SCHEMA_VERSION,
  type ScriptCut,
  type SequenceItem,
  type Transition,
  type ValidationIssue,
  type ValidationResult,
  validateEpisodeBundleRecords,
  validateProject,
} from "@toony/schema";
import { type AtomicFileWrite, atomicWrite, atomicWriteAll } from "./atomic.js";
import { CONFIG_DIR } from "./config.js";
import { ProjectIoError } from "./errors.js";
import { decodeJson, encodeJson, encodeYaml } from "./format.js";
import {
  cutsFile,
  EPISODE_DIRS,
  episodeDir,
  episodeFile,
  letteringFile,
  transitionsFile,
  webtoonPath,
} from "./paths.js";
import { loadProject } from "./reader.js";

/** Folder under `.toony/` holding one draft per episode id. */
export const DRAFTS_DIR = "drafts";

/** The format version a draft file declares. */
export const DRAFT_FORMAT_VERSION = 1;

/** The gap height a compiled transition takes when its script states none. */
export const DRAFT_DEFAULT_GUTTER_HEIGHT = 48;

/** The box a compiled overlay takes, stacked down the cut one line at a time. */
const DEFAULT_BOX = { x: 0.08, y: 0.07, width: 0.84, height: 0.16 } as const;
const BOX_STEP = 0.18;

export function draftsDir(root: string): string {
  return join(root, CONFIG_DIR, DRAFTS_DIR);
}

export function draftPath(root: string, episodeId: string): string {
  // The id is the only path segment derived from data here: refuse an unsafe
  // one before it is joined, as `episodeDir` does.
  if (!isPathSafeId(episodeId)) {
    throw new Error(`unsafe episode id: ${JSON.stringify(episodeId)}`);
  }
  return join(draftsDir(root), `${episodeId}.json`);
}

// --- The draft --------------------------------------------------------------

/** Which record a default or a change belongs to. */
export type DraftRecordKind = "cut" | "transition" | "overlay" | "episode";

/** One required field the compiler filled from a default, not from an author. */
export interface DraftDefault {
  kind: DraftRecordKind;
  id: string;
  field: string;
  value: unknown;
}

/** The bytes of the project files a report compared the draft against. */
export interface ProjectFingerprint {
  webtoon: string;
  episode: string | null;
  cuts: string | null;
  transitions: string | null;
  lettering: string | null;
}

/** One `.toony/drafts/<episode-id>.json`. */
export interface EpisodeDraft {
  draftFormat: number;
  episodeId: string;
  /** Revision identity of the script this draft was compiled from. */
  scriptRevision: string;
  /** Revision identity of the brief the script resolved against, if one read. */
  briefRevision: string | null;
  bundle: EpisodeBundle;
  defaults: DraftDefault[];
  /** The project state the last report compared against. Null until reported. */
  reviewedAgainst: ProjectFingerprint | null;
}

// --- Compile ----------------------------------------------------------------

export interface CompiledDraft {
  bundle: EpisodeBundle;
  defaults: DraftDefault[];
}

function box(line: number): LetteringOverlay["geometry"] {
  const y = Math.min(DEFAULT_BOX.y + line * BOX_STEP, 1 - DEFAULT_BOX.height);
  return { x: DEFAULT_BOX.x, y, width: DEFAULT_BOX.width, height: DEFAULT_BOX.height };
}

/**
 * Compile an authored script into a complete episode bundle.
 *
 * Every field the bundle carries has a stated source. Optional fields are
 * written only when the script states them. Required fields the script does not
 * state are filled from a default this module names, and every one is returned
 * in `defaults` with the record it was written on.
 *
 * The cut's `imagePrompt` is the script's scene text and nothing else. The story
 * bible, the character lockstrings and the palette clause compose on top of it at
 * generate time, on every run; writing them here would compound them.
 *
 * The production brief is not an input here. Its planning profile is prose
 * (#311), so there is no field a compiler could read a shape or a gap from, and
 * its cast notes carry no name. The script is the one authored source of every
 * record field; the brief's revision is recorded on the draft by the caller.
 *
 * Throws `ProjectIoError` for the one shape a script can state that no episode
 * can hold: a transition after its last cut. The sequence rule keeps a
 * transition between two cuts, and the message names the script field.
 */
export function compileEpisodeScript(script: EpisodeScript, project: Project): CompiledDraft {
  const episodeId = script.episodeId;
  const existing = project.episodes.find((bundle) => bundle.episode.id === episodeId);
  const names = new Map<string, string>(
    (project.webtoon.characters ?? []).map((character: Character) => [
      character.id,
      character.name,
    ]),
  );
  const defaults: DraftDefault[] = [];
  const cuts: Cut[] = [];
  const transitions: Transition[] = [];
  const lettering: LetteringOverlay[] = [];
  const sequence: SequenceItem[] = [];

  const scriptCuts: Array<{ cut: ScriptCut; path: string }> = [];
  script.beats.forEach((beat, b) => {
    beat.cuts.forEach((cut, i) => {
      scriptCuts.push({ cut, path: `beats[${b}].cuts[${i}]` });
    });
  });

  scriptCuts.forEach(({ cut: sc, path }, index) => {
    const cut: Cut = {
      id: sc.id,
      image: null,
      imagePrompt: sc.scene,
      negativePrompt: "",
      ...(sc.characters !== undefined ? { characters: [...sc.characters] } : {}),
      ...(sc.shotType !== undefined ? { shotType: sc.shotType } : {}),
      ...(sc.palette !== undefined ? { palette: sc.palette } : {}),
    };
    defaults.push({ kind: "cut", id: sc.id, field: "negativePrompt", value: "" });
    cuts.push(cut);
    sequence.push({ type: "cut", id: sc.id });

    (sc.dialogue ?? []).forEach((line, n) => {
      const id = `ov-${sc.id}-${n + 1}`;
      const kind = line.kind ?? (line.speaker === null ? "narration" : "speech");
      const speaker = line.speaker === null ? "" : (names.get(line.speaker) ?? line.speaker);
      const geometry = box(n);
      lettering.push({
        id,
        cutId: sc.id,
        speaker,
        kind,
        text: line.text,
        fill: "#ffffff",
        opacity: 1,
        border: null,
        tail: null,
        geometry,
        overflow: false,
        reviewStatus: "draft",
      });
      for (const [field, value] of [
        ["fill", "#ffffff"],
        ["opacity", 1],
        ["border", null],
        ["tail", null],
        ["geometry", geometry],
      ] as const) {
        defaults.push({ kind: "overlay", id, field, value });
      }
    });

    if (sc.transitionAfter !== undefined) {
      if (index === scriptCuts.length - 1) {
        throw new ProjectIoError(
          `script ${path}.transitionAfter: the last cut of an episode cannot carry a transition; a transition sits between two cuts.`,
          episodeId,
        );
      }
      const id = `tr-${sc.id}`;
      const gutterHeight = sc.transitionAfter.gutterHeight ?? DRAFT_DEFAULT_GUTTER_HEIGHT;
      if (sc.transitionAfter.gutterHeight === undefined) {
        defaults.push({ kind: "transition", id, field: "gutterHeight", value: gutterHeight });
      }
      transitions.push({
        id,
        type: sc.transitionAfter.type,
        gutterHeight,
        text: sc.transitionAfter.text ?? null,
        sfx: null,
        agentNote: null,
        humanNote: null,
        image: null,
        reviewStatus: "draft",
      });
      sequence.push({ type: "transition", id });
    }
  });

  let title: string;
  if (script.title !== undefined) {
    title = script.title;
  } else if (existing !== undefined) {
    title = existing.episode.title;
    defaults.push({ kind: "episode", id: episodeId, field: "title", value: title });
  } else {
    title = `Episode ${episodeId}`;
    defaults.push({ kind: "episode", id: episodeId, field: "title", value: title });
  }
  const episode: Episode = { schemaVersion: SCHEMA_VERSION, id: episodeId, title, sequence };

  return { bundle: { episode, cuts, transitions, lettering }, defaults };
}

/** The project as it would be with `bundle` applied, for validation and grading. */
export function projectWithDraft(project: Project, bundle: EpisodeBundle): Project {
  const others = project.episodes.filter((episode) => episode.episode.id !== bundle.episode.id);
  return { webtoon: project.webtoon, episodes: [...others, bundle] };
}

// --- Draft file -------------------------------------------------------------

export interface LoadedDraft {
  episodeId: string;
  /** The draft, or null when there is no file or the file does not validate. */
  draft: EpisodeDraft | null;
  absent: boolean;
  validation: ValidationResult;
}

function validateFingerprint(value: unknown, path: string, c: IssueCollector): void {
  if (value === null) return;
  if (typeof value !== "object" || Array.isArray(value)) {
    c.add(path, "draft.reviewed-against", "reviewedAgainst must be an object or null.");
    return;
  }
  const record = value as Record<string, unknown>;
  for (const key of ["webtoon", "episode", "cuts", "transitions", "lettering"] as const) {
    const digest = record[key];
    const ok =
      (key !== "webtoon" && digest === null) ||
      (typeof digest === "string" && /^[0-9a-f]{64}$/.test(digest));
    if (!ok) {
      c.add(joinPath(path, key), "draft.reviewed-against", `${key} must be a sha256 digest.`);
    }
  }
}

function validateDraftValue(value: unknown, episodeId: string, c: IssueCollector): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    c.add("draft", "draft.type", "a draft must be an object.");
    return;
  }
  const record = value as Record<string, unknown>;
  const allowed = [
    "draftFormat",
    "episodeId",
    "scriptRevision",
    "briefRevision",
    "bundle",
    "defaults",
    "reviewedAgainst",
  ];
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key))
      c.add(joinPath("draft", key), "draft.unknown-key", `unknown key: ${key}`);
  }
  if (record.draftFormat !== DRAFT_FORMAT_VERSION) {
    c.add("draft.draftFormat", "draft.format", `draftFormat must be ${DRAFT_FORMAT_VERSION}.`);
  }
  if (record.episodeId !== episodeId) {
    c.add(
      "draft.episodeId",
      "draft.episode-id-mismatch",
      `the file is the draft for "${episodeId}" and it records episodeId ${JSON.stringify(record.episodeId)}.`,
    );
  }
  if (typeof record.scriptRevision !== "string" || !/^[0-9a-f]{64}$/.test(record.scriptRevision)) {
    c.add("draft.scriptRevision", "draft.revision", "scriptRevision must be a sha256 digest.");
  }
  if (
    record.briefRevision !== null &&
    (typeof record.briefRevision !== "string" || !/^[0-9a-f]{64}$/.test(record.briefRevision))
  ) {
    c.add(
      "draft.briefRevision",
      "draft.revision",
      "briefRevision must be a sha256 digest or null.",
    );
  }
  if (typeof record.bundle !== "object" || record.bundle === null || Array.isArray(record.bundle)) {
    c.add("draft.bundle", "draft.bundle", "bundle must be an episode bundle.");
  } else {
    const bundle = record.bundle as Record<string, unknown>;
    validateEpisodeBundleRecords(bundle, "draft.bundle", c);
    const episode = bundle.episode as Record<string, unknown> | undefined;
    if (episode !== undefined && episode.id !== episodeId) {
      c.add(
        "draft.bundle.episode.id",
        "draft.episode-id-mismatch",
        `the bundle's episode id is ${JSON.stringify(episode.id)}, not "${episodeId}".`,
      );
    }
  }
  if (!Array.isArray(record.defaults)) {
    c.add("draft.defaults", "draft.defaults", "defaults must be an array.");
  }
  validateFingerprint(record.reviewedAgainst, "draft.reviewedAgainst", c);
}

/**
 * Read one episode's draft. An absent file is `absent`; a present file that is
 * unparsable throws `ProjectIoError`; a present file that does not validate
 * comes back with issues and a null draft, so a caller never acts on a draft it
 * cannot trust.
 */
export async function readDraft(root: string, episodeId: string): Promise<LoadedDraft> {
  const file = draftPath(root, episodeId);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { episodeId, draft: null, absent: true, validation: new IssueCollector().result() };
    }
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new ProjectIoError(`could not read ${file}: ${reason}`, file);
  }
  let value: unknown;
  try {
    value = decodeJson(text);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new ProjectIoError(`invalid JSON in ${file}: ${reason}`, file);
  }
  const c = new IssueCollector();
  validateDraftValue(value, episodeId, c);
  const validation = c.result();
  if (!validation.valid) return { episodeId, draft: null, absent: false, validation };
  return { episodeId, draft: value as EpisodeDraft, absent: false, validation };
}

/** Persist a draft. Writes only its own file under `.toony/drafts/`. */
export async function writeDraft(root: string, draft: EpisodeDraft): Promise<void> {
  const c = new IssueCollector();
  validateDraftValue(draft, draft.episodeId, c);
  const result = c.result();
  if (!result.valid) {
    const detail = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new ProjectIoError(`refusing to write an invalid draft: ${detail}`, draft.episodeId);
  }
  await mkdir(draftsDir(root), { recursive: true });
  await atomicWrite(draftPath(root, draft.episodeId), encodeJson(draft));
}

/**
 * Remove an episode's draft. Returns false when there was none. Touches only
 * the draft file; the project is never read or written.
 */
export async function removeDraft(root: string, episodeId: string): Promise<boolean> {
  const file = draftPath(root, episodeId);
  try {
    await rm(file);
    return true;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException)?.code === "ENOENT") return false;
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new ProjectIoError(`could not remove ${file}: ${reason}`, file);
  }
}

// --- Fingerprint ------------------------------------------------------------

async function digestFile(file: string): Promise<string | null> {
  try {
    return createHash("sha256")
      .update(await readFile(file))
      .digest("hex");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new ProjectIoError(`could not read ${file}: ${reason}`, file);
  }
}

/**
 * The bytes of every file an apply would read or replace for `episodeId`. A
 * report records this; apply refuses when it no longer matches, because a draft
 * reviewed against one project state must not land on another.
 */
export async function fingerprintEpisode(
  root: string,
  episodeId: string,
): Promise<ProjectFingerprint> {
  const webtoon = await digestFile(webtoonPath(root));
  if (webtoon === null) throw new ProjectIoError("project has no webtoon.json", webtoonPath(root));
  return {
    webtoon,
    episode: await digestFile(episodeFile(root, episodeId)),
    cuts: await digestFile(cutsFile(root, episodeId)),
    transitions: await digestFile(transitionsFile(root, episodeId)),
    lettering: await digestFile(letteringFile(root, episodeId)),
  };
}

/** True when two fingerprints describe the same bytes for every file. */
export function sameFingerprint(a: ProjectFingerprint, b: ProjectFingerprint): boolean {
  return (
    a.webtoon === b.webtoon &&
    a.episode === b.episode &&
    a.cuts === b.cuts &&
    a.transitions === b.transitions &&
    a.lettering === b.lettering
  );
}

// --- Diff -------------------------------------------------------------------

export interface FieldChange {
  field: string;
  current: unknown;
  drafted: unknown;
}

/** What the project records about who last wrote a record, for the report. */
export interface RecordMarks {
  reviewStatus?: string;
  imagePrompt?: string;
  negativePrompt?: string;
  imageSeed?: number;
  imageWorkflow?: string;
}

export interface ChangedRecord {
  kind: Exclude<DraftRecordKind, "episode">;
  id: string;
  changes: FieldChange[];
  marks: RecordMarks;
}

export interface RemovedRecord {
  kind: Exclude<DraftRecordKind, "episode">;
  id: string;
  marks: RecordMarks;
}

export interface KindCounts {
  added: number;
  changed: number;
  removed: number;
  unchanged: number;
}

export interface SequenceDiff {
  /** `new` when the episode does not exist yet. */
  status: "new" | "unchanged" | "extended" | "conflict";
  /** Entries the draft adds. */
  added: number;
  /** Entries the project has that the draft drops, as `type:id`. */
  removed: string[];
  /** True when the entries both hold appear in a different relative order. */
  reordered: boolean;
}

export interface DraftDiff {
  episodeId: string;
  episodeExists: boolean;
  counts: Record<"cut" | "transition" | "overlay", KindCounts>;
  added: Array<{ kind: Exclude<DraftRecordKind, "episode">; id: string }>;
  changed: ChangedRecord[];
  removed: RemovedRecord[];
  sequence: SequenceDiff;
  title: FieldChange | null;
}

function canonical(value: unknown): string {
  return value === undefined ? "absent" : encodeJson(value);
}

function fieldChanges(current: object, drafted: object): FieldChange[] {
  const keys = new Set([...Object.keys(current), ...Object.keys(drafted)]);
  const changes: FieldChange[] = [];
  for (const field of [...keys].sort()) {
    const a = (current as Record<string, unknown>)[field];
    const b = (drafted as Record<string, unknown>)[field];
    if (canonical(a) !== canonical(b)) changes.push({ field, current: a, drafted: b });
  }
  return changes;
}

function marksOf(record: Cut | Transition | LetteringOverlay): RecordMarks {
  const marks: RecordMarks = {};
  if (record.reviewStatus !== undefined) marks.reviewStatus = record.reviewStatus;
  if ("imagePrompt" in record) {
    const cut = record as Cut;
    marks.imagePrompt = cut.imagePrompt;
    marks.negativePrompt = cut.negativePrompt;
    if (cut.imageSeed !== undefined) marks.imageSeed = cut.imageSeed;
    if (cut.imageWorkflow !== undefined) marks.imageWorkflow = cut.imageWorkflow;
  }
  return marks;
}

function diffRecords<T extends Cut | Transition | LetteringOverlay>(
  kind: Exclude<DraftRecordKind, "episode">,
  current: readonly T[],
  drafted: readonly T[],
  diff: DraftDiff,
): void {
  const byId = new Map(current.map((record) => [record.id, record]));
  const seen = new Set<string>();
  for (const record of drafted) {
    const existing = byId.get(record.id);
    seen.add(record.id);
    if (existing === undefined) {
      diff.counts[kind].added++;
      diff.added.push({ kind, id: record.id });
      continue;
    }
    const changes = fieldChanges(existing, record);
    if (changes.length === 0) {
      diff.counts[kind].unchanged++;
    } else {
      diff.counts[kind].changed++;
      diff.changed.push({ kind, id: record.id, changes, marks: marksOf(existing) });
    }
  }
  for (const record of current) {
    if (seen.has(record.id)) continue;
    diff.counts[kind].removed++;
    diff.removed.push({ kind, id: record.id, marks: marksOf(record) });
  }
}

function sequenceKey(item: SequenceItem): string {
  return `${item.type}:${item.id}`;
}

function diffSequence(
  current: readonly SequenceItem[] | null,
  drafted: readonly SequenceItem[],
): SequenceDiff {
  if (current === null) {
    return { status: "new", added: drafted.length, removed: [], reordered: false };
  }
  const draftedKeys = drafted.map(sequenceKey);
  const draftedSet = new Set(draftedKeys);
  const currentKeys = current.map(sequenceKey);
  const removed = currentKeys.filter((key) => !draftedSet.has(key));
  const kept = currentKeys.filter((key) => draftedSet.has(key));
  const keptInDraftOrder = draftedKeys.filter((key) => kept.includes(key));
  const reordered = kept.join("\n") !== keptInDraftOrder.join("\n");
  const added = draftedKeys.filter((key) => !currentKeys.includes(key)).length;
  let status: SequenceDiff["status"];
  if (removed.length > 0 || reordered) status = "conflict";
  else if (added > 0) status = "extended";
  else status = "unchanged";
  return { status, added, removed, reordered };
}

/** What applying `bundle` would change, against the episode the project holds now. */
export function diffDraft(bundle: EpisodeBundle, existing: EpisodeBundle | null): DraftDiff {
  const zero = (): KindCounts => ({ added: 0, changed: 0, removed: 0, unchanged: 0 });
  const diff: DraftDiff = {
    episodeId: bundle.episode.id,
    episodeExists: existing !== null,
    counts: { cut: zero(), transition: zero(), overlay: zero() },
    added: [],
    changed: [],
    removed: [],
    sequence: diffSequence(existing?.episode.sequence ?? null, bundle.episode.sequence),
    title:
      existing !== null && existing.episode.title !== bundle.episode.title
        ? { field: "title", current: existing.episode.title, drafted: bundle.episode.title }
        : null,
  };
  diffRecords("cut", existing?.cuts ?? [], bundle.cuts, diff);
  diffRecords("transition", existing?.transitions ?? [], bundle.transitions, diff);
  diffRecords("overlay", existing?.lettering ?? [], bundle.lettering, diff);
  return diff;
}

/** One reason an apply refuses: a field it would change, or a record it would drop. */
export interface DraftConflict {
  kind: DraftRecordKind;
  id: string;
  field: string;
  current: unknown;
  drafted: unknown;
  marks: RecordMarks;
}

/**
 * Every conflict a diff carries. Any one of them refuses the whole apply, and
 * they are all reported, because an operator decides from the list.
 */
export function draftConflicts(diff: DraftDiff): DraftConflict[] {
  const conflicts: DraftConflict[] = [];
  for (const record of diff.changed) {
    for (const change of record.changes) {
      conflicts.push({ kind: record.kind, id: record.id, ...change, marks: record.marks });
    }
  }
  for (const record of diff.removed) {
    conflicts.push({
      kind: record.kind,
      id: record.id,
      field: "(record)",
      current: "present",
      drafted: "removed",
      marks: record.marks,
    });
  }
  if (diff.title !== null) {
    conflicts.push({ kind: "episode", id: diff.episodeId, ...diff.title, marks: {} });
  }
  if (diff.sequence.status === "conflict") {
    conflicts.push({
      kind: "episode",
      id: diff.episodeId,
      field: "sequence",
      current:
        diff.sequence.removed.length > 0
          ? `holds ${diff.sequence.removed.join(", ")}`
          : "its current order",
      drafted: diff.sequence.removed.length > 0 ? "drops them" : "reorders them",
      marks: {},
    });
  }
  return conflicts;
}

// --- Apply ------------------------------------------------------------------

/**
 * The ordered atomic writes that apply `bundle`. Pure; `applyDraft` runs them.
 *
 * Apply only ever ADDS records (a change or a removal is a conflict and never
 * reaches here), so one order is referentially safe at every interrupted
 * rename: cuts first, because overlays and the sequence name them; transitions
 * next, because the sequence names them; lettering, which names only cuts; the
 * sequence last. Each window therefore holds a record file that is a superset
 * of what the live sequence and the live overlays reference. The worst case is
 * an orphan record, which validation reports non-fatally and a re-run clears.
 */
export function draftCommitSteps(root: string, bundle: EpisodeBundle): AtomicFileWrite[] {
  const id = bundle.episode.id;
  return [
    { file: cutsFile(root, id), data: encodeYaml(bundle.cuts) },
    { file: transitionsFile(root, id), data: encodeYaml(bundle.transitions) },
    { file: letteringFile(root, id), data: encodeJson(bundle.lettering) },
    { file: episodeFile(root, id), data: encodeYaml(bundle.episode) },
  ];
}

export type ApplyRefusal =
  | { reason: "draft-missing" }
  | { reason: "draft-invalid"; issues: ValidationIssue[] }
  | { reason: "project-invalid"; issues: ValidationIssue[] }
  | { reason: "project-changed" }
  | { reason: "conflicts"; conflicts: DraftConflict[] }
  | { reason: "result-invalid"; issues: ValidationIssue[] };

export interface ApplyResult {
  episodeId: string;
  applied: boolean;
  /** True when the apply created the episode directory. */
  created: boolean;
  diff: DraftDiff | null;
  refusal: ApplyRefusal | null;
}

/**
 * Apply an episode's draft. Refuses, writing nothing, when there is no valid
 * draft, when the project does not validate, when the project changed since
 * the draft was last reported, when any conflict is present, or when the
 * project would not validate afterwards. There is no force flag.
 */
export async function applyDraft(root: string, episodeId: string): Promise<ApplyResult> {
  const refuse = (refusal: ApplyRefusal, diff: DraftDiff | null = null): ApplyResult => ({
    episodeId,
    applied: false,
    created: false,
    diff,
    refusal,
  });

  const loadedDraft = await readDraft(root, episodeId);
  if (loadedDraft.absent) return refuse({ reason: "draft-missing" });
  if (loadedDraft.draft === null) {
    return refuse({ reason: "draft-invalid", issues: loadedDraft.validation.issues });
  }
  const draft = loadedDraft.draft;

  const loaded = await loadProject(root);
  if (!loaded.validation.valid) {
    return refuse({ reason: "project-invalid", issues: loaded.validation.issues });
  }

  const now = await fingerprintEpisode(root, episodeId);
  if (draft.reviewedAgainst === null || !sameFingerprint(draft.reviewedAgainst, now)) {
    return refuse({ reason: "project-changed" });
  }

  const existing =
    loaded.project.episodes.find((bundle) => bundle.episode.id === episodeId) ?? null;
  const diff = diffDraft(draft.bundle, existing);
  const conflicts = draftConflicts(diff);
  if (conflicts.length > 0) return refuse({ reason: "conflicts", conflicts }, diff);

  const result = validateProject(projectWithDraft(loaded.project, draft.bundle));
  if (!result.valid) return refuse({ reason: "result-invalid", issues: result.issues }, diff);

  const created = existing === null;
  if (created) {
    await mkdir(episodeDir(root, episodeId), { recursive: true });
    for (const dir of EPISODE_DIRS) {
      await mkdir(join(episodeDir(root, episodeId), dir), { recursive: true });
    }
  }
  await atomicWriteAll(draftCommitSteps(root, draft.bundle));
  return { episodeId, applied: true, created, diff, refusal: null };
}
