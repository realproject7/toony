// Schema and sequence-reference lints.
//
// These consume `@toony/schema`'s validators rather than reimplementing them:
// the schema package owns structural validity, canonical ordering, duplicate
// ids, missing records, and referential integrity. This module maps each
// validation issue to a lint finding so schema problems surface in the same
// report as image problems.

import { type ValidationIssue, validateProject } from "@toony/schema";
import { type Finding, finding } from "./findings.js";

function issueToFinding(issue: ValidationIssue): Finding {
  // Structural schema/reference problems block production; map them to errors.
  // `targetId` is the validator path, which precisely locates the offending
  // record or field (e.g. `episodes[0].cuts[1].id`).
  return finding("error", `schema/${issue.code}`, issue.path, issue.message);
}

/**
 * Lint a project against the shared schema. Returns one finding per schema
 * issue, including sequence-reference problems (missing/orphan records,
 * adjacent transitions). An empty array means the project is structurally valid.
 */
export function lintProjectSchema(project: unknown): Finding[] {
  return validateProject(project).issues.map(issueToFinding);
}
