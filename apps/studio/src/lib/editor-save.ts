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

/** JSON body shape the studio save routes return. */
interface SaveResponseBody {
  ok: boolean;
  error?: string;
}

export type SaveOutcome = { ok: true; clean: boolean } | { ok: false; error: string };

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

  let data: SaveResponseBody;
  try {
    data = (await response.json()) as SaveResponseBody;
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  }

  if (!response.ok || !data.ok) {
    return { ok: false, error: data.error ?? "Save failed." };
  }

  // An edit that landed while the request was in flight advanced the generation,
  // so the just-saved snapshot is already stale: reconcile by staying dirty.
  const clean = args.readGeneration() === args.generationAtStart;
  return { ok: true, clean };
}
