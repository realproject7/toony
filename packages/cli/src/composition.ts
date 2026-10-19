import type { ArtDirection, Character } from "@toony/schema";

/** Cast/scenery precede identity and style, so detailed identities cannot replace the shot. */
export function compositionPrompt(
  base: string,
  direction: ArtDirection,
  registry: readonly Character[],
): string {
  const detail = direction.framing === "detail";
  const lines = [
    `Original ${direction.framing} image. Camera: ${direction.camera}.`,
    `Scene: ${base}`,
    `Story purpose: ${direction.purpose}`,
    `Visible character count: ${direction.subjects.length}. ${direction.subjects.length === 0 ? "No people or incidental figures." : "No additional people or duplicated figures."}`,
    `Setting: ${direction.environment.setting}. Depth: ${direction.environment.depth}. Lighting: ${direction.environment.lighting}.`,
  ];
  for (const subject of direction.subjects) {
    const character = registry.find((c) => c.id === subject.characterId);
    const identity = character?.visualIdentity ?? character?.lockstring ?? "";
    const outfit = character?.wardrobe?.find((w) => w.id === subject.wardrobeId);
    const scoped = [`Subject ${subject.characterId} at ${subject.position}: ${subject.action}.`];
    if (!detail && identity)
      scoped.push(
        `Identity: ${identity.replace(/(?:^|,)\s*(?:1\s*(?:girl|boy|woman|man|person)|solo)\s*(?=,|$)/gi, "").replace(/^,\s*/, "")}.`,
      );
    if (subject.expression && !detail) scoped.push(`Expression: ${subject.expression}.`);
    if (outfit && !detail) scoped.push(`Outfit ${outfit.id}: ${outfit.description}.`);
    if (subject.visibleDetails?.length)
      scoped.push(`Visible details: ${subject.visibleDetails.join("; ")}.`);
    lines.push(scoped.join(" "));
  }
  if (detail)
    lines.push("Show only the named details; do not widen to a face, portrait or whole figure.");
  lines.push(`Visual focus: ${direction.focalPoints.join("; ")}.`);
  if (direction.continuity) {
    lines.push(
      `Continue from ${direction.continuity.fromCutId}. Preserve: ${direction.continuity.preserve.join("; ")}.`,
    );
    if (direction.continuity.changes?.length)
      lines.push(`Intentional changes only: ${direction.continuity.changes.join("; ")}.`);
  }
  const region = (r: {
    x: number;
    y: number;
    width: number;
    height: number;
    description: string;
  }) => `${r.description} at x=${r.x}, y=${r.y}, width=${r.width}, height=${r.height}`;
  if (direction.protectedRegions?.length)
    lines.push(
      `Keep visible and unobstructed: ${direction.protectedRegions.map(region).join("; ")}.`,
    );
  lines.push(
    direction.lettering.mode === "none"
      ? "Silent artwork: use the entire composition intentionally; no forced blank lettering band."
      : `Low-detail space for later human lettering: ${(direction.lettering.regions ?? []).map(region).join("; ")}.`,
  );
  lines.push(
    "Artwork only. Do not draw dialogue, captions, speech balloons, letters or watermarks.",
  );
  const s = direction.style;
  lines.push(
    `Style: linework ${s.linework}; color ${s.color}; shading ${s.shading}${s.texture ? `; texture ${s.texture}` : ""}.`,
  );
  return lines.join("\n");
}

/** Honest adapter disclosure: prose is a request, not spatial conditioning. */
export function compositionCapabilities(direction: ArtDirection | undefined, reference: boolean) {
  return {
    structuredIntent: direction !== undefined,
    camera: "prompt-only",
    subjectPositions: "prompt-only",
    wardrobe: "prompt-only",
    protectedRegions: "prompt-only",
    letteringSpace: "prompt-only",
    identityReference: reference ? "one-image" : "unsupported",
    multiCharacterReferences: "unsupported",
    sourceImageEditing: "unsupported",
    automaticVisualAcceptance: "unsupported",
  };
}
