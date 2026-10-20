// Episodes: create one from an episode script (compiled and applied exactly as
// `toony draft compile` + `toony draft apply` would), create a blank one,
// rename one, delete one. New episodes always get the next zero-padded id.

import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { compileEpisodeDraft } from "@toony/authoring";
import {
  applyDraft,
  atomicWrite,
  atomicWriteAll,
  draftCommitSteps,
  EPISODE_DIRS,
  encodeYaml,
  episodeDir,
  episodeFile,
  nextEpisodeId,
  readBrief,
  revisionId,
  writeEpisodeScript,
} from "@toony/project-io";
import {
  type Cut,
  EPISODE_SCRIPT_FORMAT_VERSION,
  type EpisodeBundle,
  type EpisodeScript,
  IssueCollector,
  SCHEMA_VERSION,
  type ScriptBeat,
  type ScriptContinuity,
  validateEpisodeScriptValue,
  validateEpisodeValue,
} from "@toony/schema";
import type { ProjectChange } from "../agent/protocol.js";
import { discoverStudioPacks } from "../packs.js";
import { OpError } from "./errors.js";
import { episodeLabel, findEpisode } from "./labels.js";
import { assertSafeId, episodeFiles, projectPath } from "./paths.js";
import { cleanTitle } from "./works.js";
import { type OpContext, type WriteContext, withProjectWrite } from "./write.js";

/** An episode script as an agent writes it. Ids and format fields are filled in. */
export interface EpisodeScriptInput {
  title?: string;
  continuity?: ScriptContinuity;
  beats: Array<
    Omit<ScriptBeat, "id" | "cuts"> & {
      id?: string;
      cuts: Array<Omit<ScriptBeat["cuts"][number], "id"> & { id?: string }>;
    }
  >;
}

export interface CreatedEpisode {
  episodeId: string;
  title: string;
  cutIds: string[];
  /** Plain-sentence notes from the script reader and the lints a draft can run. */
  notes: string[];
  change: ProjectChange | null;
}

function existingIds(tx: WriteContext): string[] {
  return tx.before.project.episodes.map((bundle) => bundle.episode.id);
}

/** Fill the mechanical fields of a script: format, id, brief revision, beat and cut ids. */
function completeScript(
  input: EpisodeScriptInput,
  episodeId: string,
  title: string,
  briefRevision: string,
): EpisodeScript {
  let cutNumber = 0;
  const beats = (Array.isArray(input.beats) ? input.beats : []).map((beat, b) => ({
    ...beat,
    id: beat.id ?? `beat-${b + 1}`,
    cuts: (Array.isArray(beat.cuts) ? beat.cuts : []).map((cut) => {
      cutNumber += 1;
      return { ...cut, id: cut.id ?? `cut-${String(cutNumber).padStart(3, "0")}` };
    }),
  }));
  return {
    scriptFormat: EPISODE_SCRIPT_FORMAT_VERSION,
    episodeId,
    briefRevision,
    title,
    ...(input.continuity === undefined ? {} : { continuity: input.continuity }),
    beats,
  } as EpisodeScript;
}

function scriptProblem(script: EpisodeScript): string | null {
  const c = new IssueCollector();
  validateEpisodeScriptValue(script, "script", c);
  const result = c.result();
  if (result.valid) return null;
  const shown = result.issues
    .slice(0, 4)
    .map((issue) => `${issue.path.replace(/^script\./, "")}: ${issue.message}`);
  return `The episode script is not valid. ${shown.join(" ")}`;
}

/**
 * Create a new episode from a script: write `script/episodes/<id>.json`,
 * compile it with the shared authoring orchestration (project lettering theme,
 * validation, lints, geometry) and apply the draft as a new episode.
 */
export async function createEpisode(
  ctx: OpContext,
  input: { title?: string; script: EpisodeScriptInput },
): Promise<CreatedEpisode> {
  if (!input.script || typeof input.script !== "object" || !Array.isArray(input.script.beats)) {
    throw new OpError("invalid", "Give the episode script with at least one beat of cuts.");
  }
  const pending: Partial<CreatedEpisode> = {};
  const { change } = await withProjectWrite(
    ctx,
    { summary: "Created an episode", scopes: [{ kind: "episodes" }] },
    async (tx) => {
      const episodeId = nextEpisodeId(existingIds(tx));
      const files = episodeFiles(episodeId);
      await tx.track([files.folder], "tree");
      await tx.track([files.script, files.draft]);
      tx.addScope({ kind: "episode", episodeId });
      const number = Number(episodeId.slice(3));
      const title = cleanTitle(
        input.title ?? input.script.title ?? `Episode ${number}`,
        "episode title",
      );
      const brief = await readBrief(tx.root).catch(() => null);
      // With no usable brief the script records the revision of "no brief";
      // the reader then reports the brief as missing, which is the truth.
      const script = completeScript(
        input.script,
        episodeId,
        title,
        brief?.revision ?? revisionId(null),
      );
      const problem = scriptProblem(script);
      if (problem !== null) throw new OpError("invalid", problem);
      await writeEpisodeScript(tx.root, script);
      const packs = await discoverStudioPacks(tx.root);
      const compiled = await compileEpisodeDraft({
        root: tx.root,
        episodeId,
        loaded: tx.before,
        letteringThemes: packs.content.letteringThemes,
      });
      if (!compiled.ok) {
        const detail =
          "issues" in compiled
            ? compiled.issues
                .slice(0, 4)
                .map((issue) => issue.message)
                .join(" ")
            : "message" in compiled
              ? compiled.message
              : "The script could not be read.";
        throw new OpError("invalid", `The episode could not be built from this script. ${detail}`);
      }
      const applied = await applyDraft(tx.root, episodeId);
      if (!applied.applied) {
        throw new OpError("conflict", "The episode could not be added. Try again.");
      }
      tx.setSummary(`Created ${title} (${compiled.bundle.cuts.length} cuts)`);
      pending.episodeId = episodeId;
      pending.title = title;
      pending.cutIds = compiled.bundle.cuts.map((cut) => cut.id);
      pending.notes = [
        ...compiled.scriptWarnings.map((issue) => issue.message),
        ...compiled.findings.map((finding) => finding.message),
      ];
    },
  );
  return {
    episodeId: pending.episodeId ?? "",
    title: pending.title ?? "",
    cutIds: pending.cutIds ?? [],
    notes: pending.notes ?? [],
    change,
  };
}

