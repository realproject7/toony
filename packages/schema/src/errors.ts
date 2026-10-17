// Validation result model. Validators never throw on invalid input; they return
// a result with actionable issues so agents and the CLI can branch on them.

/** A single validation problem with a machine code and a human-readable message. */
export interface ValidationIssue {
  /** Dotted path to the offending value, e.g. `languages.defaultLanguage`. */
  path: string;
  /** Stable machine code, e.g. `language.default-not-supported`. */
  code: string;
  /** Actionable description of what is wrong and how to fix it. */
  message: string;
}

/** The outcome of validating a value: valid when there are zero issues. */
export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/** Collects issues during a validation pass and produces a result. */
export class IssueCollector {
  private readonly issues: ValidationIssue[] = [];

  add(path: string, code: string, message: string): void {
    this.issues.push({ path, code, message });
  }

  get length(): number {
    return this.issues.length;
  }

  result(): ValidationResult {
    return { valid: this.issues.length === 0, issues: [...this.issues] };
  }
}

/** Join a parent path and key into a dotted/indexed path. */
export function joinPath(parent: string, key: string | number): string {
  if (parent === "") return typeof key === "number" ? `[${key}]` : key;
  return typeof key === "number" ? `${parent}[${key}]` : `${parent}.${key}`;
}
