// Shared plumbing for Studio's guarded write routes: check the request with
// the Studio request guard, read its JSON body, run the change, and turn
// refusals into JSON errors a person can read. Never returns a path.

import { type ActorInfo, opFailure } from "./ops/index.js";
import { clientIdOf, guardFailure, guardJsonWrite } from "./request-guard.js";
import { type ResolvedWork, resolveWork } from "./workspace.js";

export interface WriteRequest {
  body: Record<string, unknown>;
  /** Actor info for a human write from this tab. */
  info: ActorInfo;
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/** Guard a JSON write route and run it. `fallback` is the message for an unexpected failure. */
export async function handleWrite(
  request: Request,
  run: (input: WriteRequest) => Promise<Response>,
  fallback = "Toony could not save this change.",
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await guardJsonWrite(request);
  } catch (error) {
    return guardFailure(error) ?? json({ ok: false, error: "The request is incomplete." }, 400);
  }
  const clientId = clientIdOf(request);
  try {
    return await run({ body, info: { actor: "human", ...(clientId ? { clientId } : {}) } });
  } catch (error) {
    return opFailure(error) ?? json({ ok: false, error: fallback }, 500);
  }
}

/** A string field of a request body, or undefined. */
export function stringField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" ? value : undefined;
}

/** Resolve `body.workId` through the workspace scan, or answer 404. */
export async function workOf(
  body: Record<string, unknown>,
): Promise<{ work: ResolvedWork } | { response: Response }> {
  const workId = stringField(body, "workId") ?? "";
  const work = await resolveWork(workId);
  if (!work)
    return { response: json({ ok: false, error: "This webtoon is not in the workspace." }, 404) };
  return { work };
}
