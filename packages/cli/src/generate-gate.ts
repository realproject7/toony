// The validation gate `generate` and `import-image` run before producing art (#270),
// and the two pieces of reporting that make its refusal actionable.
//
// `toony generate` used to throw `loadProject`'s validation report away, so a
// project `toony validate` rejects still generated: prompts, palettes, character
// refs and panel shapes read from records nobody had checked, art written into
// the project, and a run that exited 0.
//
// It refuses by default. What it does NOT do is refuse a project that is merely
// half-wired, because "incomplete" and "invalid" are not the same thing here and
// the difference is not only field-level. A cut with no prompt and `image: null`
// validates — that is why `toony validate --require-images` is opt-in. But a cut
// that is fully written and not yet in the episode's `sequence` does NOT
// validate, and refusing on that makes the whole project unreachable while any
// one part of it is mid-edit: measured on the real CLI, a well-formed `cut-003`
// appended to `cuts.yaml` and not yet sequenced refused generation of cut-003,
// of the long-finished cut-001, and of a transition, all three. That is exactly
// the authoring loop the ticket's counter-argument was about.
//
// So the gate carries WIRING_CODES: an explicit, short allowlist of validation
// codes that describe a reference BETWEEN records rather than a defect INSIDE
// one. They are warned about loudly and the run proceeds. Everything else
// refuses.
//
// Two properties make that the right shape, rather than deciding per issue which
// fields generation happens to read:
//
//   - It never guesses. Every code on the list is a state in which each record
//     is itself well formed and only the references between them are unfinished;
//     none of them can be true *of a field generation reads*. Generation reads
//     `cuts`, `transitions` and `webtoon.characters`; it reads neither
//     `episode.sequence` nor `lettering`, which is where these five live.
//   - It fails CLOSED. Membership is by exact code, so a validation code added
//     later is not on the list and refuses. The safe default needs no upkeep;
//     widening the list is a deliberate edit with its own evidence.

import type { Project, ValidationIssue, ValidationResult } from "@toony/schema";
import { textReport } from "./report.js";

/**
 * Validation codes that mean "not wired up yet", not "malformed".
 *
 * Each one is emitted only by the reference checks in the schema validator
 * (`validateSequenceIntegrity` and the overlay `cutId` check): they compare id
 * SETS collected from the records against the ids the sequence and the overlays
 * name. None of them inspects a record's own fields, so a project whose only
 * issues are these has every field of every record intact.
 *
 * `sequence.empty` is here for a different reason than the other five, and it is
 * the one the reading-order SHAPE rules do not share. It is emitted by
 * `validateSequenceShape` from `types.length === 0` — a zero-length array, so by
 * construction it reads nothing at all, not one field of one record. And it is
 * not a rule about a finished episode: it is an episode nobody has written into
 * yet. A correctly created `episodes/ep-002/` with all four files present and
 * `sequence: []` made the FINISHED episode 1 unreachable, and unlike a trailing
 * transition there is no "fix it in the same edit" — not having written the
 * episode is the whole point of that state.
 *
 * Deliberately NOT here: the other four reading-order shape rules
 * (`sequence.leading-transition`, `sequence.trailing-transition`,
 * `sequence.adjacent-transitions`, `sequence.duplicate-reference`). Those DO
 * state a rule about the finished episode, they each have an edit that fixes
 * them on the spot, and no measured authoring step needed them. The cost is
 * real, accepted, and pinned by test: sequencing a transition at the very end of
 * an episode, or two in a row, still refuses the run until the next cut is
 * sequenced.
 */
export const WIRING_CODES: ReadonlySet<string> = new Set([
  // A record exists and is well formed, but the sequence does not name it yet.
  "cut.orphan",
  "transition.orphan",
  // The sequence names a record that has not been written yet.
  "sequence.missing-cut",
  "sequence.missing-transition",
  // A lettering overlay points at a cut record that does not exist. Generation
  // never reads `lettering`.
  "overlay.missing-cut",
  // An episode exists but nothing has been sequenced into it yet.
  "sequence.empty",
]);

