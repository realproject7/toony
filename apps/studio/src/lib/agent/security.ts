import { randomBytes, timingSafeEqual } from "node:crypto";
import { AgentError } from "./types.js";

const COOKIE = "toony_agent_session";
const securityGlobal = globalThis as typeof globalThis & { toonyAgentSecret?: string };
function secret(): string {
  securityGlobal.toonyAgentSecret ??= randomBytes(32).toString("hex");
  return securityGlobal.toonyAgentSecret;
}
export function assertAgentOrigin(request: Request): void {
  const url = new URL(request.url);
  // Next may normalize the internal request URL to localhost. The browser's
  // origin must still match the actual Host exactly; forwarded headers are not trusted.
  const origin = request.headers.get("origin");
  let originUrl: URL;
  try {
    originUrl = new URL(origin ?? "");
  } catch {
    throw new AgentError("origin", "Open the agent from your local Toony workspace.", 403);
  }
  if (
    !new Set(["localhost", "127.0.0.1", "[::1]"]).has(url.hostname) ||
    !new Set(["http:", "https:"]).has(url.protocol) ||
    !new Set(["localhost", "127.0.0.1", "[::1]"]).has(originUrl.hostname) ||
    originUrl.protocol !== url.protocol ||
    origin !== originUrl.origin ||
    request.headers.get("host") !== originUrl.host ||
    request.headers.get("x-toony-agent") !== "1" ||
    request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json" ||
    (request.headers.has("sec-fetch-site") &&
      request.headers.get("sec-fetch-site") !== "same-origin")
  ) {
    throw new AgentError("origin", "Open the agent from your local Toony workspace.", 403);
  }
}
export function agentCookie(): string {
  return `${COOKIE}=${secret()}; Path=/api/agent; HttpOnly; SameSite=Strict`;
}
export function assertAgentSession(request: Request): void {
  const value =
    request.headers
      .get("cookie")
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1) ?? "";
  if (
    !/^[a-f0-9]{64}$/.test(value) ||
    !timingSafeEqual(Buffer.from(value), Buffer.from(secret()))
  ) {
    throw new AgentError("session", "Reconnect to the local workspace.", 401);
  }
}
export async function agentBody(request: Request): Promise<Record<string, unknown>> {
  const limit = 32_768;
  if (Number(request.headers.get("content-length")) > limit)
    throw new AgentError("size", "This message is too long.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AgentError("body", "The request is incomplete.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new AgentError("size", "This message is too long.", 413);
      }
      chunks.push(value);
    }
    const result: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error();
    return result as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AgentError) throw error;
    throw new AgentError("body", "The request is incomplete.");
  } finally {
    reader.releaseLock();
  }
}
export function agentResponse(body: unknown, status = 200, cookie = false): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...(cookie ? { "set-cookie": agentCookie() } : {}) },
  });
}
