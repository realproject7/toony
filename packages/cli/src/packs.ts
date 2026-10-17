// Pack discovery for the CLI: find the installed packs once per command and
// hand the resolved content down to the registries that merge it with the core's
// built-ins (#192).
//
// The CLI is the only package that knows packs exist. `@toony/project-io`,
// `@toony/export`, and `@toony/providers` each take the contributed content as
// an argument, so the seam is a one-way edge: nothing in the core has to import
// the pack loader, and with no packs installed every registry sees an empty list
// and behaves exactly as it did before this seam existed.
//
// A malformed pack is reported on stderr and skipped — the command continues
// with the packs that are valid, so one bad pack can never take the tool down.

import { loadPacks, type PackContent } from "@toony/packs";

export interface PackIo {
  err: (line: string) => void;
  env?: Record<string, string | undefined>;
}

/**
 * Discover the packs visible from `root` and return their merged content,
 * printing an actionable warning for every pack problem found.
 */
export async function discoverPackContent(root: string, io: PackIo): Promise<PackContent> {
  const loaded = await loadPacks(root, io.env ?? {});
  for (const issue of loaded.issues) {
    io.err(`pack warning [${issue.code}] ${issue.pack} ${issue.path}: ${issue.message}`);
  }
  return loaded.content;
}
