// `toony draft <compile|show|apply>` — turn an authored episode script into an
// inspectable episode draft, see what applying it would change, and apply it as
// a separate explicit step (#312).
//
// `compile` reads the script and the project, writes `.toony/drafts/<id>.json`,
// and reports what the draft contains: every field the compiler defaulted, the
// craft and overflow findings that need no art, the page geometry the shipped
// plan measurement gives it, and the diff against the project as it is now.
// `show` reports the diff and the conflicts again, against the project as it is
// NOW, and records that state so `apply` knows what was reviewed. `apply` is the
// only subcommand that writes project data, and it refuses on any conflict, on
// a project that changed since the last report, and on a project that does not
// validate. There is no force flag.
//
// Exit codes: 0 success; 1 domain error (a conflict, a draft that cannot
// validate, an out-of-band verdict when a band was named, a refused apply);
// 2 usage or IO failure.

import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import {
  asCraftBand,
  type CraftBand,
  comparePlanToCraftBand,
  DEFAULT_SCREEN_ASPECT,
  ExportError,
  measureEpisodeBundle,
  type PlanBandReport,
  type PlanMeasurement,
  validateCraftBandValue,
} from "@toony/export";
import {
  type Finding,
  lintBubbleOverflow,
  lintCharacterRefs,
  lintCraft,
  sortFindings,
} from "@toony/lint";
import {
  type ApplyResult,
  applyDraft,
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
  loadProject,
  ProjectIoError,
  projectWithDraft,
  readBrief,
  readDraft,
  readEpisodeScript,
  readEpisodeScriptFrom,
  revisionId,
  writeDraft,
} from "@toony/project-io";
import {
  type EpisodeBundle,
  EXPORT_WIDTH_MAX,
  EXPORT_WIDTH_MIN,
  type Project,
  type ValidationIssue,
  validateExportInt,
  validateProject,
} from "@toony/schema";
import { EXIT_OK, EXIT_USAGE, EXIT_VALIDATION } from "../exit.js";
import { discoverPackContent } from "../packs.js";

export interface DraftIo {
  cwd: string;
  out: (line: string) => void;
  err: (line: string) => void;
  env?: Record<string, string | undefined>;
}

const USAGE = `usage:
  toony draft compile [path] --episode <id> [--from <script.json>] [--against <band-id|band.json>] [--width <px>] [--screen-aspect <n>] [--json]
  toony draft show [path] --episode <id> [--json]
  toony draft apply [path] --episode <id> [--json]`;

const VALUE_FLAGS = new Set(["--episode", "--from", "--against", "--width", "--screen-aspect"]);

/** Lint checks a draft cannot run, because they need art or an export. */
const LINTS_NOT_RUN = [
  "image/* (no art yet)",
  "cut/panel-aspect-mismatch (no art yet)",
  "manifest/* (no export yet)",
] as const;

interface Parsed {
  positional: string[];
  values: Map<string, string>;
  json: boolean;
}

function parse(args: string[]): Parsed | { error: string } {
  const positional: string[] = [];
  const values = new Map<string, string>();
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--json") {
      json = true;
    } else if (VALUE_FLAGS.has(arg)) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("-")) return { error: `${arg} requires a value` };
      values.set(arg, value);
      i++;
    } else if (arg.startsWith("-")) {
      return { error: `unknown option: ${arg}` };
    } else {
      positional.push(arg);
    }
  }
  return { positional, values, json };
}

function unusedFlags(parsed: Parsed, allowed: readonly string[], sub: string): string | null {
  for (const flag of parsed.values.keys()) {
    if (!allowed.includes(flag)) return `${flag} is not an option of "toony draft ${sub}"`;
  }
  return null;
}

// --- Reporting --------------------------------------------------------------

function issueLines(issues: readonly ValidationIssue[]): string[] {
  return issues.map((issue) => `  ${issue.path}: [${issue.code}] ${issue.message}`);
}