/** Split a report into the issues that block a run and the ones that only warn. */
export function partitionIssues(result: ValidationResult): {
  blocking: ValidationIssue[];
  wiring: ValidationIssue[];
} {
  const blocking: ValidationIssue[] = [];
  const wiring: ValidationIssue[] = [];
  for (const issue of result.issues) {
    (WIRING_CODES.has(issue.code) ? wiring : blocking).push(issue);
  }
  return { blocking, wiring };
}

/** The shared authoring rule and report, before either command produces bytes. */
export function passesAuthoringGate(
  root: string,
  loaded: { project: Project; validation: ValidationResult },
  command: "generate" | "import-image",
  err: (line: string) => void,
): boolean {
  if (loaded.validation.valid) return true;
  const { blocking, wiring } = partitionIssues(loaded.validation);
  const action = command === "generate" ? "generating" : "importing";
  if (blocking.length === 0) {
    err(`warning: ${wiring.length} unwired reference(s) in ${root}:`);
    for (const issue of wiring) err(`  - [${issue.code}] ${issue.path}`);
    err(`${action} anyway; run "toony validate" for the full report.`);
    return true;
  }
  err(textReport(root, loaded.validation));
  for (const line of authoredValueLines(loaded.project, blocking)) err(line);
  const past = command === "generate" ? "generated" : "imported";
  const verb = command === "generate" ? "generate from" : "import into";
  err(
    `nothing was ${past}: "toony ${command}" does not ${verb} a project that does not validate. Fix the issue(s) above and re-run.`,
  );
  return false;
}

/** How many characters of an authored value the refusal will print. */
const MAX_VALUE_CHARS = 60;

/**
 * Render a value the way its author wrote it.
 *
 * `JSON.stringify` renders NaN and Infinity as `null`, which names neither the
 * value nor the mistake, so numbers print as themselves. Everything else keeps
 * its quotes — which is the whole point for a YAML-quoted `"1.4"`, where the
 * quotes ARE the defect and the validator's message ("must be a number between
 * 0.1 and 10") reads like a description of the number the author thinks is
 * there.
 */
export function renderAuthoredValue(value: unknown): string {
  if (value === undefined) return "absent";
  if (typeof value === "number") return String(value);
  const shown = JSON.stringify(value) ?? String(value);
  return shown.length > MAX_VALUE_CHARS ? `${shown.slice(0, MAX_VALUE_CHARS)}…` : shown;
}

/** One step of a dotted/indexed issue path: a key or an array index. */
type PathStep = { key: string } | { index: number };

/**
 * The one key whose issue paths do not address the loaded project faithfully.
 *
 * `validateSequenceIntegrity` is handed the BUNDLE path and builds
 * `episodes[i].sequence` from it (`validate.ts:915`, `:972`), but in the loaded
 * project the sequence lives at `episodes[i].episode.sequence` — so
 * `"sequence" in bundle` is FALSE. Without this hop the walker's
 * "a missing key on the last step means the field is absent" branch fires and
 * the run tells an author their sequence is missing when it is present, which
 * points at a different edit than the one they need. It was wrong for three
 * codes — `sequence.empty`, `sequence.leading-transition` and
 * `sequence.trailing-transition`; `adjacent-transitions` and
 * `duplicate-reference` escaped it only because their paths carry a trailing
 * index, so the missing key was never the last step.
 *
 * Scoped to this ONE key on purpose. If the validator ever flattens another,
 * the walker declines and prints nothing, which is the safe failure: a wrong
 * line is worse than no line.
 */
const BUNDLE_FLATTENED_KEY = "sequence";

/**
 * Split a `ValidationIssue.path` into steps.
 *
 * Paths are built by `joinPath`, so they look like
 * `episodes[0].cuts[1].panelAspect` — dots between keys, brackets for indices.
 * Returns null for anything that does not parse, so a future path shape degrades
 * to "no extra line" rather than to a wrong one.
 */
