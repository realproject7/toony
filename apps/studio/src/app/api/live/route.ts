// The live feed: one long-lived NDJSON stream per tab (`hello`, missed events
// or `resync`, then every new project and agent event, a `ping` every 15 s).
// Guarded like the agent route, as a read: `x-toony-agent: 1`, the session
// cookie, a loopback host and same-origin fetch metadata.

import { liveBus } from "@/lib/live/bus";
import { liveStreamParams, openLiveStream } from "@/lib/live/stream";
import { assertLocalRead, assertSession, guardFailure } from "@/lib/request-guard";
import { ensureWorkspaceRoot } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    assertLocalRead(request);
    assertSession(request);
  } catch (error) {
    return guardFailure(error) ?? Response.json({ ok: false }, { status: 403 });
  }
  await ensureWorkspaceRoot().catch(() => {});
  const { since, serverId } = liveStreamParams(new URL(request.url));
  const stream = openLiveStream(liveBus(), { since, serverId, signal: request.signal });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
      "x-content-type-options": "nosniff",
    },
  });
}