function show(value: unknown): string {
  if (value === undefined) return "absent";
  if (typeof value === "string") return JSON.stringify(value);
  return JSON.stringify(value);
}

function marksText(marks: DraftConflict["marks"]): string {
  const parts: string[] = [];
  if (marks.reviewStatus !== undefined) parts.push(`review ${marks.reviewStatus}`);
  if (marks.imageSeed !== undefined) parts.push(`seed ${marks.imageSeed}`);
  if (marks.imageWorkflow !== undefined) parts.push(`workflow ${marks.imageWorkflow}`);
  return parts.length === 0 ? "" : ` (${parts.join(", ")})`;
}

function diffLines(diff: DraftDiff, conflicts: readonly DraftConflict[]): string[] {
  const lines: string[] = [];
  lines.push(
    diff.episodeExists
      ? `against episode ${diff.episodeId} as the project holds it now:`
      : `episode ${diff.episodeId} does not exist yet; applying creates it:`,
  );
  for (const kind of ["cut", "transition", "overlay"] as const) {
    const c = diff.counts[kind];
    lines.push(
      `  ${kind}s: ${c.added} added, ${c.changed} changed, ${c.removed} removed, ${c.unchanged} unchanged`,
    );
  }
  const seq = diff.sequence;
  lines.push(
    `  sequence: ${seq.status}` +
      (seq.added > 0 ? `, ${seq.added} entr${seq.added === 1 ? "y" : "ies"} added` : "") +
      (seq.removed.length > 0 ? `, drops ${seq.removed.join(", ")}` : "") +
      (seq.reordered ? ", reorders existing entries" : ""),
  );
  if (diff.title !== null) {
    lines.push(`  title: ${show(diff.title.current)} -> ${show(diff.title.drafted)}`);
  }
  for (const record of diff.changed) {
    lines.push(`  changed ${record.kind} ${record.id}${marksText(record.marks)}:`);
    for (const change of record.changes) {
      lines.push(`    ${change.field}: ${show(change.current)} -> ${show(change.drafted)}`);
    }
  }
  for (const record of diff.removed) {
    lines.push(`  removed ${record.kind} ${record.id}${marksText(record.marks)}`);
  }
  if (conflicts.length === 0) {
    lines.push("  conflicts: none");
  } else {
    lines.push(`  conflicts: ${conflicts.length}; apply refuses while any remain`);
  }
  return lines;
}

function continuityLines(continuity: DraftContinuity | undefined): string[] {
  if (continuity === undefined) return [];
  return [
    `continues from ${continuity.previousEpisodeId}${continuity.previousExists ? "" : " (not in the project yet)"}: ${JSON.stringify(continuity.startsFrom)}`,
  ];
}

function defaultsLines(defaults: readonly DraftDefault[]): string[] {
  if (defaults.length === 0) return ["defaulted fields: none"];
  const byRecord = new Map<string, string[]>();
  for (const d of defaults) {
    const key = `${d.kind} ${d.id}`;
    const list = byRecord.get(key) ?? [];
    list.push(d.field);
    byRecord.set(key, list);
  }
  const lines = [`defaulted fields: ${defaults.length} on ${byRecord.size} record(s)`];
  for (const [record, fields] of byRecord) lines.push(`  ${record}: ${fields.join(", ")}`);
  return lines;
}

function findingLines(findings: readonly Finding[]): string[] {
  const lines = [
    findings.length === 0
      ? "lint: clean on the checks a draft can run"
      : `lint: ${findings.length} finding(s)`,
  ];
  for (const f of findings) lines.push(`  [${f.severity}] ${f.code} ${f.targetId}: ${f.message}`);
  lines.push(`  not run: ${LINTS_NOT_RUN.join("; ")}`);
  return lines;
}

