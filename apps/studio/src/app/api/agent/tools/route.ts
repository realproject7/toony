// Tool calls from the Toony MCP bridge of a running agent turn. The bridge is a
// local Node process, not a browser: it authenticates with the turn's bearer
// token (random, single turn, revoked when the turn ends) instead of the
// session cookie. Browser requests are refused outright (no Origin or fetch
// metadata is accepted), and only a loopback host is served. The body is
// `{ name, arguments }`; the answer is an MCP tool result
// `{ content: [{ type: "text" | "image", ... }], isError? }`.

import { agentRuntime } from "@/lib/agent/server";
import { bearerToken } from "@/lib/agent/tokens";
import { GuardError, readJsonBody } from "@/lib/request-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const TOOL_BODY_MAX = 4 * 1024 * 1024;

function refuse(status: number, text: string): Response {
  return Response.json(
    { content: [{ type: "text", text }], isError: true },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request): Promise<Response> {
  let host = "";
  try {
    host = new URL(`http://${request.headers.get("host") ?? ""}`).hostname;
  } catch {
    host = "";
  }
  if (!LOOPBACK.has(new URL(request.url).hostname) || !LOOPBACK.has(host)) {
    return refuse(403, "Tool calls are only accepted on this computer.");
  }
  if (request.headers.get("origin") !== null || request.headers.get("sec-fetch-site") !== null) {
    return refuse(403, "Tool calls are not accepted from a browser.");
  }
  const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") return refuse(415, "Send tool calls as JSON.");
  const token = bearerToken(request.headers.get("authorization"));
  if (token === null) return refuse(401, "This tool call has no valid turn token.");
  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(request, TOOL_BODY_MAX);
  } catch (error) {
    return refuse(error instanceof GuardError ? error.status : 400, "The tool call is incomplete.");
  }
  const name = typeof body.name === "string" ? body.name : "";
  try {
    const agent = await agentRuntime();
    const result = await agent.callTool(token, name, body.arguments);
    if (result === null) return refuse(401, "This turn has ended. Toony did not run the tool.");
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch {
    return refuse(500, "Toony could not run this tool. Nothing was changed.");
  }
}
