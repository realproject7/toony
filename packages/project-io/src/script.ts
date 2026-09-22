// Read and write a project's authored planning artifacts.
//
// `@toony/schema` owns the shapes and their structural validators; this module
// owns where they live on disk, the bytes they are persisted as, and the
// cross-artifact questions only a reader holding a filename and the rest of the
// project can answer.
//
// The split matches `reader.ts`: an IO or parse failure throws `ProjectIoError`;
// a schema problem and a cross-artifact disagreement come back in a
// `ValidationResult`. A missing file is neither — it is reported as absent, so a
// caller can tell "there is no brief" from "the brief is empty or malformed".
//
// A stale script still reads. When the brief has been edited, is gone, or
// cannot be used at all, the read says so against the field that records it and
// hands the script back anyway. Deciding what to do about it is a later phase's
// job, and it cannot decide anything about a file it cannot open.
//
// Cross-file resolution is NOT a write-time hard error here, the way
// `writer.ts` already states for a cut's character refs: an unresolved
// character id is reported to whoever reads, and the write still lands.

import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import {
  asEpisodeScript,
  asProductionBrief,
  type Character,
  type EpisodeScript,
  IssueCollector,
  joinPath,
  type ProductionBrief,
  type ValidationResult,
  validateEpisodeScriptValue,
  validateProductionBriefValue,
} from "@toony/schema";
import { atomicWrite } from "./atomic.js";
import { ProjectIoError } from "./errors.js";
import { decodeJson, encodeJson } from "./format.js";
import {
  BRIEF_FILE,
  briefPath,
  episodeScriptFile,
  SCRIPT_DIR,
  SCRIPT_EPISODES_DIR,
  SCRIPT_FILE_SUFFIX,
  scriptDir,
  scriptEpisodesDir,
} from "./paths.js";

/** Path a brief is validated under, and the root of every issue path it reports. */
const BRIEF_PATH = "brief";

/** Path a script is validated under, and the root of every issue path it reports. */
const SCRIPT_PATH = "script";

/**
 * The durable name of one artifact revision: the sha256 of the bytes this
 * package persists for it.
 *
 * It is computed over `encodeJson`'s canonical output — the exact bytes a write
 * puts on disk — so a byte-identical rewrite keeps the name and any difference
 * in content changes it. Re-formatting a file by hand does not: the identity
 * follows what the artifact says, not how it was typed. This is the identity
 * `ingest.ts` already computes for an asset's persisted bytes.
 */
export function revisionId(value: unknown): string {
  return createHash("sha256").update(encodeJson(value)).digest("hex");
}

function emptyResult(): ValidationResult {
  return new IssueCollector().result();
}

/**
 * One optional JSON file. `found` carries the absence rather than the value, so
 * a file whose whole content is `null` is still a file that exists.
 */
type OptionalJson = { found: false } | { found: true; value: unknown };

async function readJsonFile(file: string): Promise<OptionalJson> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException)?.code === "ENOENT") return { found: false };
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new ProjectIoError(`could not read ${file}: ${reason}`, file);
  }
  try {
    return { found: true, value: decodeJson(text) };
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new ProjectIoError(`invalid JSON in ${file}: ${reason}`, file);
  }
}

/** Outcome of reading `script/brief.json`. */
export interface LoadedBrief {
  /** The brief, or null when there is no file or the file does not validate. */
  brief: ProductionBrief | null;
  /** The brief's revision identity, or null when there is no valid brief. */
  revision: string | null;
  /** True only when no file exists, which tells absent apart from malformed. */
  absent: boolean;
  /** Schema issues. A project with no brief is valid with no issues. */
  validation: ValidationResult;
}

/**
 * Read the project's production brief. An absent file is not an error: it comes
 * back as `absent` with no issues, because a project is not required to carry
 * one. A present but unparsable file throws `ProjectIoError`; a present but
 * malformed one comes back with issues and a null brief.
 */
export async function readBrief(root: string): Promise<LoadedBrief> {
  const file = await readJsonFile(briefPath(root));
  if (!file.found) {
    return { brief: null, revision: null, absent: true, validation: emptyResult() };
  }
  const c = new IssueCollector();
  validateProductionBriefValue(file.value, BRIEF_PATH, c);
  const validation = c.result();
  if (!validation.valid) {
    return { brief: null, revision: null, absent: false, validation };
  }
  const brief = asProductionBrief(file.value as Record<string, unknown>);
  return { brief, revision: revisionId(brief), absent: false, validation };
}

/** Outcome of reading one `script/episodes/<episode-id>.json`. */
export interface LoadedEpisodeScript {
  /** The episode id the file was read for, taken from the filename. */
  episodeId: string;
  /** The script, or null when there is no file or the file does not validate. */
  script: EpisodeScript | null;
  /** The script's own revision identity, or null when there is no valid script. */
  revision: string | null;
  /** True only when no file exists. */
  absent: boolean;
  /** Schema issues plus every cross-artifact disagreement this read found. */
  validation: ValidationResult;
}