function geometryLines(measurement: PlanMeasurement, band: PlanBandReport | null): string[] {
  const m = measurement.metrics;
  const lines = [
    `geometry at ${measurement.width}px: ${measurement.cuts} cut(s), ${measurement.cutsWithoutDeclaredShape} without a declared shape (graded at ${measurement.fallbackAspect}), page ${measurement.height}px`,
    `  gutterRatio ${m.gutterRatio.toFixed(3)}, gutterMedian ${m.gutterMedian.toFixed(3)}, panelHeightMedian ${m.panelHeightMedian.toFixed(3)}, panelHeightSpread ${m.panelHeightSpread.toFixed(3)}, panelsPerScreen ${m.panelsPerScreen.toFixed(2)}`,
    `  unchecked: ${measurement.unchecked.map((u) => u.metric).join(", ")}`,
  ];
  if (band !== null) {
    if ("graded" in band) {
      lines.push("  band: grades nothing a plan can check");
    } else {
      lines.push(`  band: ${band.checkedInBand ? "in band" : "OUT OF BAND"} on what a plan checks`);
    }
  }
  return lines;
}

// --- Shared loading ---------------------------------------------------------

async function readBand(file: string): Promise<CraftBand | { error: string[] }> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return { error: [`band file could not be read: ${file}`] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: [`band file is not valid JSON: ${file}`] };
  }
  const result = validateCraftBandValue(parsed);
  if (!result.valid) {
    return {
      error: result.issues.map(
        (issue) => `band error [${issue.code}] ${issue.path}: ${issue.message}`,
      ),
    };
  }
  return asCraftBand(parsed as Record<string, unknown>);
}

type Loaded = Awaited<ReturnType<typeof loadProject>>;

async function loadOrReport(root: string, json: boolean, io: DraftIo): Promise<Loaded | null> {
  try {
    return await loadProject(root);
  } catch (cause) {
    if (cause instanceof ProjectIoError) {
      if (json) io.out(JSON.stringify({ root, error: cause.message }, null, 2));
      else io.err(`load error: ${cause.message}`);
      return null;
    }
    throw cause;
  }
}

// --- compile ----------------------------------------------------------------

