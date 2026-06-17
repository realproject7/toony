// Referential lint for project character refs (#92).
//
// A cut may list `characters: string[]` — ids into the project character
// registry whose lockstrings `toony generate` injects. The schema validates only
// the field SHAPE (an array of id strings); this lint is the referential check:
// it warns when a cut references an id that no registry character defines, so a
// typo'd/undefined character is caught before it silently fails to inject.

import type { Character, EpisodeBundle } from "@toony/schema";
import { type Finding, finding } from "./findings.js";

/**
 * Warn for every cut character ref that does not resolve to a registry
 * character. Deterministic; deduplicated per cut so a ref listed twice warns
 * once. An empty registry simply means every ref is unknown.
 */
export function lintCharacterRefs(
  bundle: EpisodeBundle,
  characters: readonly Character[],
): Finding[] {
  const known = new Set(characters.map((character) => character.id));
  const findings: Finding[] = [];
  for (const cut of bundle.cuts) {
    const seen = new Set<string>();
    for (const id of cut.characters ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (!known.has(id)) {
        findings.push(
          finding(
            "warning",
            "character/unknown-ref",
            cut.id,
            `cut "${cut.id}" references unknown character "${id}"; add it to the project character registry or remove the reference.`,
          ),
        );
      }
    }
  }
  return findings;
}
