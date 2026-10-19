// The agent route's request checks. They are the shared Studio request guard
// (`../request-guard`), re-expressed as `AgentError`s so the agent route and
// the routes that adopted these names keep their contract.

import {
  assertLocalRequest,
  assertSession,
  GuardError,
  readJsonBody,
  sessionCookie,
  sessionHeaders,
} from "../request-guard.js";
import { AgentError } from "./types.js";

function asAgentError(error: unknown): unknown {
  if (!(error instanceof GuardError)) return error;
  if (error.code === "origin" || error.code === "type") {
    return new AgentError("origin", "Open the agent from your local Toony workspace.", 403);
  }
  if (error.code === "session") {
    return new AgentError("session", "Reconnect to the local workspace.", 401);
  }
  if (error.code === "size") return new AgentError("size", "This message is too long.", 413);
  return new AgentError("body", "The request is incomplete.");
}

/** Loopback origin, `x-toony-agent: 1`, a JSON body and same-origin metadata. */
export function assertAgentOrigin(request: Request): void {
  try {
    assertLocalRequest(request, "json");
  } catch (error) {
    throw asAgentError(error);
  }
}

export function agentCookie(): string {
  return sessionCookie();
}

export function assertAgentSession(request: Request): void {
  try {
    assertSession(request);
  } catch (error) {
    throw asAgentError(error);
  }
}

export async function agentBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return await readJsonBody(request, 32_768);
  } catch (error) {
    throw asAgentError(error);
  }
}

export function agentResponse(body: unknown, status = 200, cookie = false): Response {
  const headers = cookie ? sessionHeaders() : new Headers({ "cache-control": "no-store" });
  return Response.json(body, { status, headers });
}