/** Collect the character ids a script cut may name: the registry plus the brief cast. */
function knownCharacterIds(
  characters: readonly Character[],
  brief: ProductionBrief | null,
): Set<string> {
  const known = new Set(characters.map((character) => character.id));
  for (const note of brief?.cast ?? []) known.add(note.characterId);
  return known;
}

/**
 * Report every character id in the script that resolves in neither the project
 * registry nor the brief cast, naming the id and the cut or beat that states it.
 *
 * Deduplicated per cut and per beat, the way the cut-level character lint
 * already deduplicates, so an id listed twice in one place is reported once.
 */
function reportUnknownCharacterRefs(
  script: EpisodeScript,
  known: Set<string>,
  c: IssueCollector,
): void {
  const beatsPath = joinPath(SCRIPT_PATH, "beats");
  for (let b = 0; b < script.beats.length; b++) {
    const beat = script.beats[b];
    if (beat === undefined) continue;
    const beatPath = joinPath(beatsPath, b);

    const beatSeen = new Set<string>();
    const goals = beat.goals ?? [];
    for (let g = 0; g < goals.length; g++) {
      const id = goals[g]?.characterId;
      if (id === undefined || known.has(id) || beatSeen.has(id)) continue;
      beatSeen.add(id);
      c.add(
        joinPath(joinPath(joinPath(beatPath, "goals"), g), "characterId"),
        "script.character.unknown-ref",
        `beat "${beat.id}" references unknown character "${id}"; add it to the project character registry or the brief cast, or remove the reference.`,
      );
    }

    for (let i = 0; i < beat.cuts.length; i++) {
      const cut = beat.cuts[i];
      if (cut === undefined) continue;
      const cutPath = joinPath(joinPath(beatPath, "cuts"), i);
      const cutSeen = new Set<string>();
      const refs: Array<{ id: string; path: string }> = [];
      const characters = cut.characters ?? [];
      for (let k = 0; k < characters.length; k++) {
        const id = characters[k];
        if (id !== undefined) refs.push({ id, path: joinPath(joinPath(cutPath, "characters"), k) });
      }
      const dialogue = cut.dialogue ?? [];
      for (let k = 0; k < dialogue.length; k++) {
        const speaker = dialogue[k]?.speaker;
        if (speaker !== undefined && speaker !== null) {
          refs.push({ id: speaker, path: joinPath(joinPath(cutPath, "dialogue"), k) });
        }
      }
      for (const ref of refs) {
        if (known.has(ref.id) || cutSeen.has(ref.id)) continue;
        cutSeen.add(ref.id);
        c.add(
          ref.path,
          "script.character.unknown-ref",
          `script cut "${cut.id}" references unknown character "${ref.id}"; add it to the project character registry or the brief cast, or remove the reference.`,
        );
      }
    }
  }
}

/** Report how the script's recorded brief revision stands against the current brief. */
function reportBriefRevision(script: EpisodeScript, brief: LoadedBrief, c: IssueCollector): void {
  const path = joinPath(SCRIPT_PATH, "briefRevision");
  if (brief.absent) {
    c.add(
      path,
      "script.brief-missing",
      `the script was written against brief revision "${script.briefRevision}" and the project has no ${SCRIPT_DIR}/${BRIEF_FILE}.`,
    );
    return;
  }
  if (brief.revision === null) {
    c.add(
      path,
      "script.brief-invalid",
      `the script was written against brief revision "${script.briefRevision}" and the current ${SCRIPT_DIR}/${BRIEF_FILE} cannot be read or does not validate, so the two cannot be compared.`,
    );
    return;
  }
  if (brief.revision !== script.briefRevision) {
    c.add(
      path,
      "script.brief-stale",
      `the script was written against brief revision "${script.briefRevision}" and the current brief is "${brief.revision}"; the script still reads, and what to do about the difference is not decided here.`,
    );
  }
}

/**
 * Read the brief the way an episode-script read needs it.
 *
 * By the time this runs the script has parsed and validated on its own, and an
 * edit somewhere else must not make it unreadable. A brief that cannot be
 * parsed is therefore not a throw here: it comes back in the shape an invalid
 * brief comes back in, present with no revision to compare against, and
 * `reportBriefRevision` says so against the field that records it. A direct
 * `readBrief` still throws, because there the unreadable file is the subject.
 */
async function readBriefForScript(root: string): Promise<LoadedBrief> {
  try {
    return await readBrief(root);
  } catch (cause) {
    if (!(cause instanceof ProjectIoError)) throw cause;
    return { brief: null, revision: null, absent: false, validation: emptyResult() };
  }
}

/**
 * Read one episode's script and check it against the rest of the project.
 *
 * `episodeId` is the filename, and the id recorded inside the file must agree
 * with it, so a copied or renamed file cannot silently describe a different
 * episode. `characters` is the project registry (`webtoon.characters`), passed
 * in rather than re-read here so this reader holds no opinion about
 * `webtoon.json`; the brief is read from its own named path because the script
 * records which revision of it the script was written against.
 *
 * Nothing here throws for a disagreement. An absent file, a stale brief, a
 * missing brief and an unresolved character id all come back in `validation`.
 */
