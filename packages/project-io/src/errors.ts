// IO-layer error type.
//
// `ProjectIoError` signals a filesystem or parse failure (missing file,
// unreadable directory, malformed YAML/JSON) — distinct from schema validation
// problems, which are returned as a `ValidationResult` rather than thrown.

export class ProjectIoError extends Error {
  constructor(
    message: string,
    /** The file or directory that caused the failure. */
    readonly file: string,
  ) {
    super(message);
    this.name = "ProjectIoError";
  }
}