async function runCompile(parsed: Parsed, io: DraftIo): Promise<number> {
  const bad = unusedFlags(parsed, [...VALUE_FLAGS], "compile");
  if (bad) {
    io.err(bad);
    return EXIT_USAGE;
  }
  const episodeId = parsed.values.get("--episode");
  if (episodeId === undefined) {
    io.err("--episode <id> is required");
    io.err(USAGE);
    return EXIT_USAGE;
  }
  const root = resolve(io.cwd, parsed.positional[0] ?? ".");

  let width: number | undefined;
  const widthArg = parsed.values.get("--width");
  if (widthArg !== undefined) {
    const error = validateExportInt(
      Number(widthArg),
      "--width",
      EXPORT_WIDTH_MIN,
      EXPORT_WIDTH_MAX,
    );
    if (error) {
      io.err(error);
      return EXIT_USAGE;
    }
    width = Number(widthArg);
  }
  let screenAspect: number | undefined;
  const aspectArg = parsed.values.get("--screen-aspect");
  if (aspectArg !== undefined) {
    const value = Number(aspectArg);
    if (!Number.isFinite(value) || value <= 0) {
      io.err("--screen-aspect must be a positive number");
      return EXIT_USAGE;
    }
    screenAspect = value;
  }

  const loaded = await loadOrReport(root, parsed.json, io);
  if (loaded === null) return EXIT_USAGE;
  const registry = loaded.project.webtoon.characters ?? [];

  const packs = await discoverPackContent(root, io);
  let band: CraftBand | null = null;
  const against = parsed.values.get("--against");
  if (against !== undefined) {
    const file = packs.craftBands.get(against) ?? resolve(io.cwd, against);
    const read = await readBand(file);
    if ("error" in read) {
      for (const line of read.error) io.err(line);
      return EXIT_USAGE;
    }
    band = read;
  }

  // The script: the project's own by default, or a file named with --from.
  let script: LoadedEpisodeScript;
  const from = parsed.values.get("--from");
  try {
    script =
      from === undefined
        ? await readEpisodeScript(root, episodeId, registry)
        : await readEpisodeScriptFrom(root, resolve(io.cwd, from), episodeId, registry);
  } catch (cause) {
    if (cause instanceof ProjectIoError) {
      io.err(`script error: ${cause.message}`);
      return EXIT_USAGE;
    }
    throw cause;
  }
  if (script.absent) {
    io.err(
      from === undefined
        ? `no script for episode ${episodeId}: write script/episodes/${episodeId}.json first, or name one with --from`
        : `script file not found: ${from}`,
    );
    return EXIT_USAGE;
  }
  // `valid` is false for a malformed file AND for a file that names another
  // episode than the one asked for; both are refused here. Warnings (an
  // unresolved character, a stale brief) leave it valid and go in the report.
  if (!script.validation.valid || script.script === null) {
    io.err(`the script for episode ${episodeId} does not validate:`);
    for (const line of issueLines(script.validation.issues)) io.err(line);
    return EXIT_VALIDATION;
  }

  let brief: Awaited<ReturnType<typeof readBrief>> | null;
  try {
    brief = await readBrief(root);
  } catch (cause) {
    if (!(cause instanceof ProjectIoError)) throw cause;
    brief = null;
  }

  // The project's lettering theme (#334), from installed packs. A selected id
  // no pack provides is said on stderr and the defaults stand, so a draft is
  // never refused for a pack that is not installed yet.
  const themeId = loaded.project.webtoon.letteringTheme;
  const theme =
    themeId === undefined
      ? undefined
      : packs.letteringThemes.find((entry) => entry.id === themeId)?.theme;
  if (themeId !== undefined && theme === undefined) {
    io.err(
      `note: webtoon.json selects lettering theme "${themeId}", which no installed pack provides; the draft letters with the defaults`,
    );
  }

  let compiled: ReturnType<typeof compileEpisodeScript>;
  try {
    compiled = compileEpisodeScript(script.script, loaded.project, {
      ...(theme === undefined ? {} : { theme }),
    });
  } catch (cause) {
    if (cause instanceof ProjectIoError) {
      io.err(`compile refused: ${cause.message}`);
      return EXIT_VALIDATION;
    }
    throw cause;
  }
  const { bundle, defaults, continuity } = compiled;

  // A draft that does not validate with its project is never written.
  const combined: Project = projectWithDraft(loaded.project, bundle);
  const validation = validateProject(combined);
  if (!validation.valid) {
    io.err(`compile refused: the draft does not validate with its project, nothing written:`);
    for (const line of issueLines(validation.issues)) io.err(line);
    return EXIT_VALIDATION;
  }

  const findings = sortFindings([
    ...lintCharacterRefs(bundle, registry),
    ...lintCraft(bundle, registry, { gutterBandWidth: loaded.project.webtoon.gutterBandWidth }),
    ...lintBubbleOverflow(bundle, () => null, {
      gutterBandWidth: loaded.project.webtoon.gutterBandWidth,
    }),
  ]);

  let measurement: PlanMeasurement;
  try {
    measurement = measureEpisodeBundle(combined, bundle, {
      width,
      screenAspect: screenAspect ?? band?.screenAspect ?? DEFAULT_SCREEN_ASPECT,
    });
  } catch (cause) {
    if (cause instanceof ExportError) {
      io.err(`compile refused: ${cause.message}`);
      return EXIT_USAGE;
    }
    throw cause;
  }
  const bandReport = band === null ? null : comparePlanToCraftBand(measurement, band);

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
  const file = relative(io.cwd, draftPath(root, episodeId)) || draftPath(root, episodeId);

  if (parsed.json) {
    io.out(
      JSON.stringify(
        {
          root,
          episodeId,
          draft: file,
          applied: false,
          scriptRevision: draft.scriptRevision,
          briefRevision: draft.briefRevision,
          scriptWarnings: script.warnings,
          records: {
            cuts: bundle.cuts.length,
            transitions: bundle.transitions.length,
            overlays: bundle.lettering.length,
          },
          defaults,
          continuity: continuity ?? null,
          letteringTheme:
            themeId === undefined ? null : { id: themeId, applied: theme !== undefined },
          lint: { findings, notRun: LINTS_NOT_RUN },
          geometry: { ...measurement, band: bandReport },
          diff,
          conflicts,
        },
        null,
        2,
      ),
    );
  } else {
    io.out(
      `draft written: ${file} (not applied). ${bundle.cuts.length} cut(s), ${bundle.transitions.length} transition(s), ${bundle.lettering.length} overlay(s) from script revision ${draft.scriptRevision.slice(0, 12)}`,
    );
    for (const w of script.warnings) io.out(`script warning: [${w.code}] ${w.path}: ${w.message}`);
    for (const line of continuityLines(continuity)) io.out(line);
    for (const line of defaultsLines(defaults)) io.out(line);
    for (const line of findingLines(findings)) io.out(line);
    for (const line of geometryLines(measurement, bandReport)) io.out(line);
    for (const line of diffLines(diff, conflicts)) io.out(line);
    io.out(`next: review the diff, then \`toony draft apply --episode ${episodeId}\``);
  }

  if (conflicts.length > 0) return EXIT_VALIDATION;
  if (bandReport !== null) {
    if ("graded" in bandReport) {
      io.err(
        "draft compile: this band grades nothing a plan can check. Its ranges need pixels; run `toony measure --against` once the art exists.",
      );
      return EXIT_USAGE;
    }
    if (!bandReport.checkedInBand) return EXIT_VALIDATION;
  }
  return EXIT_OK;
}