export async function readEpisodeScript(
  root: string,
  episodeId: string,
  characters: readonly Character[],
): Promise<LoadedEpisodeScript> {
  const file = await readJsonFile(episodeScriptFile(root, episodeId));
  if (!file.found) {
    return { episodeId, script: null, revision: null, absent: true, validation: emptyResult() };
  }
  const c = new IssueCollector();
  validateEpisodeScriptValue(file.value, SCRIPT_PATH, c);
  if (c.length > 0) {
    return { episodeId, script: null, revision: null, absent: false, validation: c.result() };
  }

  const script = asEpisodeScript(file.value as Record<string, unknown>);
  if (script.episodeId !== episodeId) {
    c.add(
      joinPath(SCRIPT_PATH, "episodeId"),
      "script.episode-id-mismatch",
      `the file is ${SCRIPT_DIR}/${SCRIPT_EPISODES_DIR}/${episodeId}${SCRIPT_FILE_SUFFIX} and it records episodeId "${script.episodeId}"; the filename and the recorded id must name the same episode.`,
    );
  }

  const brief = await readBriefForScript(root);
  reportBriefRevision(script, brief, c);
  reportUnknownCharacterRefs(script, knownCharacterIds(characters, brief.brief), c);

  return { episodeId, script, revision: revisionId(script), absent: false, validation: c.result() };
}

function refuse(kind: string, result: ValidationResult, file: string): never {
  const detail = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
  throw new ProjectIoError(`refusing to write an invalid ${kind}: ${detail}`, file);
}

/**
 * Persist the project's production brief and return its revision identity.
 *
 * A brief can be written at any time, including when scripts already exist: an
 * input a revision cannot reach is not an input. Editing it never rewrites or
 * invalidates a script — every script keeps reading, and each one reports that
 * its recorded revision no longer matches.
 */
export async function writeBrief(root: string, brief: ProductionBrief): Promise<string> {
  const c = new IssueCollector();
  validateProductionBriefValue(brief, BRIEF_PATH, c);
  const result = c.result();
  if (!result.valid) refuse("production brief", result, briefPath(root));
  await mkdir(scriptDir(root), { recursive: true });
  await atomicWrite(briefPath(root), encodeJson(brief));
  return revisionId(brief);
}

/**
 * The fold two script ids share when a filesystem treats them as one filename.
 *
 * `isPathSafeId` accepts `ep-A` and `ep-a` alike, and it accepts the same text
 * written in two Unicode normalization forms. macOS APFS folds case and
 * normalization both, so either pair is one file there. Normalizing before
 * lowercasing folds both the same way.
 */
function foldScriptId(id: string): string {
  return id.normalize("NFC").toLowerCase();
}

/**
 * The persisted script id that `episodeId` folds onto, or null when none does.
 *
 * Writing a script whose id folds onto one already on disk would destroy that
 * one. The fold is compared HERE rather than left to the filesystem, so the
 * answer is the same on a filesystem that folds the two and on one that does
 * not.
 */
async function findIdCollision(dir: string, episodeId: string): Promise<string | null> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new ProjectIoError(`could not read ${dir}: ${reason}`, dir);
  }
  const fold = foldScriptId(episodeId);
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(SCRIPT_FILE_SUFFIX)) continue;
    const existing = entry.name.slice(0, -SCRIPT_FILE_SUFFIX.length);
    if (existing !== episodeId && foldScriptId(existing) === fold) return existing;
  }
  return null;
}

/**
 * Persist one episode's script and return its revision identity. The file is
 * named by the script's own `episodeId`, so the filename and the recorded id
 * cannot disagree on a write.
 *
 * The write touches only its own file and the folders it needs. Writing episode
 * 2's script never reads, rewrites or revalidates episode 1's, so a project
 * holds episodes of different lengths and different casts without any of them
 * constraining the others. A script may be written for an episode that does not
 * exist yet.
 *
 * Refused before any byte is written: a script that does not validate, and one
 * whose id folds onto a script already on disk.
 */
export async function writeEpisodeScript(root: string, script: EpisodeScript): Promise<string> {
  const c = new IssueCollector();
  validateEpisodeScriptValue(script, SCRIPT_PATH, c);
  const result = c.result();
  const dir = scriptEpisodesDir(root);
  if (!result.valid) refuse("episode script", result, dir);

  const collision = await findIdCollision(dir, script.episodeId);
  if (collision !== null) {
    throw new ProjectIoError(
      `refusing to write episode script "${script.episodeId}": once case and Unicode normalization are folded it collides with the existing script "${collision}"; on filesystems that fold either one (macOS APFS, Windows NTFS) both map to the same file and would overwrite each other.`,
      dir,
    );
  }

  await mkdir(dir, { recursive: true });
  await atomicWrite(episodeScriptFile(root, script.episodeId), encodeJson(script));
  return revisionId(script);
}
