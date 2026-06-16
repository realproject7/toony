// Error type for export failures, with a stable code for callers.

export class ExportError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ExportError";
    this.code = code;
  }
}
