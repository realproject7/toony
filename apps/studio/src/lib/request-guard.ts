// The one request guard every Studio API route that changes something uses,
// plus the guarded read for the live feed and the workspace path.
//
// Studio listens on a loopback port. A page on any other site can still send a
// "simple" cross-site request there (a form post, a `text/plain` fetch), so a
// write is accepted only when ALL of these hold:
//   - the request reached a loopback host over http(s), and the browser's
//     Origin is that exact loopback origin (forwarded headers are not trusted);
//   - it carries `x-toony-agent: 1`, a custom header a cross-site page cannot
//     send without a CORS preflight Studio never answers;
//   - its body has the declared type (JSON, or an image for uploads);
//   - fetch metadata, when the browser sends it, says same-origin;
//   - it carries the HttpOnly, SameSite=Strict session cookie this server
//     process issued (so a page opened before a restart re-bootstraps).
// A read (GET) cannot require an Origin, because browsers omit it on
// same-origin GETs, so it requires the header, the cookie, a loopback host,
// and same-origin metadata and Origin whenever the browser sends them.

import { randomBytes, timingSafeEqual } from "node:crypto";

/** Request header every guarded browser call sends. Mirrors `AGENT_HEADER`. */
export const STUDIO_HEADER = "x-toony-agent";
/** Optional header naming the browser tab that made a change. */
export const CLIENT_HEADER = "x-toony-client";
/** Session cookie name. Kept from the agent route so existing tabs keep working. */
export const SESSION_COOKIE = "toony_agent_session";
/** Largest JSON body a Studio write accepts. */
export const JSON_BODY_MAX = 4 * 1024 * 1024;

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export class GuardError extends Error {
  constructor(
    public readonly code: "origin" | "session" | "body" | "size" | "type",
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

const ORIGIN_MESSAGE = "Open Toony from its local address to make changes.";

const guardGlobal = globalThis as typeof globalThis & { toonyAgentSecret?: string };

/** The per-process session secret. Shared with the agent route's cookie. */
function secret(): string {
  guardGlobal.toonyAgentSecret ??= randomBytes(32).toString("hex");
  return guardGlobal.toonyAgentSecret;
}

function mediaType(request: Request): string {
  return request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
}

function loopbackUrl(request: Request): URL {
  const url = new URL(request.url);
  if (!LOOPBACK.has(url.hostname) || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new GuardError("origin", ORIGIN_MESSAGE, 403);
  }
  return url;
}

function sameOriginMetadata(request: Request): void {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") throw new GuardError("origin", ORIGIN_MESSAGE, 403);
}

/** The Origin header parsed as a loopback origin that matches Host exactly. */
function assertOriginMatches(request: Request, url: URL, origin: string): void {
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    throw new GuardError("origin", ORIGIN_MESSAGE, 403);
  }
  if (
    !LOOPBACK.has(originUrl.hostname) ||
    originUrl.protocol !== url.protocol ||
    origin !== originUrl.origin ||
    request.headers.get("host") !== originUrl.host
  ) {
    throw new GuardError("origin", ORIGIN_MESSAGE, 403);
  }
}

/**
 * Check where a write comes from and what it carries. `body` names the body the
 * route reads: JSON, a raw image upload, or none.
 */
export function assertLocalRequest(
  request: Request,
  body: "json" | "image" | "none" = "json",
): void {
  const url = loopbackUrl(request);
  // Next may normalize the internal request URL to localhost. The browser's
  // Origin must still match the actual Host exactly.
  assertOriginMatches(request, url, request.headers.get("origin") ?? "");
  if (request.headers.get(STUDIO_HEADER) !== "1")
    throw new GuardError("origin", ORIGIN_MESSAGE, 403);
  sameOriginMetadata(request);
  const type = mediaType(request);
  if (body === "json" && type !== "application/json") {
    throw new GuardError("type", "Send this request as JSON.", 415);
  }
  if (body === "image" && !IMAGE_TYPES.has(type)) {
    throw new GuardError("type", "Choose a PNG, JPEG, WebP or GIF image.", 415);
  }
}

/** Check a guarded read: header, loopback host, and same-origin metadata when sent. */
export function assertLocalRead(request: Request): void {
  const url = loopbackUrl(request);
  const host = request.headers.get("host") ?? "";
  let hostName = "";
  try {
    hostName = new URL(`${url.protocol}//${host}`).hostname;
  } catch {
    throw new GuardError("origin", ORIGIN_MESSAGE, 403);
  }
  if (!LOOPBACK.has(hostName)) throw new GuardError("origin", ORIGIN_MESSAGE, 403);
  if (request.headers.get(STUDIO_HEADER) !== "1")
    throw new GuardError("origin", ORIGIN_MESSAGE, 403);
  sameOriginMetadata(request);
  const origin = request.headers.get("origin");
  if (origin !== null) assertOriginMatches(request, url, origin);
}

/** The session cookie for every Studio API path. */
export function sessionCookie(): string {
  return `${SESSION_COOKIE}=${secret()}; Path=/api; HttpOnly; SameSite=Strict`;
}

/** Clears the cookie older builds scoped to `/api/agent`, which would shadow the new one there. */
export function legacySessionCookieClear(): string {
  return `${SESSION_COOKIE}=; Path=/api/agent; Max-Age=0; HttpOnly; SameSite=Strict`;
}

/** Response headers that issue the session cookie. */
export function sessionHeaders(): Headers {
  const headers = new Headers({ "cache-control": "no-store" });
  headers.append("set-cookie", legacySessionCookieClear());
  headers.append("set-cookie", sessionCookie());
  return headers;
}

/** Require the session cookie this server process issued. Any matching value counts. */
export function assertSession(request: Request): void {
  const expected = Buffer.from(secret());
  const values =
    request.headers
      .get("cookie")
      ?.split(";")
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${SESSION_COOKIE}=`))
      .map((part) => part.slice(SESSION_COOKIE.length + 1)) ?? [];
  const valid = values.some(
    (value) => /^[a-f0-9]{64}$/.test(value) && timingSafeEqual(Buffer.from(value), expected),
  );
  if (!valid) throw new GuardError("session", "Reload Toony to reconnect.", 401);
}

/** Read the whole body, refusing more than `limit` bytes even without a length header. */
export async function readBodyBytes(request: Request, limit: number): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length")) > limit) {
    throw new GuardError("size", "This request is too large.", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new GuardError("body", "The request is incomplete.", 400);
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new GuardError("size", "This request is too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/** Read a JSON object body within `limit` bytes. */
export async function readJsonBody(
  request: Request,
  limit = JSON_BODY_MAX,
): Promise<Record<string, unknown>> {
  const bytes = await readBodyBytes(request, limit);
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new GuardError("body", "The request is incomplete.", 400);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GuardError("body", "The request is incomplete.", 400);
  }
  return value as Record<string, unknown>;
}

/** Guard a JSON write and return its body. */
export async function guardJsonWrite(
  request: Request,
  limit = JSON_BODY_MAX,
): Promise<Record<string, unknown>> {
  assertLocalRequest(request, "json");
  assertSession(request);
  return readJsonBody(request, limit);
}

/** The tab id a guarded browser call names, when it is well formed. */
export function clientIdOf(request: Request): string | undefined {
  const value = request.headers.get(CLIENT_HEADER);
  return value !== null && /^[A-Za-z0-9-]{8,64}$/.test(value) ? value : undefined;
}

/** A JSON error response for a refused request, or null when `error` is not a guard refusal. */
export function guardFailure(error: unknown): Response | null {
  if (!(error instanceof GuardError)) return null;
  return Response.json(
    { ok: false, code: error.code, error: error.message },
    { status: error.status, headers: { "cache-control": "no-store" } },
  );
}
