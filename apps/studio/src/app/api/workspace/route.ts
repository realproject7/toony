// Where this Studio keeps its webtoons, for display (Settings, the library).
// A guarded read: the page must send `x-toony-agent: 1` and its session cookie
// from the local Studio origin, so another site cannot learn the path.

import { assertLocalRead, assertSession, guardFailure } from "@/lib/request-guard";
import { workspaceInfo } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    assertLocalRead(request);
    assertSession(request);
  } catch (error) {
    return guardFailure(error) ?? Response.json({ ok: false }, { status: 403 });
  }
  return Response.json(
    { ok: true, ...(await workspaceInfo()) },
    { headers: { "cache-control": "no-store" } },
  );
}
