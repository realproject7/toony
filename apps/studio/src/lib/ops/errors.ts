// Refusals and failures of a Studio write, with a message a person can read.
// Messages never carry absolute paths; the cause is kept for logs only.

export type OpErrorCode =
  | "not-found"
  | "invalid"
  | "conflict"
  | "stale"
  | "refused"
  | "too-large"
  | "failed";

const STATUS: Record<OpErrorCode, number> = {
  "not-found": 404,
  invalid: 400,
  conflict: 409,
  stale: 409,
  refused: 409,
  "too-large": 413,
  failed: 500,
};

export class OpError extends Error {
  constructor(
    public readonly code: OpErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }

  get status(): number {
    return STATUS[this.code];
  }
}

/** The JSON response for an `OpError`, or null for any other error. */
export function opFailure(error: unknown): Response | null {
  if (!(error instanceof OpError)) return null;
  return Response.json(
    { ok: false, code: error.code, error: error.message },
    { status: error.status, headers: { "cache-control": "no-store" } },
  );
}
