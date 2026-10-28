// Server-side view-model for the Script page (#330, #331): the authored brief
// and episode script as the readers report them, the episode's draft with the
// SAME diff `toony draft show` prints, and the apply and discard actions the
// page's one button posts.
//
// Nothing here computes a second diff or a second apply. `loadDraftView` calls
// `diffDraft` and `draftConflicts` from `@toony/project-io`, which is what the
// CLI calls, so the two reports cannot disagree. `applyFromStudio` mirrors
// `toony draft show` followed by `toony draft apply`: it records the project
// state the person reviewed and then runs the shipped `applyDraft`, which still
// refuses on every conflict and on a project that moved since. All IO and every
// path derivation stay in project-io; this module receives an absolute work root
// the route resolved path-safely and never joins raw input into a path.

import {
  type ApplyResult,
  applyDraft,
  type DraftConflict,
  type DraftDiff,
  diffDraft,
  draftConflicts,
  fingerprintEpisode,
  type LoadedBrief,
  type LoadedDraft,
  type LoadedEpisodeScript,
  type ProjectFingerprint,
  ProjectIoError,
  readBrief,
  readDraft,
  readEpisodeScript,
  removeDraft,
  sameFingerprint,
  writeDraft,
} from "@toony/project-io";
import { type Character, type EpisodeBundle, isPathSafeId } from "@toony/schema";
import type { ProjectChange } from "./agent/protocol.js";
import { type ActorInfo, contextFor } from "./ops/context.js";
import { episodeLabel, findEpisode } from "./ops/labels.js";
import { episodeFiles } from "./ops/paths.js";
import { withProjectWrite } from "./ops/write.js";

// --- Script -----------------------------------------------------------------

export interface ScriptView {
  /** The brief, or null when its file cannot be parsed at all. */
  brief: LoadedBrief | null;
  /** The script read, or null when its file cannot be parsed at all. */
  script: LoadedEpisodeScript | null;
  /** Set when a file exists but is not JSON; the readers throw for that case. */
  unreadable: Array<"brief" | "script">;
}

/** Read the brief and one episode's script the way the CLI readers do. */
export async function loadScriptView(
  root: string,
  episodeId: string,
  characters: readonly Character[],
): Promise<ScriptView> {
  const unreadable: Array<"brief" | "script"> = [];
  let brief: LoadedBrief | null = null;
  try {
    brief = await readBrief(root);
  } catch (cause) {
    if (!(cause instanceof ProjectIoError)) throw cause;
    unreadable.push("brief");
  }
  let script: LoadedEpisodeScript | null = null;
  try {
    script = await readEpisodeScript(root, episodeId, characters);
  } catch (cause) {
    if (!(cause instanceof ProjectIoError)) throw cause;
    unreadable.push("script");
  }
  return { brief, script, unreadable };
}

/** The brief alone, for the dashboard card. */
export async function loadBriefView(
  root: string,
): Promise<{ brief: LoadedBrief | null; unreadable: boolean }> {
  try {
    return { brief: await readBrief(root), unreadable: false };
  } catch (cause) {
    if (!(cause instanceof ProjectIoError)) throw cause;
    return { brief: null, unreadable: true };
  }
}

// --- Draft ------------------------------------------------------------------

export interface DraftView {
  /** The draft read, or null when its file cannot be parsed at all. */
  draft: LoadedDraft | null;
  unreadable: boolean;
  /** The diff against the episode as the project holds it now, when a valid draft exists. */
  diff: DraftDiff | null;
  conflicts: DraftConflict[];
  /** The project state this view was rendered against; apply posts it back. */
  fingerprint: ProjectFingerprint;
}

/**
 * The draft and its diff for one episode. `existing` is the episode bundle the
 * loaded project holds, or null when the episode does not exist yet.
 */
export async function loadDraftView(
  root: string,
  episodeId: string,
  existing: EpisodeBundle | null,
): Promise<DraftView> {
  const fingerprint = await fingerprintEpisode(root, episodeId);
  let draft: LoadedDraft | null = null;
  let unreadable = false;
  try {
    draft = await readDraft(root, episodeId);
  } catch (cause) {
    if (!(cause instanceof ProjectIoError)) throw cause;
    unreadable = true;
  }
  if (draft === null || draft.draft === null) {
    return { draft, unreadable, diff: null, conflicts: [], fingerprint };
  }
  const diff = diffDraft(draft.draft.bundle, existing);
  return { draft, unreadable, diff, conflicts: draftConflicts(diff), fingerprint };
}

// --- Actions ----------------------------------------------------------------

export interface DraftActionPayload {
  workId: string;
  episodeId: string;
  action: "apply" | "discard";
  /** For `apply`: the fingerprint the page rendered its diff against. */
  reviewedAgainst?: ProjectFingerprint;
}

