// Human-readable and structured rendering of validation results.

import type { ValidationResult } from "@toony/schema";

/** Structured payload emitted by `toony validate --json`. */
export interface ValidateJsonReport {
  root: string;
  valid: boolean;
  issueCount: number;
  issues: ValidationResult["issues"];
}

/** Build the `--json` payload for a validated project. */
export function jsonReport(root: string, result: ValidationResult): ValidateJsonReport {
  return {
    root,
    valid: result.valid,
    issueCount: result.issues.length,
    issues: result.issues,
  };
}

/** Render a validation result as readable text for a terminal. */
export function textReport(root: string, result: ValidationResult): string {
  if (result.valid) {
    return `valid: ${root}`;
  }
  const lines = [`invalid: ${root}`, `${result.issues.length} issue(s):`];
  for (const issue of result.issues) {
    lines.push(`  - [${issue.code}] ${issue.path}`);
    lines.push(`    ${issue.message}`);
  }
  return lines.join("\n");
}
