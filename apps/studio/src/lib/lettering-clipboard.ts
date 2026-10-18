import {
  IssueCollector,
  type LetteringOverlay,
  validateLetteringOverlayValue,
} from "@toony/schema";

const FORMAT = "toony-lettering-clipboard-v1";
export function letteringClipboard(overlays: readonly LetteringOverlay[]): string {
  return JSON.stringify({ format: FORMAT, overlays });
}
/** Accept only an explicit lettering envelope and validated shapes, never HTML. */
export function parseLetteringClipboard(text: string): LetteringOverlay[] {
  if (text.length > 2_000_000) throw new Error("The lettering clipboard is too large.");
  const value: unknown = JSON.parse(text);
  if (
    !value ||
    typeof value !== "object" ||
    !("format" in value) ||
    value.format !== FORMAT ||
    !("overlays" in value) ||
    !Array.isArray(value.overlays) ||
    !value.overlays.length ||
    value.overlays.length > 200
  )
    throw new Error("Copy bubbles in Toony before pasting.");
  const c = new IssueCollector();
  for (const overlay of value.overlays) {
    // An unassigned draft is allowed in the editor but still needs attribution
    // before the normal project save validates. Do not invent a saved speaker.
    validateLetteringOverlayValue(
      overlay && typeof overlay === "object" && overlay.speaker === ""
        ? { ...overlay, speaker: "Unassigned" }
        : overlay,
      "clipboard",
      c,
    );
  }
  if (!c.result().valid) throw new Error("The clipboard contains invalid lettering.");
  return value.overlays as LetteringOverlay[];
}
