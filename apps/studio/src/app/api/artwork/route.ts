// Add artwork to a cut: `POST /api/artwork?workId=&episodeId=&cutId=[&slot=clean|final]`
// with the raw image as the body (`content-type: image/png|jpeg|webp|gif`), up
// to 30 MB. Stored the way `toony import-image` stores a file. Answers
// `{ ok: true, image, slot, change, changeId }`.

import { json } from "@/lib/api-route";
import { ARTWORK_BYTES_MAX, contextFor, importArtwork, opFailure } from "@/lib/ops";
import {
  assertLocalRequest,
  assertSession,
  clientIdOf,
  guardFailure,
  readBodyBytes,
} from "@/lib/request-guard";
import { resolveWork } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let bytes: Uint8Array;
  try {
    assertLocalRequest(request, "image");
    assertSession(request);
    bytes = await readBodyBytes(request, ARTWORK_BYTES_MAX);
  } catch (error) {
    return (
      guardFailure(error) ??
      json({ ok: false, error: "The upload did not finish. Try again." }, 400)
    );
  }
  const params = new URL(request.url).searchParams;
  const work = await resolveWork(params.get("workId") ?? "");
  if (!work) return json({ ok: false, error: "This webtoon is not in the workspace." }, 404);
  const episodeId = params.get("episodeId") ?? "";
  const cutId = params.get("cutId") ?? "";
  const slotParam = params.get("slot");
  const slot = slotParam === "clean" || slotParam === "final" ? slotParam : undefined;
  const clientId = clientIdOf(request);
  try {
    const imported = await importArtwork(
      contextFor(work.root, { actor: "human", workId: work.id, ...(clientId ? { clientId } : {}) }),
      episodeId,
      cutId,
      bytes,
      slot,
    );
    return json({ ok: true, ...imported, changeId: imported.change?.changeId ?? null });
  } catch (error) {
    return opFailure(error) ?? json({ ok: false, error: "Toony could not add this artwork." }, 500);
  }
}
