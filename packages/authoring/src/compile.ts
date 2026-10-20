// Compile an authored episode script into a checked, written draft.
//
// This is the orchestration `toony draft compile` runs, extracted so Studio's
// agent tools create episodes through the very same steps: the project's
// lettering theme, the validation of the draft with its project, the lints a
// draft can run, the plan geometry, the diff and the conflicts, and the draft
// file with the fingerprint apply checks. The caller loads the project, finds
// installed packs and reads a band file; this module never reads anything but
// the project's own files.

import {
  type CraftBand,
  comparePlanToCraftBand,
  DEFAULT_SCREEN_ASPECT,
  ExportError,
  measureEpisodeBundle,
  type PlanBandReport,
  type PlanMeasurement,
} from "@toony/export";
import {
  type Finding,
  lintBubbleOverflow,
  lintCharacterRefs,
  lintCraft,
  sortFindings,
} from "@toony/lint";
import {
  compileEpisodeScript,
  DRAFT_FORMAT_VERSION,
  type DraftConflict,
  type DraftContinuity,
  type DraftDefault,
  type DraftDiff,
  diffDraft,
  draftConflicts,
  draftPath,
  type EpisodeDraft,
  fingerprintEpisode,
  type LoadedEpisodeScript,
  type LoadedProject,
  ProjectIoError,
  projectWithDraft,
  readBrief,
  readEpisodeScript,
  readEpisodeScriptFrom,
  revisionId,
  writeDraft,
} from "@toony/project-io";
import {
  type EpisodeBundle,
  type LetteringTheme,
  type Project,
  type ValidationIssue,
  validateProject,
} from "@toony/schema";

/** Lint checks a draft cannot run, because they need art or an export. */
export const DRAFT_LINTS_NOT_RUN = [
  "image/* (no art yet)",
  "cut/panel-aspect-mismatch (no art yet)",
  "manifest/* (no export yet)",
] as const;

/** One lettering theme an installed pack provides. */
export interface LetteringThemeEntry {
  id: string;
  theme: LetteringTheme;
}

export interface CompileDraftRequest {
  /** The project root. */
  root: string;
  episodeId: string;
  /** The project as the caller loaded it. */
  loaded: LoadedProject;
  /** An absolute script file to compile instead of `script/episodes/<id>.json`. */
  scriptFile?: string;
  /** Lettering themes from installed packs; the project's selected one is applied. */
  letteringThemes?: readonly LetteringThemeEntry[];
  /** Called when the project selects a theme no installed pack provides. */
  onThemeMissing?: (themeId: string) => void;
  /** A craft band to grade the plan geometry against. */
  band?: CraftBand | null;
  /** Measurement width in px. Absent means the plan default. */
  width?: number;
  /** Screen height as a multiple of the width. */
  screenAspect?: number;
}

export interface CompileDraftSuccess {
  ok: true;
  episodeId: string;
  /** The draft as written to `.toony/drafts/<id>.json`. */
  draft: EpisodeDraft;
  /** Absolute path of the written draft. */
  draftFile: string;
  bundle: EpisodeBundle;
  defaults: DraftDefault[];
  continuity: DraftContinuity | undefined;
  /** Warnings about the script's surroundings (stale brief, unknown character). */
  scriptWarnings: ValidationIssue[];
  /** The project's selected theme, and whether an installed pack provided it. */
  letteringTheme: { id: string; applied: boolean } | null;
  findings: Finding[];
  measurement: PlanMeasurement;
  band: PlanBandReport | null;
  diff: DraftDiff;
  conflicts: DraftConflict[];
}

export type CompileDraftFailure =
  /** The script file could not be read or parsed. */
  | { ok: false; stage: "script-read"; message: string }
  /** There is no script to compile. */
  | { ok: false; stage: "script-absent" }
  /** The script does not validate, or names another episode. */
  | { ok: false; stage: "script-invalid"; issues: ValidationIssue[] }
  /** The script states something no episode can hold. */
  | { ok: false; stage: "compile"; message: string }
  /** The draft does not validate with its project. Nothing was written. */
  | { ok: false; stage: "invalid"; issues: ValidationIssue[] }
  /** The plan geometry could not be measured. Nothing was written. */
  | { ok: false; stage: "measure"; message: string };

export type CompileDraftResult = CompileDraftSuccess | CompileDraftFailure;

