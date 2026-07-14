// Shared save-flow reconciliation for the studio editors (#150).
//
// The cut and transition editors stay fully interactive while a save is in
// flight (only the Save button is disabled), so a user edit can land DURING the
// await. This helper persists the snapshot the caller already captured and
// reconciles dirtiness with an edit-generation guard: if the caller's edit
// generation advanced while the request was in flight, an edit landed mid-save,
// so the editor must STAY dirty (`clean: false`) — it must never revert state to
// the snapshot nor falsely mark itself clean. Pure and React-free, so it runs
// under the repo-standard `node:test` harness (#157).

/** The minimal response shape this helper needs (a `fetch` Response satisfies it). */
export interface SaveResponse {
  ok: boolean;
  json: () => Promise<unknown>;
}

export type SaveOutcome = { ok: true; clean: boolean } | { ok: false; error: string };

/**
 * Read the save routes' `{ ok, error }` body defensively. A malformed body —
 * `null`, a non-object, or a non-boolean `ok` — is treated as a failed save
 * (`ok: false`), never a thrown property access, so a stray `null` payload can't
 * crash the (catch-free) save handlers.
 */
function readBody(parsed: unknown): { ok: boolean; error?: string } {
  if (typeof parsed !== "object" || parsed === null) return { ok: false };
  const record = parsed as Record<string, unknown>;
  return {
    ok: record.ok === true,
    error: typeof record.error === "string" ? record.error : undefined,
  };
}

/**
 * Run a persist request and decide whether the editor may mark itself clean.
 * `generationAtStart` is the edit generation the caller captured BEFORE building
 * its snapshot payload; `readGeneration` returns the current generation, read
 * AFTER the request resolves. When the generation advanced, an edit landed while
 * the request was in flight, so the saved snapshot is already stale and the
 * editor stays dirty. Never throws — request/parse failures return `ok: false`.
 */
export async function persistWithGuard(args: {
  request: () => Promise<SaveResponse>;
  generationAtStart: number;
  readGeneration: () => number;
}): Promise<SaveOutcome> {
  let response: SaveResponse;
  try {
    response = await args.request();
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  }

  const body = readBody(parsed);
  if (!response.ok || !body.ok) {
    return { ok: false, error: body.error ?? "Save failed." };
  }

  // An edit that landed while the request was in flight advanced the generation,
  // so the just-saved snapshot is already stale: reconcile by staying dirty.
  const clean = args.readGeneration() === args.generationAtStart;
  return { ok: true, clean };
}
