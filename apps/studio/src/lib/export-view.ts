// Client-safe export view types & formatting (issue #53).
//
// Split out from `@/lib/export` so the client export panel can share the
// constraint-check shape and byte formatter WITHOUT importing the headless
// `@toony/export` engine (which pulls the native `@napi-rs/canvas` binding and
// must stay server-only). The server module re-exports `formatBytes` from here so
// there is a single implementation.

/** A single pre-flight / constraint check row shown in the UI. */
export interface ConstraintCheck {
  /** Stable id so the UI can key rows without relying on label text. */
  id: string;
  label: string;
  /** "pass" = constraint satisfied; "review" = informational, worth a look. */
  status: "pass" | "review";
  detail: string;
}

/** Human-readable byte size for manifest/check display. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
