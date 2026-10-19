// One character at a time, for the Characters page:
//   { action: "save", workId, character: { id?, name?, lockstring?, visualIdentity?,
//     development?, wardrobe? } }   adds a character (no id) or merges into one
//   { action: "remove", workId, characterId }
// Both run the merge-based cast operations, so a page holding an older copy of
// the cast never overwrites another character. Answers `{ ok, characters?,
// change, changeId }` so the page can offer Undo.

import { handleWrite, json, stringField, workOf } from "@/lib/api-route";
import { type CharacterInput, contextFor, removeCharacter, upsertCharacters } from "@/lib/ops";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function textOrNull(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function characterInput(value: unknown): CharacterInput | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const input: CharacterInput = {};
  if (typeof v.id === "string") input.id = v.id;
  if (typeof v.name === "string") input.name = v.name;
  if (typeof v.lockstring === "string") input.lockstring = v.lockstring;
  const visual = textOrNull(v.visualIdentity);
  if (visual !== undefined) input.visualIdentity = visual;
  if (v.development === null) input.development = null;
  else if (typeof v.development === "object") {
    const d = v.development as Record<string, unknown>;
    const development: Record<string, string> = {};
    for (const key of ["role", "desire", "flaw", "voice", "arc"]) {
      if (typeof d[key] === "string") development[key] = d[key] as string;
    }
    input.development = development;
  }
  if (v.wardrobe === null) input.wardrobe = null;
  else if (Array.isArray(v.wardrobe)) {
    input.wardrobe = v.wardrobe
      .filter(
        (o): o is { id: string; description: string } =>
          typeof o === "object" &&
          o !== null &&
          typeof (o as Record<string, unknown>).id === "string" &&
          typeof (o as Record<string, unknown>).description === "string",
      )
      .map((o) => ({ id: o.id, description: o.description }));
  }
  return input;
}

export async function POST(request: Request): Promise<Response> {
  return handleWrite(request, async ({ body, info }) => {
    const resolved = await workOf(body);
    if ("response" in resolved) return resolved.response;
    const ctx = contextFor(resolved.work.root, { ...info, workId: resolved.work.id });
    if (body.action === "save") {
      const input = characterInput(body.character);
      if (input === null) return json({ ok: false, error: "Send the character to save." }, 400);
      const saved = await upsertCharacters(ctx, [input]);
      return json({
        ok: true,
        characters: saved.characters,
        change: saved.change,
        changeId: saved.change?.changeId ?? null,
      });
    }
    if (body.action === "remove") {
      const characterId = stringField(body, "characterId");
      if (characterId === undefined) {
        return json({ ok: false, error: "Name the character to remove." }, 400);
      }
      const change = await removeCharacter(ctx, characterId);
      return json({ ok: true, change, changeId: change?.changeId ?? null });
    }
    return json({ ok: false, error: "Use save or remove." }, 400);
  });
}
