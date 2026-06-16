// Structured lint findings. Every lint in this package returns findings in this
// shape so agents and (later) the CLI can branch on them deterministically.

/** Severity of a finding. `error` blocks; `warning`/`info` are advisory. */
export type Severity = "error" | "warning" | "info";

/** A single, actionable lint finding. */
export interface Finding {
  severity: Severity;
  /** Stable machine code, namespaced by source, e.g. `schema/...` or `image/...`. */
  code: string;
  /** What the finding is about: a record id, a project path, or an image id. */
  targetId: string;
  /** Actionable description of the problem. */
  message: string;
}

/** Build a finding (small helper to keep call sites terse and consistent). */
export function finding(
  severity: Severity,
  code: string,
  targetId: string,
  message: string,
): Finding {
  return { severity, code, targetId, message };
}

/** Deterministic ordering: by severity (error first), then code, then targetId. */
const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    if (a.severity !== b.severity) return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    if (a.targetId !== b.targetId) return a.targetId < b.targetId ? -1 : 1;
    return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
  });
}

/** True when no finding is an `error`. */
export function isClean(findings: readonly Finding[]): boolean {
  return !findings.some((f) => f.severity === "error");
}