export const BLANK_CUTS_MAX = 200;

/** Create an episode with `cuts` empty cuts (no art, no lettering) and no transitions. */
export async function createBlankEpisode(
  ctx: OpContext,
  input: { title?: string; cuts?: number } = {},
): Promise<{ episodeId: string; title: string; change: ProjectChange | null }> {
  const count = input.cuts ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > BLANK_CUTS_MAX) {
    throw new OpError("invalid", `Choose between 1 and ${BLANK_CUTS_MAX} cuts.`);
  }
  let created = { episodeId: "", title: "" };
  const { change } = await withProjectWrite(
    ctx,
    { summary: "Created an episode", scopes: [{ kind: "episodes" }] },
    async (tx) => {
      const episodeId = nextEpisodeId(existingIds(tx));
      await tx.track([episodeFiles(episodeId).folder], "tree");
      tx.addScope({ kind: "episode", episodeId });
      const title = cleanTitle(
        input.title ?? `Episode ${Number(episodeId.slice(3))}`,
        "episode title",
      );
      const cuts: Cut[] = Array.from({ length: count }, (_, i) => ({
        id: `cut-${String(i + 1).padStart(3, "0")}`,
        image: null,
        imagePrompt: "",
        negativePrompt: "",
      }));
      const bundle: EpisodeBundle = {
        episode: {
          schemaVersion: SCHEMA_VERSION,
          id: episodeId,
          title,
          sequence: cuts.map((cut) => ({ type: "cut" as const, id: cut.id })),
        },
        cuts,
        transitions: [],
        lettering: [],
      };
      for (const dir of EPISODE_DIRS) {
        await mkdir(join(episodeDir(tx.root, episodeId), dir), { recursive: true });
      }
      await atomicWriteAll(draftCommitSteps(tx.root, bundle));
      tx.setSummary(`Created ${title} with ${count} ${count === 1 ? "cut" : "cuts"}`);
      created = { episodeId, title };
    },
  );
  return { ...created, change };
}

/** Rename an episode. Only `episode.yaml` changes. */
export async function renameEpisode(
  ctx: OpContext,
  episodeId: string,
  title: string,
): Promise<ProjectChange | null> {
  assertSafeId(episodeId, "episode");
  const clean = cleanTitle(title, "episode title");
  const { change } = await withProjectWrite(
    ctx,
    {
      summary: `Renamed an episode to "${clean}"`,
      scopes: [{ kind: "episode", episodeId }],
      files: [episodeFiles(episodeId).episode],
    },
    async (tx) => {
      const bundle = findEpisode(tx.before, episodeId);
      if (bundle === undefined) throw new OpError("not-found", "This episode does not exist.");
      if (bundle.episode.title === clean) return;
      const episode = { ...bundle.episode, title: clean };
      const c = new IssueCollector();
      validateEpisodeValue(episode, "episode", c);
      if (!c.result().valid) throw new OpError("invalid", "That episode title cannot be saved.");
      tx.setSummary(`Renamed ${episodeLabel(bundle, episodeId)} to "${clean}"`);
      await atomicWrite(episodeFile(tx.root, episodeId), encodeYaml(episode));
    },
  );
  return change;
}

/**
 * Delete an episode with its folder (records, art, exports), its script and its
 * draft. Undo restores all of it.
 */
export async function deleteEpisode(
  ctx: OpContext,
  episodeId: string,
): Promise<ProjectChange | null> {
  assertSafeId(episodeId, "episode");
  const files = episodeFiles(episodeId);
  const { change } = await withProjectWrite(
    ctx,
    {
      summary: "Deleted an episode",
      scopes: [{ kind: "episodes" }, { kind: "episode", episodeId }],
      trees: [files.folder],
      files: [files.script, files.draft],
    },
    async (tx) => {
      const bundle = findEpisode(tx.before, episodeId);
      if (bundle === undefined) throw new OpError("not-found", "This episode does not exist.");
      tx.setSummary(`Deleted ${episodeLabel(bundle, episodeId)}`);
      for (const path of [files.folder, files.script, files.draft]) {
        await rm(projectPath(tx.root, path), { recursive: true, force: true });
      }
    },
  );
  return change;
}
