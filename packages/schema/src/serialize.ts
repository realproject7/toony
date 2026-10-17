// Canonical, lossless serialization for the in-memory project model.
//
// Round-trip guarantee: for any value the validators accept, parsing the
// serialized form yields a structure deeply equal to the original, and
// re-serializing is byte-stable. Object keys are emitted in sorted order so the
// output is deterministic regardless of in-memory key insertion order.

import type { Project } from "./types.js";

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortValue(source[key]);
    }
    return sorted;
  }
  return value;
}

/** Serialize a project to deterministic JSON (sorted keys, 2-space indent). */
export function serializeProject(project: Project): string {
  return `${JSON.stringify(sortValue(project), null, 2)}\n`;
}

/**
 * Parse a serialized project back into the model. The returned value is typed
 * as Project for convenience; callers that accept untrusted input should run
 * `validateProject` on the result to confirm conformance.
 */
export function parseProject(text: string): Project {
  return JSON.parse(text) as Project;
}
