// New-work scaffold endpoint for the workspace library (issue #51).
//
// The studio is local-first and account-free: this route is the server write
// path the library's "New webtoon" action uses to create a work. It mirrors
// `toony init` exactly — `buildInitialProject(name)` then `writeProject` — so a
// freshly created work is a valid project that passes validation.
//
// Path safety: the work folder name is derived from the title by `slugify`, which
// emits only `[a-z0-9-]` (or the literal "untitled"), so it can never contain a
// separator, `..`, or a leading slash. The target is then joined onto the
// workspace root and re-checked to be a direct child of it before any bytes are
// written; an existing folder is refused rather than overwritten.

import { mkdir, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import { slugify, writeProject } from "@toony/project-io";
import { safeErrorMessage } from "@/lib/errors";
import { buildStudioProject, discoverStudioPacks, isCreateWorkPayload } from "@/lib/packs";
import { workspaceRoot } from "@/lib/workspace";

export const dynamic = "force-dynamic";

function badRequest(message: string): Response {
  return Response.json({ ok: false, error: message }, { status: 400 });
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return badRequest("request body must be valid JSON");
  }
  if (!isCreateWorkPayload(payload)) {
    return badRequest("request body must be { name: string, genre?: string }");
  }
  const name = payload.name.trim();
  if (name.length === 0) {
    return badRequest("name must not be empty");
  }

  // The folder id is the slug of the title: only [a-z0-9-], never a path.
  const id = slugify(name);
  const root = workspaceRoot();
  const target = join(root, id);

  // Defense in depth: the slug cannot escape, but verify the joined target is a
  // direct child of the workspace root before writing anything.
  const expectedPrefix = root.endsWith(sep) ? root : root + sep;
  if (!target.startsWith(expectedPrefix) || target.slice(expectedPrefix.length).includes(sep)) {
    return badRequest("invalid work name");
  }

  if (await exists(target)) {
    return badRequest(`a work named "${id}" already exists`);
  }

  try {
    // Re-discover at submit time: a removed pack must never silently create a
    // different starter than the one the author selected.
    const packs = await discoverStudioPacks(root);
    const project = await buildStudioProject(name, payload.genre, packs.content);
    if (!project) {
      return badRequest(
        `Starter "${payload.genre}" is no longer available. Choose another starter or the bare default.`,
      );
    }
    // First-run: the workspace root (e.g. ~/Documents/Toony) may not exist yet.
    // `writeProject` creates only the work folder non-recursively and requires
    // its parent to exist, so ensure the workspace root first — otherwise a
    // first-ever "New webtoon" would fail with ENOENT on a missing root (#75).
    await mkdir(root, { recursive: true });
    await writeProject(target, project);
  } catch (cause) {
    return Response.json(
      { ok: false, error: safeErrorMessage(cause, "could not create the work") },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, id });
}
