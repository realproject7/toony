// Primitive runtime type guards used by the validators. Each guard narrows an
// `unknown` value so validation code stays explicit about what it accepts.

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/** A number within the inclusive 0..1 normalized range. */
export function isNormalizedUnit(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}
