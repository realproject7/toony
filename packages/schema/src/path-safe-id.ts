// Path-safe id predicate for ids that are later used as filesystem path segments.
//
// Episode ids are joined into `episodes/<id>/...` by `@toony/project-io` and the
// export engine. A non-empty-string check alone is not enough: an id such as
// `../../outside` or `/etc` passes a string check but would let a write or export
// escape the work tree. This predicate is the single rule for ids that ever
// become a path segment, so the schema validator, project-io path helpers, and
// Studio routes all reject the same unsafe ids. It is intentionally strict: a
// safe segment-id may not contain a path separator, NUL, be absolute, or be a
// `.`/`..` traversal token.

/**
 * Whether `id` is safe to use verbatim as a single filesystem path segment.
 * Rejects: non-strings, empty, `/`, `\`, NUL, a Windows drive-letter absolute
 * prefix, and the `.`/`..` traversal tokens. Plain ids like `ep-001` pass.
 */
export function isPathSafeId(id: unknown): id is string {
  if (typeof id !== "string" || id.length === 0) return false;
  if (id === "." || id === "..") return false;
  if (id.includes("/") || id.includes("\\") || id.includes("\0")) return false;
  // Reject a Windows drive-letter absolute prefix (e.g. `C:`), which the
  // separator checks above do not catch on POSIX where `:` is a legal char.
  if (/^[a-zA-Z]:/.test(id)) return false;
  return true;
}
