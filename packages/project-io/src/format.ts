// Deterministic encode/decode for the two on-disk formats.
//
// Both encoders emit stable, diff-friendly output with keys in sorted order so
// re-writing an unchanged project is byte-stable and version-control diffs stay
// minimal. Decoders return `unknown`; callers hand the result to
// `@toony/schema` validators rather than trusting the shape.

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/** Recursively sort object keys so encoded output is order-independent. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) sorted[key] = sortKeys(source[key]);
    return sorted;
  }
  return value;
}

/** Encode a value as deterministic JSON (sorted keys, 2-space indent, trailing newline). */
export function encodeJson(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

/** Parse JSON text into an untrusted value. Throws on malformed input. */
export function decodeJson(text: string): unknown {
  return JSON.parse(text);
}

/**
 * Encode a value as stable YAML: keys sorted, 2-space indent, block style.
 * `sortMapEntries` keeps map keys ordered regardless of in-memory insertion
 * order, which makes the output deterministic and diff-friendly.
 */
export function encodeYaml(value: unknown): string {
  return stringifyYaml(value, {
    indent: 2,
    sortMapEntries: true,
    lineWidth: 0,
  });
}

/** Parse YAML text into an untrusted value. Throws on malformed input. */
export function decodeYaml(text: string): unknown {
  return parseYaml(text);
}