// --- show -------------------------------------------------------------------

async function runShow(parsed: Parsed, io: DraftIo): Promise<number> {
  const bad = unusedFlags(parsed, ["--episode"], "show");
  if (bad) {
    io.err(bad);
    return EXIT_USAGE;
  }
  const episodeId = parsed.values.get("--episode");
  if (episodeId === undefined) {
    io.err("--episode <id> is required");
    io.err(USAGE);
    return EXIT_USAGE;
  }
  const root = resolve(io.cwd, parsed.positional[0] ?? ".");

  const loaded = await loadOrReport(root, parsed.json, io);
  if (loaded === null) return EXIT_USAGE;

  let loadedDraft: Awaited<ReturnType<typeof readDraft>>;
  try {
    loadedDraft = await readDraft(root, episodeId);
  } catch (cause) {
    if (cause instanceof ProjectIoError) {
      io.err(`draft error: ${cause.message}`);
      return EXIT_USAGE;
    }
    throw cause;
  }
  if (loadedDraft.absent) {
    io.err(`no draft for episode ${episodeId}; run \`toony draft compile --episode ${episodeId}\``);
    return EXIT_USAGE;
  }
  if (loadedDraft.draft === null) {
    io.err(`the draft for episode ${episodeId} does not validate:`);
    for (const line of issueLines(loadedDraft.validation.issues)) io.err(line);
    return EXIT_VALIDATION;
  }
  const draft = loadedDraft.draft;

  const existing = loaded.project.episodes.find((e) => e.episode.id === episodeId) ?? null;
  const diff = diffDraft(draft.bundle, existing);
  const conflicts = draftConflicts(diff);

  // This report is what the operator reviews, so record the project state it
  // was made against; apply compares against that.
  await writeDraft(root, { ...draft, reviewedAgainst: await fingerprintEpisode(root, episodeId) });

  if (parsed.json) {
    io.out(
      JSON.stringify(
        {
          root,
          episodeId,
          applied: false,
          defaults: draft.defaults,
          continuity: draft.continuity ?? null,
          diff,
          conflicts,
        },
        null,
        2,
      ),
    );
  } else {
    io.out(`draft for episode ${episodeId} (not applied):`);
    for (const line of continuityLines(draft.continuity)) io.out(line);
    for (const line of diffLines(diff, conflicts)) io.out(line);
    for (const conflict of conflicts) {
      io.out(
        `  conflict: ${conflict.kind} ${conflict.id} ${conflict.field}: ${show(conflict.current)} -> ${show(conflict.drafted)}${marksText(conflict.marks)}`,
      );
    }
  }
  return conflicts.length > 0 ? EXIT_VALIDATION : EXIT_OK;
}

