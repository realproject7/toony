// Issue this tab's session cookie. The page calls this once before its first
// guarded request (`studioFetch` does it). The request must come from the
// local Studio origin with `x-toony-agent: 1`; it carries no data.

import { assertLocalRequest, guardFailure, sessionHeaders } from "@/lib/request-guard";
import { ensureWorkspaceRoot } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    assertLocalRequest(request, "json");
  } catch (error) {
    return guardFailure(error) ?? Response.json({ ok: false }, { status: 403 });
  }
  // A fresh install has no workspace folder yet; everything else expects one.
  await ensureWorkspaceRoot().catch(() => {});
  return Response.json({ ok: true }, { headers: sessionHeaders() });
}
