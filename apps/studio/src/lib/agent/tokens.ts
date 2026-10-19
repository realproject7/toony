// One bearer token per running agent turn. The MCP bridge presents it on every
// tool call; the tools route accepts a call only while the turn runs. Tokens
// are random, compared in constant time, never logged, and revoked when the
// turn ends. The registry lives on globalThis because Next bundles the agent
// route and the tools route separately.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface TurnGrant {
  conversationId: string;
  turnId: string;
}

interface Entry {
  digest: Buffer;
  grant: TurnGrant;
}

const tokenGlobal = globalThis as typeof globalThis & { toonyAgentTokens?: Map<string, Entry> };
tokenGlobal.toonyAgentTokens ??= new Map();
const registry = tokenGlobal.toonyAgentTokens;

function digest(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

/** Issue a token for a turn. */
export function issueTurnToken(grant: TurnGrant): string {
  const token = randomBytes(32).toString("hex");
  registry.set(grant.turnId, { digest: digest(token), grant: { ...grant } });
  return token;
}

/** Revoke the token of a turn. */
export function revokeTurnToken(turnId: string): void {
  registry.delete(turnId);
}

/** The turn a presented token belongs to, or null. Every live token is compared. */
export function resolveTurnToken(token: string | null | undefined): TurnGrant | null {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return null;
  const presented = digest(token);
  let found: TurnGrant | null = null;
  for (const entry of registry.values()) {
    if (timingSafeEqual(entry.digest, presented) && found === null) found = entry.grant;
  }
  return found ? { ...found } : null;
}

/** The token of an `Authorization: Bearer <token>` header. */
export function bearerToken(header: string | null): string | null {
  if (header === null) return null;
  const match = /^Bearer ([a-f0-9]{64})$/.exec(header.trim());
  return match ? (match[1] ?? null) : null;
}

/** Number of live tokens, for tests. */
export function liveTokenCount(): number {
  return registry.size;
}
