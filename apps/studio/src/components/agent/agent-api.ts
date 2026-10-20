// The panel's one door to the agent service: `POST /api/agent` through the
// guarded Studio fetch (session bootstrap, header, tab id). Answers are read
// tolerantly with `readActionResult`; failures become plain-language errors.

import type { AgentAction } from "@/lib/agent/protocol";
import { studioFetch } from "@/lib/studio-fetch";

export class AgentRequestError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly status: number,
  ) {
    super(message);
  }
}

const FALLBACK = "The agent service did not answer. Check that Toony is still running.";

export async function callAgent(action: AgentAction): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await studioFetch("/api/agent", {
      method: "POST",
      body: JSON.stringify(action),
    });
  } catch {
    throw new AgentRequestError(FALLBACK, null, 0);
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    // An empty or non-JSON answer falls through to the status check.
  }
  if (!response.ok || body.ok === false) {
    const message = typeof body.error === "string" && body.error.trim() ? body.error : FALLBACK;
    throw new AgentRequestError(
      message,
      typeof body.code === "string" ? body.code : null,
      response.status,
    );
  }
  return body;
}

export function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function newRequestId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  if (random) return random;
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
