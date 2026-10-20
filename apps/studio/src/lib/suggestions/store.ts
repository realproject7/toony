// Where dialogue suggestions live and how they are read back: one versioned
// file per episode, `.toony/agent/suggestions/<episodeId>.json`, inside the
// work so it travels with the project. Another tool may write the same file;
// it is read field by field and nothing in it is trusted as is.

import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Character, Cut } from "@toony/schema";
import { readPrivateJson, writePrivateJson } from "../agent/storage.js";
import { liveBus } from "../live/bus.js";
import { redactPaths } from "../redact.js";
import {
  type CutSuggestionsView,
  type DialogueSuggestion,
  SUGGESTION_KINDS,
  SUGGESTION_LONG,
  SUGGESTION_TEXT_MAX,
  SUGGESTIONS_MAX,
  type SuggestionFlag,
  type SuggestionKind,
} from "./types.js";

export const SUGGESTIONS_DIR = ".toony/agent/suggestions";
const FILE_VERSION = 1;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;

interface StoredCut {
  /** The cut's scene and cast when these were written (see `cutBasis`). */
  basis: string;
  createdAt: string;
  options: DialogueSuggestion[];
}

interface StoredFile {
  version: number;
  episodeId: string;
  cuts: Record<string, StoredCut>;
}

function fileOf(root: string, episodeId: string): string {
  if (!SAFE_ID.test(episodeId) || episodeId.includes("..")) throw new Error("Bad episode id.");
  return join(root, SUGGESTIONS_DIR, `${episodeId}.json`);
}

/** What the suggestions were written for: the cut's scene text and its cast. */
export function cutBasis(cut: Pick<Cut, "imagePrompt" | "characters">): string {
  return createHash("sha256")
    .update(JSON.stringify([cut.imagePrompt ?? "", [...(cut.characters ?? [])].sort()]))
    .digest("hex")
    .slice(0, 16);
}

function clean(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = redactPaths(value).trim();
  if (!text) return undefined;
  return text.length > max ? text.slice(0, max) : text;
}

function parseOption(value: unknown): DialogueSuggestion | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (!SUGGESTION_KINDS.includes(v.kind as SuggestionKind)) return null;
  const kind = v.kind as SuggestionKind;
  const id = typeof v.id === "string" && SAFE_ID.test(v.id) ? v.id : randomUUID();
  const text = clean(v.text, SUGGESTION_TEXT_MAX);
  const note = clean(v.note, 200);
  const speaker = typeof v.speaker === "string" && SAFE_ID.test(v.speaker) ? v.speaker : undefined;
  if (kind !== "silent" && !text) return null;
  return {
    id,
    kind,
    ...(speaker && (kind === "speech" || kind === "thought") ? { speaker } : {}),
    ...(kind !== "silent" && text ? { text } : {}),
    ...(note ? { note } : {}),
  };
}

function parseFile(value: unknown, episodeId: string): StoredFile {
  const empty: StoredFile = { version: FILE_VERSION, episodeId, cuts: {} };
  if (!value || typeof value !== "object" || Array.isArray(value)) return empty;
  const v = value as Record<string, unknown>;
  if (v.version !== FILE_VERSION || v.episodeId !== episodeId) return empty;
  if (!v.cuts || typeof v.cuts !== "object" || Array.isArray(v.cuts)) return empty;
  for (const [cutId, raw] of Object.entries(v.cuts as Record<string, unknown>)) {
    if (!SAFE_ID.test(cutId) || !raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const options = (Array.isArray(r.options) ? r.options : [])
      .slice(0, SUGGESTIONS_MAX)
      .map(parseOption)
      .filter((option): option is DialogueSuggestion => option !== null);
    if (options.length === 0) continue;
    empty.cuts[cutId] = {
      basis: typeof r.basis === "string" ? r.basis.slice(0, 64) : "",
      createdAt: typeof r.createdAt === "string" ? r.createdAt.slice(0, 40) : "",
      options,
    };
  }
  return empty;
}

async function readFileOf(root: string, episodeId: string): Promise<StoredFile> {
  try {
    return parseFile(await readPrivateJson(fileOf(root, episodeId)), episodeId);
  } catch {
    return { version: FILE_VERSION, episodeId, cuts: {} };
  }
}

/** Replace a cut's suggestions. Suggestions never touch the cut's lettering. */
export async function saveCutSuggestions(
  root: string,
  workId: string,
  episodeId: string,
  cut: Pick<Cut, "id" | "imagePrompt" | "characters">,
  options: ReadonlyArray<Omit<DialogueSuggestion, "id">>,
): Promise<DialogueSuggestion[]> {
  const file = await readFileOf(root, episodeId);
  const stored = options
    .map((option) => parseOption({ ...option, id: randomUUID() }))
    .filter((option): option is DialogueSuggestion => option !== null)
    .slice(0, SUGGESTIONS_MAX);
  file.cuts[cut.id] = {
    basis: cutBasis(cut),
    createdAt: new Date().toISOString(),
    options: stored,
  };
  await writePrivateJson(fileOf(root, episodeId), file);
  try {
    liveBus().publish({ type: "suggestions", workId, episodeId, cutId: cut.id });
  } catch {
    // The live feed is a convenience; the file is what counts.
  }
  return stored;
}

/** The flags a line earns against the cast and the cut. */
export function suggestionFlags(
  option: DialogueSuggestion,
  cast: readonly Pick<Character, "id">[],
  cutCharacters: readonly string[],
): SuggestionFlag[] {
  const flags: SuggestionFlag[] = [];
  if (option.speaker !== undefined) {
    if (!cast.some((character) => character.id === option.speaker)) flags.push("unknown-speaker");
    else if (!cutCharacters.includes(option.speaker)) flags.push("speaker-not-in-cut");
  }
  if ((option.text?.length ?? 0) > SUGGESTION_LONG) flags.push("long");
  return flags;
}

/** A cut's suggestions as the editor shows them, or null when there are none. */
export async function readCutSuggestions(
  root: string,
  episodeId: string,
  cut: Pick<Cut, "id" | "imagePrompt" | "characters">,
  cast: readonly Pick<Character, "id" | "name">[],
): Promise<CutSuggestionsView | null> {
  const stored = (await readFileOf(root, episodeId)).cuts[cut.id];
  if (!stored) return null;
  return {
    cutId: cut.id,
    createdAt: stored.createdAt,
    stale: stored.basis !== cutBasis(cut),
    options: stored.options.map((option) => {
      const name = cast.find((character) => character.id === option.speaker)?.name.trim();
      return {
        ...option,
        ...(name ? { speakerName: name } : {}),
        flags: suggestionFlags(option, cast, cut.characters ?? []),
      };
    }),
  };
}
