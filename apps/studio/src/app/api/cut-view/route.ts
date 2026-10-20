// A cut's image view (CMP-01), one change per request:
//   { workId, episodeId, cutId, view: {x, y, width, height} | null }
//   { workId, episodeId, cutId, fromCutId, view }: use another cut's picture here
// The view is in fractions of the picture; null shows all of it. Answers
// `{ ok: true, changeId }`.

import type { ImageView } from "@toony/schema";
import { handleWrite, json, stringField, workOf } from "@/lib/api-route";
import { contextFor, reuseCutPicture, setCutImageView } from "@/lib/ops";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function viewOf(value: unknown): ImageView | null | undefined {
  if (value === null) return null;
  if (typeof value !== "object" || value === undefined) return undefined;
  const v = value as Record<string, unknown>;
  const numbers = [v.x, v.y, v.width, v.height];
  if (!numbers.every((n) => typeof n === "number" && Number.isFinite(n))) return undefined;
  return {
    x: v.x as number,
    y: v.y as number,
    width: v.width as number,
    height: v.height as number,
  };
}

export async function POST(request: Request): Promise<Response> {
  return handleWrite(request, async ({ body, info }) => {
    const resolved = await workOf(body);
    if ("response" in resolved) return resolved.response;
    const episodeId = stringField(body, "episodeId");
    const cutId = stringField(body, "cutId");
    const view = viewOf(body.view);
    if (episodeId === undefined || cutId === undefined || view === undefined) {
      return json({ ok: false, error: "Name the cut and its frame." }, 400);
    }
    const ctx = contextFor(resolved.work.root, { ...info, workId: resolved.work.id });
    const fromCutId = stringField(body, "fromCutId");
    const change =
      fromCutId === undefined
        ? await setCutImageView(ctx, episodeId, cutId, view)
        : await reuseCutPicture(ctx, episodeId, cutId, fromCutId, view);
    return json({ ok: true, changeId: change?.changeId ?? null });
  });
}