// --- apply ------------------------------------------------------------------

function refusalLines(result: ApplyResult): string[] {
  const refusal = result.refusal;
  if (refusal === null) return [];
  switch (refusal.reason) {
    case "draft-missing":
      return [
        `apply refused: no draft for episode ${result.episodeId}; run \`toony draft compile --episode ${result.episodeId}\``,
      ];
    case "draft-invalid":
      return ["apply refused: the draft does not validate:", ...issueLines(refusal.issues)];
    case "project-invalid":
      return [
        "apply refused: the project does not pass validation; run `toony validate`:",
        ...issueLines(refusal.issues),
      ];
    case "project-changed":
      return [
        `apply refused: the project changed since the draft was last reported; run \`toony draft show --episode ${result.episodeId}\` and review it again`,
      ];
    case "conflicts":
      return [
        `apply refused: ${refusal.conflicts.length} conflict(s) with records the project already holds; nothing written:`,
        ...refusal.conflicts.map(
          (c) =>
            `  ${c.kind} ${c.id} ${c.field}: ${show(c.current)} -> ${show(c.drafted)}${marksText(c.marks)}`,
        ),
      ];
    case "result-invalid":
      return [
        "apply refused: the project would not validate afterwards; nothing written:",
        ...issueLines(refusal.issues),
      ];
  }
}

async function runApply(parsed: Parsed, io: DraftIo): Promise<number> {
  const bad = unusedFlags(parsed, ["--episode"], "apply");
  if (bad) {
    io.err(bad);
    return EXIT_USAGE;
  }
  const episodeId = parsed.values.get("--episode");
  if (episodeId === undefined) {
    io.err("--episode <id> is required");
    io.err(USAGE);
    return EXIT_USAGE;
  }
  const root = resolve(io.cwd, parsed.positional[0] ?? ".");

  let result: ApplyResult;
  try {
    result = await applyDraft(root, episodeId);
  } catch (cause) {
    if (cause instanceof ProjectIoError) {
      if (parsed.json) io.out(JSON.stringify({ root, episodeId, error: cause.message }, null, 2));
      else io.err(`apply error: ${cause.message}`);
      return EXIT_USAGE;
    }
    throw cause;
  }

  if (parsed.json) {
    io.out(JSON.stringify({ root, ...result }, null, 2));
  } else if (result.applied) {
    const bundle = (await loadProject(root)).project.episodes.find(
      (e: EpisodeBundle) => e.episode.id === episodeId,
    );
    io.out(
      `applied draft to episode ${episodeId}${result.created ? " (created)" : ""}: ${bundle?.cuts.length ?? 0} cut(s), ${bundle?.transitions.length ?? 0} transition(s), ${bundle?.lettering.length ?? 0} overlay(s) on disk`,
    );
  } else {
    for (const line of refusalLines(result)) io.err(line);
  }
  return result.applied ? EXIT_OK : EXIT_VALIDATION;
}

/** Run `toony draft <compile|show|apply>`. Returns the process exit code. */
export async function runDraft(args: string[], io: DraftIo): Promise<number> {
  const [sub, ...rest] = args;
  const parsed = parse(rest);
  if ("error" in parsed) {
    io.err(parsed.error);
    io.err(USAGE);
    return EXIT_USAGE;
  }
  switch (sub) {
    case "compile":
      return runCompile(parsed, io);
    case "show":
      return runShow(parsed, io);
    case "apply":
      return runApply(parsed, io);
    default:
      io.err(sub === undefined ? "missing subcommand" : `unknown draft subcommand: ${sub}`);
      io.err(USAGE);
      return EXIT_USAGE;
  }
}