/**
 * Compile `episodeId`'s script into a draft and write it. Refusals come back as
 * a failure naming the stage; nothing is written for any of them. IO errors
 * other than reading the script propagate.
 */
export async function compileEpisodeDraft(
  request: CompileDraftRequest,
): Promise<CompileDraftResult> {
  const { root, episodeId, loaded } = request;
  const registry = loaded.project.webtoon.characters ?? [];

  let script: LoadedEpisodeScript;
  try {
    script =
      request.scriptFile === undefined
        ? await readEpisodeScript(root, episodeId, registry)
        : await readEpisodeScriptFrom(root, request.scriptFile, episodeId, registry);
  } catch (cause) {
    if (cause instanceof ProjectIoError) {
      return { ok: false, stage: "script-read", message: cause.message };
    }
    throw cause;
  }
  if (script.absent) return { ok: false, stage: "script-absent" };
  // `valid` is false for a malformed file AND for a file that names another
  // episode than the one asked for; both are refused here. Warnings (an
  // unresolved character, a stale brief) leave it valid and go in the report.
  if (!script.validation.valid || script.script === null) {
    return { ok: false, stage: "script-invalid", issues: script.validation.issues };
  }

  let brief: Awaited<ReturnType<typeof readBrief>> | null;
  try {
    brief = await readBrief(root);
  } catch (cause) {
    if (!(cause instanceof ProjectIoError)) throw cause;
    brief = null;
  }

  // The project's lettering theme (#334), from installed packs. A selected id
  // no pack provides is reported and the defaults stand, so a draft is never
  // refused for a pack that is not installed yet.
  const themeId = loaded.project.webtoon.letteringTheme;
  const theme =
    themeId === undefined
      ? undefined
      : request.letteringThemes?.find((entry) => entry.id === themeId)?.theme;
  if (themeId !== undefined && theme === undefined) request.onThemeMissing?.(themeId);

  let compiled: ReturnType<typeof compileEpisodeScript>;
  try {
    compiled = compileEpisodeScript(script.script, loaded.project, {
      ...(theme === undefined ? {} : { theme }),
    });
  } catch (cause) {
    if (cause instanceof ProjectIoError) {
      return { ok: false, stage: "compile", message: cause.message };
    }
    throw cause;
  }
  const { bundle, defaults, continuity } = compiled;

  // A draft that does not validate with its project is never written.
  const combined: Project = projectWithDraft(loaded.project, bundle);
  const validation = validateProject(combined);
  if (!validation.valid) return { ok: false, stage: "invalid", issues: validation.issues };

  const gutterBandWidth = loaded.project.webtoon.gutterBandWidth;
  const findings = sortFindings([
    ...lintCharacterRefs(bundle, registry),
    ...lintCraft(bundle, registry, { gutterBandWidth }),
    ...lintBubbleOverflow(bundle, () => null, { gutterBandWidth }),
  ]);

  let measurement: PlanMeasurement;
  try {
    measurement = measureEpisodeBundle(combined, bundle, {
      width: request.width,
      screenAspect: request.screenAspect ?? request.band?.screenAspect ?? DEFAULT_SCREEN_ASPECT,
    });
  } catch (cause) {
    if (cause instanceof ExportError)
      return { ok: false, stage: "measure", message: cause.message };
    throw cause;
  }
  const band =
    request.band === undefined || request.band === null
      ? null
      : comparePlanToCraftBand(measurement, request.band);

  const existing = loaded.project.episodes.find((e) => e.episode.id === episodeId) ?? null;
  const diff = diffDraft(bundle, existing);
  const conflicts = draftConflicts(diff);

  const draft: EpisodeDraft = {
    draftFormat: DRAFT_FORMAT_VERSION,
    episodeId,
    scriptRevision: script.revision ?? revisionId(script.script),
    briefRevision: brief?.revision ?? null,
    bundle,
    defaults,
    ...(continuity === undefined ? {} : { continuity }),
    reviewedAgainst: await fingerprintEpisode(root, episodeId),
  };
  await writeDraft(root, draft);

  return {
    ok: true,
    episodeId,
    draft,
    draftFile: draftPath(root, episodeId),
    bundle,
    defaults,
    continuity,
    scriptWarnings: script.warnings,
    letteringTheme: themeId === undefined ? null : { id: themeId, applied: theme !== undefined },
    findings,
    measurement,
    band,
    diff,
    conflicts,
  };
}
