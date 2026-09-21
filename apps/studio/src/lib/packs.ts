// Server-side pack discovery. Create uses the workspace root; an episode uses
// its work root, matching CLI init and plan, including relative TOONY_PACKS.
import { loadPacks, type PackContent } from "@toony/packs";
import { buildInitialProject, GENRES, listGenreIds, resolveGenreSeed } from "@toony/project-io";

export async function discoverStudioPacks(
  root: string,
  env: Record<string, string | undefined> = process.env,
) {
  const loaded = await loadPacks(root, env);
  const ids = await listGenreIds(loaded.content.genres);
  return {
    content: loaded.content,
    genreOptions: ids.map((id) => ({
      id,
      title: GENRES.some((core) => core === id)
        ? id
        : (loaded.content.genres.find((genre) => genre.id === id)?.title ?? id),
    })),
    craftBandOptions: [...loaded.content.craftBands.keys()].map((id) => ({ id, title: id })),
    // `PackIssue.pack` is an absolute local path. The Studio can explain what
    // went wrong without exposing its user's filesystem layout in the browser.
    warnings: loaded.issues.map(
      (issue) => `Pack warning [${issue.code}] ${issue.path}: ${issue.message}`,
    ),
  };
}

export interface CreateWorkPayload {
  name: string;
  genre?: string;
}

export function isCreateWorkPayload(value: unknown): value is CreateWorkPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.name === "string" && (v.genre === undefined || typeof v.genre === "string");
}

/** The same registry and scaffold calls as CLI init. Null means a stale choice. */
export async function buildStudioProject(
  name: string,
  genre: string | undefined,
  packs: PackContent,
) {
  if (genre === undefined || genre.trim() === "") return buildInitialProject(name);
  const seed = await resolveGenreSeed(genre, packs.genres);
  if (!seed) return null;
  return buildInitialProject(
    name,
    seed.bundle,
    seed.gutterBandWidth === undefined ? {} : { gutterBandWidth: seed.gutterBandWidth },
  );
}