function isFingerprint(value: unknown): value is ProjectFingerprint {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const digest = (d: unknown, nullable: boolean) =>
    (nullable && d === null) || (typeof d === "string" && /^[0-9a-f]{64}$/.test(d));
  return (
    digest(v.webtoon, false) &&
    digest(v.episode, true) &&
    digest(v.cuts, true) &&
    digest(v.transitions, true) &&
    digest(v.lettering, true)
  );
}

export function isDraftActionPayload(value: unknown): value is DraftActionPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.workId !== "string" || typeof v.episodeId !== "string") return false;
  if (v.action !== "apply" && v.action !== "discard") return false;
  if (v.action === "apply" && !isFingerprint(v.reviewedAgainst)) return false;
  return true;
}

/**
 * Apply the episode's draft from the page the person reviewed, through the
 * project write path (lock, undo snapshot of the episode folder, journal, live
 * event).
 *
 * The page rendered its diff against `reviewedAgainst`. When the project still
 * matches, that state is recorded on the draft (what `toony draft show` does)
 * and the shipped `applyDraft` runs. When it does not, nothing is written and
 * the refusal is the same one the CLI gives: review it again.
 */
export async function applyFromStudioChange(
  root: string,
  episodeId: string,
  reviewedAgainst: ProjectFingerprint,
  info: ActorInfo = {},
): Promise<{ result: ApplyResult; change: ProjectChange | null }> {
  if (!isPathSafeId(episodeId)) {
    return {
      result: {
        episodeId,
        applied: false,
        created: false,
        diff: null,
        refusal: { reason: "draft-missing" },
      },
      change: null,
    };
  }
  return withProjectWrite(
    contextFor(root, info),
    {
      summary: "Applied a draft",
      scopes: [{ kind: "episodes" }, { kind: "episode", episodeId }],
      trees: [episodeFiles(episodeId).folder],
      errors: "as-is",
    },
    async (tx) => {
      tx.setSummary(
        `Applied the draft to ${episodeLabel(findEpisode(tx.before, episodeId), episodeId)}`,
      );
      const now = await fingerprintEpisode(tx.root, episodeId);
      if (!sameFingerprint(now, reviewedAgainst)) {
        return {
          episodeId,
          applied: false,
          created: false,
          diff: null,
          refusal: { reason: "project-changed" },
        } satisfies ApplyResult;
      }
      const loaded = await readDraft(tx.root, episodeId);
      if (loaded.draft !== null) {
        await writeDraft(tx.root, { ...loaded.draft, reviewedAgainst: now });
      }
      return applyDraft(tx.root, episodeId);
    },
  );
}

/** Apply the episode's draft. See `applyFromStudioChange`. */
export async function applyFromStudio(
  root: string,
  episodeId: string,
  reviewedAgainst: ProjectFingerprint,
  info: ActorInfo = {},
): Promise<ApplyResult> {
  return (await applyFromStudioChange(root, episodeId, reviewedAgainst, info)).result;
}

/**
 * Remove the episode's draft. The project is untouched. Runs under the
 * project's lock; a draft is not project data, so it is not journaled.
 */
export async function discardFromStudio(
  root: string,
  episodeId: string,
  info: ActorInfo = {},
): Promise<boolean> {
  if (!isPathSafeId(episodeId)) return false;
  const { result } = await withProjectWrite(
    contextFor(root, info),
    { summary: "Discarded a draft", scopes: [{ kind: "episode", episodeId }], errors: "as-is" },
    async (tx) => removeDraft(tx.root, episodeId),
  );
  return result;
}

/** One line a person can read for a refusal, path-free. */
export function describeRefusal(result: ApplyResult): string {
  const refusal = result.refusal;
  if (refusal === null) return "";
  switch (refusal.reason) {
    case "draft-missing":
      return "There is no proposal for this episode. Ask the agent to prepare one.";
    case "draft-invalid":
      return `The proposal has problems. Ask the agent to prepare it again: ${refusal.issues.map((i) => i.message).join(" ")}`;
    case "project-invalid":
      return "The story has problems to fix first. See Needs attention on the story page, or ask the agent to fix them.";
    case "project-changed":
      return "The story changed since this page was loaded. Reload and review the proposed changes again.";
    case "conflicts":
      return `This would change or remove ${refusal.conflicts.length} ${refusal.conflicts.length === 1 ? "thing" : "things"} already in the episode, so nothing was changed. Ask the agent to update the proposal.`;
    case "result-invalid":
      return `Applying would leave the story with problems: ${refusal.issues.map((i) => i.message).join(" ")}`;
  }
}
