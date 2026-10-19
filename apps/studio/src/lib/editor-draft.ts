import type { LetteringOverlay } from "@toony/schema";
import { letteringClipboard, parseLetteringClipboard } from "./lettering-clipboard.js";

export function encodeEditorDraft(revision: string, bubbles: LetteringOverlay[]): string {
  return JSON.stringify({ revision, clipboard: letteringClipboard(bubbles) });
}
export function decodeEditorDraft(
  raw: string,
  cutId: string,
): { revision: string; bubbles: LetteringOverlay[] } | null {
  try {
    if (raw.length > 2_100_000) return null;
    const value = JSON.parse(raw);
    if (
      typeof value.revision !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.revision) ||
      typeof value.clipboard !== "string"
    )
      return null;
    const empty = JSON.parse(value.clipboard);
    const bubbles =
      empty.format === "toony-lettering-clipboard-v1" &&
      Array.isArray(empty.overlays) &&
      empty.overlays.length === 0
        ? []
        : parseLetteringClipboard(value.clipboard);
    if (bubbles.some((b) => b.cutId !== cutId)) return null;
    return { revision: value.revision, bubbles };
  } catch {
    return null;
  }
}