function parseIssuePath(path: string): PathStep[] | null {
  const steps: PathStep[] = [];
  for (const segment of path.split(".")) {
    const match = /^([A-Za-z_][A-Za-z0-9_-]*)((?:\[\d+\])*)$/.exec(segment);
    if (!match) return null;
    steps.push({ key: match[1] as string });
    for (const index of (match[2] ?? "").matchAll(/\[(\d+)\]/g)) {
      steps.push({ index: Number(index[1]) });
    }
  }
  return steps.length === 0 ? null : steps;
}

/** What an issue's path points at, plus the id of the nearest record above it. */
export interface LocatedIssue {
  /** The value as authored, ready to print. */
  value: string;
  /** The `id` of the closest enclosing record that has one, when there is one. */
  recordId?: string;
}

/**
 * Read back the value an issue is about, by walking its path through the loaded
 * project, and the id of the record it sits in.
 *
 * This is how the refusal names the offending VALUE without carrying a second
 * copy of any rule: the validator says which path is wrong and why, and this
 * says what is actually there. #237 had a hand-written version of exactly this
 * for one field; doing it from the path covers every field instead.
 *
 * Returns null when the path does not resolve, or resolves to an object or an
 * array — `cut.orphan` points at `episodes[0].cuts`, and printing a whole cut
 * list helps nobody.
 */
export function locateIssue(project: Project, issue: ValidationIssue): LocatedIssue | null {
  const steps = parseIssuePath(issue.path);
  if (steps === null) return null;

  let current: unknown = project;
  let recordId: string | undefined;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] as PathStep;
    if (current === null || typeof current !== "object") return null;
    if ("index" in step) {
      if (!Array.isArray(current) || step.index >= current.length) return null;
      current = current[step.index];
    } else {
      if (Array.isArray(current)) return null;
      if (!(step.key in current)) {
        // One known divergence first: the validator addresses the episode's
        // `sequence` through the bundle. Following it is the difference between
        // "your sequence is absent" and the truth.
        const hop =
          step.key === BUNDLE_FLATTENED_KEY
            ? (current as { episode?: unknown }).episode
            : undefined;
        if (hop !== null && typeof hop === "object" && step.key in hop) {
          current = (hop as Record<string, unknown>)[step.key];
        } else {
          // Otherwise a key that is not there resolves ONLY as the last step,
          // where it means the field really is missing — a misspelled
          // `lockstring` reads as "absent", which is the one thing its "must be
          // a non-empty string" message does not say. A missing key anywhere
          // earlier means the path does not describe this project, so say
          // nothing rather than guess.
          return i === steps.length - 1
            ? { value: renderAuthoredValue(undefined), ...(recordId ? { recordId } : {}) }
            : null;
        }
      } else {
        current = (current as Record<string, unknown>)[step.key];
      }
    }
    // Remember the innermost record id seen on the way down, so the line can say
    // `cut-002` instead of only `episodes[0].cuts[1]`.
    if (current !== null && typeof current === "object" && !Array.isArray(current)) {
      const id = (current as { id?: unknown }).id;
      if (typeof id === "string" && id.length > 0) recordId = id;
    }
  }
  if (current !== null && typeof current === "object") return null;
  return { value: renderAuthoredValue(current), ...(recordId ? { recordId } : {}) };
}

/**
 * The "as authored" lines that follow the report, one per issue that resolves to
 * a single value. Empty when none do, so the refusal grows no noise for issues
 * this cannot help with.
 */
export function authoredValueLines(project: Project, issues: readonly ValidationIssue[]): string[] {
  const lines: string[] = [];
  for (const issue of issues) {
    const located = locateIssue(project, issue);
    if (located === null) continue;
    const where =
      located.recordId === undefined ? issue.path : `${issue.path} (${located.recordId})`;
    lines.push(`  ${where} is ${located.value}`);
  }
  return lines.length === 0 ? [] : ["as authored:", ...lines];
}
