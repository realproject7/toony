import type { Cut } from "@toony/schema";

export interface GenerationFinding {
  code: string;
  severity: "error" | "warning";
  classification: "product";
  target: string;
  message: string;
}

/** Narrow authoring checks, not a visual quality or language-understanding model. */
export function promptFindings(
  cut: Cut,
  prompt: string,
  framing: "scene" | "detail",
): GenerationFinding[] {
  const count = new Set(
    cut.artDirection?.subjects.map((s) => s.characterId) ?? cut.characters ?? [],
  ).size;
  const findings: GenerationFinding[] = [];
  const add = (code: string, message: string) =>
    findings.push({
      code,
      severity: "error",
      classification: "product",
      target: cut.id,
      message,
    });
  if (count > 0 && /\bno (?:humans?|people|persons?|characters?)\b/i.test(prompt)) {
    add(
      "empty-scene-cast",
      "The scene excludes people but names character subjects. Resolve the contradiction before generation.",
    );
  }
  if (
    framing === "scene" &&
    count > 0 &&
    /^\s*(?:extreme\s+)?close[- ]?up(?:\s+of)?[\s,:-]+(?:gloved\s+)?(?:hands?|fingers?|feet|foot|eyes?|mouth)\b/i.test(
      prompt,
    )
  ) {
    add(
      "detail-character-context",
      "A body-part close-up would receive full character descriptions. Set imageFraming: detail or pass --framing detail to keep the described detail in focus.",
    );
  }
  if (
    framing === "scene" &&
    count > 1 &&
    /(?:^|[,;])\s*(?:solo|1\s*(?:girl|boy|person|woman|man))\s*(?:[,;]|$)/i.test(prompt)
  ) {
    add(
      "subject-count-conflict",
      "The scene requests one person but names multiple characters. State the intended visible cast explicitly.",
    );
  }
  return findings;
}

/** Workflow area is an automatic-sizing baseline, not a proven quality floor. */
export function canvasFinding(
  target: string,
  size: { width?: number; height?: number },
  baseline: { width?: number; height?: number },
  explicitSize: boolean,
): GenerationFinding | undefined {
  if (!size.width || !size.height || !baseline.width || !baseline.height) return undefined;
  if (size.width * size.height >= baseline.width * baseline.height) return undefined;
  return {
    code: "reduced-generation-canvas",
    severity: explicitSize ? "warning" : "error",
    classification: "product",
    target,
    message: `Generation canvas ${size.width}x${size.height} is smaller than the workflow baseline ${baseline.width}x${baseline.height}. A display slot must not silently reduce generation detail. Choose an explicit --width or --height after inspecting the framing and cost. This check does not certify image quality.`,
  };
}
