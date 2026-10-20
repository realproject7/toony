// Server-side page data shared by a page and its metadata: one project load
// per request, resolved path-safely from the URL's work id.

import { cache } from "react";
import { loadWork, ProjectIoError } from "./project.js";
import { type ResolvedWork, resolveWork } from "./workspace.js";

export type WorkPageData =
  | { kind: "missing" }
  | { kind: "error"; work: ResolvedWork; reason: string }
  | { kind: "ok"; work: ResolvedWork; loaded: Awaited<ReturnType<typeof loadWork>> };

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Resolve and load a work for a page. Cached per request. */
export const workPageData = cache(async (rawWorkId: string): Promise<WorkPageData> => {
  const work = await resolveWork(decode(rawWorkId));
  if (!work) return { kind: "missing" };
  try {
    return { kind: "ok", work, loaded: await loadWork(work.root) };
  } catch (cause) {
    const reason = cause instanceof ProjectIoError ? cause.message : String(cause);
    return { kind: "error", work, reason };
  }
});

/** The webtoon title for a page title, or a fallback. */
export async function workTitle(rawWorkId: string): Promise<string> {
  const data = await workPageData(rawWorkId);
  return data.kind === "ok" ? data.loaded.project.webtoon.title : "Webtoon";
}

/** Decode a route segment safely. */
export function routeParam(value: string): string {
  return decode(value);
}
