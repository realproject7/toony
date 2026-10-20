// Dialogue for one cut, as lines of text. A cut with no bubbles gets new
// bubbles, placed and styled exactly as a compiled draft places a first set
// (stacked boxes, the project's lettering theme). A cut that already has
// bubbles is never rewritten here: `setDialogue` returns a replacement
// descriptor `{ before, after }`, which the agent panel shows as a proposal,
// and only `applyDialogueReplacement` (after a person's click) writes it.

import { compileDialogueOverlays, writeLettering } from "@toony/project-io";
import {
  BUBBLE_KINDS,
  type BubbleKind,
  type LetteringOverlay,
  reconcileLetteringText,
} from "@toony/schema";
import type { ProjectChange } from "../agent/protocol.js";
import { cutLetteringRevision } from "../lettering-save.js";
import { discoverStudioPacks } from "../packs.js";
import { OpError } from "./errors.js";
import { cutLabel, findEpisode } from "./labels.js";
import { assertSafeId, episodeFiles } from "./paths.js";
import { type OpContext, withProjectWrite } from "./write.js";

export interface DialogueLine {
  /** A character id or name; null or empty for narration. */
  speaker: string | null;
  text: string;
  kind?: BubbleKind;
}

export interface DialogueLineView {
  speaker: string;
  text: string;
  kind: BubbleKind;
}

/** What replacing a cut's lettering would do. Writing it needs a person's approval. */
export interface DialogueReplacement {
  workId: string;
  episodeId: string;
  cutId: string;
  /** The cut's lettering revision the proposal was made against. */
  baseRevision: string;
  before: Array<DialogueLineView & { id: string }>;
  after: DialogueLineView[];
  /** The lines to apply, with speakers resolved to character ids where known. */
  lines: DialogueLine[];
}

export type SetDialogueResult =
  | { mode: "created"; overlayIds: string[]; change: ProjectChange | null }
  | { mode: "replacement"; replacement: DialogueReplacement };

const LINES_MAX = 24;
const TEXT_MAX = 2000;

interface Cast {
  names: Map<string, string>;
  byName: Map<string, string>;
}

function castOf(characters: ReadonlyArray<{ id: string; name: string }>): Cast {
  return {
    names: new Map(characters.map((c) => [c.id, c.name])),
    byName: new Map(characters.map((c) => [c.name.trim().toLowerCase(), c.id])),
  };
}

/** Check lines and resolve each speaker to a character id when the cast knows it. */
export function normalizeLines(lines: readonly DialogueLine[], cast: Cast): DialogueLine[] {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new OpError("invalid", "Give at least one line of dialogue.");
  }
  if (lines.length > LINES_MAX)
    throw new OpError("invalid", `Keep a cut to ${LINES_MAX} lines or fewer.`);
  return lines.map((line) => {
    const text = typeof line?.text === "string" ? line.text.trim() : "";
    if (text === "") throw new OpError("invalid", "Every line needs text.");
    if (text.length > TEXT_MAX)
      throw new OpError("invalid", `Keep each line under ${TEXT_MAX} characters.`);
    if (line.kind !== undefined && !BUBBLE_KINDS.includes(line.kind)) {
      throw new OpError("invalid", `Use one of these bubble kinds: ${BUBBLE_KINDS.join(", ")}.`);
    }
    const raw = typeof line.speaker === "string" ? line.speaker.trim() : "";
    const speaker =
      raw === "" ? null : cast.names.has(raw) ? raw : (cast.byName.get(raw.toLowerCase()) ?? raw);
    return { speaker, text, ...(line.kind === undefined ? {} : { kind: line.kind }) };
  });
}

function view(line: DialogueLine, cast: Cast): DialogueLineView {
  return {
    speaker: line.speaker === null ? "" : (cast.names.get(line.speaker) ?? line.speaker),
    text: line.text,
    kind: line.kind ?? (line.speaker === null ? "narration" : "speech"),
  };
}

async function projectTheme(root: string, themeId: string | undefined) {
  if (themeId === undefined) return undefined;
  const packs = await discoverStudioPacks(root);
  return packs.letteringTheme(themeId) ?? undefined;
}

/**
 * Set a cut's dialogue. Creates bubbles on a cut that has none; otherwise
 * returns the replacement for a person to approve and writes nothing.
 */
export async function setDialogue(
  ctx: OpContext,
  episodeId: string,
  cutId: string,
  lines: readonly DialogueLine[],
): Promise<SetDialogueResult> {
  assertSafeId(episodeId, "episode");
  let replacement: DialogueReplacement | null = null;
  let overlayIds: string[] = [];
  const { change } = await withProjectWrite(
    ctx,
    {
      summary: "Added dialogue",
      scopes: [{ kind: "lettering", episodeId, cutId }],
      files: [episodeFiles(episodeId).lettering],
    },
    async (tx) => {
      const bundle = findEpisode(tx.before, episodeId);
      if (bundle === undefined) throw new OpError("not-found", "This episode does not exist.");
      if (!bundle.cuts.some((cut) => cut.id === cutId)) {
        throw new OpError("not-found", "This cut is not in the episode.");
      }
      const cast = castOf(tx.before.project.webtoon.characters ?? []);
      const normalized = normalizeLines(lines, cast);
      const current = bundle.lettering.filter((overlay) => overlay.cutId === cutId);
      if (current.length > 0) {
        replacement = {
          workId: ctx.workId,
          episodeId,
          cutId,
          baseRevision: cutLetteringRevision(current),
          before: current.map((overlay) => ({
            id: overlay.id,
            speaker: overlay.speaker,
            text: overlay.text,
            kind: overlay.kind,
          })),
          after: normalized.map((line) => view(line, cast)),
          lines: normalized,
        };
        return;
      }
      const theme = await projectTheme(tx.root, tx.before.project.webtoon.letteringTheme);
      const { overlays } = compileDialogueOverlays(cutId, normalized, cast.names, {
        ...(theme === undefined ? {} : { theme }),
        takenIds: new Set(bundle.lettering.map((overlay) => overlay.id)),
      });
      await writeLettering(tx.root, episodeId, [...bundle.lettering, ...overlays]);
      overlayIds = overlays.map((overlay) => overlay.id);
      tx.setSummary(`Added dialogue to ${cutLabel(tx.before, episodeId, cutId)}`);
    },
  );
  if (replacement !== null) return { mode: "replacement", replacement };
  return { mode: "created", overlayIds, change };
}

/**
 * Apply an approved replacement. Existing bubbles keep their place and style
 * and take the new speaker and text in order (styled ranges are carried over
 * where the text allows); a line whose kind changes gets a fresh bubble in the
 * same box; extra lines get new bubbles; bubbles beyond the new lines go.
 * Refused when the cut's lettering changed after the proposal was made.
 */
export async function applyDialogueReplacement(
  ctx: OpContext,
  replacement: DialogueReplacement,
): Promise<{ overlayIds: string[]; change: ProjectChange | null }> {
  const { episodeId, cutId } = replacement;
  assertSafeId(episodeId, "episode");
  let overlayIds: string[] = [];
  const { change } = await withProjectWrite(
    ctx,
    {
      summary: "Replaced dialogue",
      scopes: [{ kind: "lettering", episodeId, cutId }],
      files: [episodeFiles(episodeId).lettering],
    },
    async (tx) => {
      const bundle = findEpisode(tx.before, episodeId);
      if (bundle === undefined || !bundle.cuts.some((cut) => cut.id === cutId)) {
        throw new OpError("not-found", "This cut is no longer in the episode.");
      }
      const current = bundle.lettering.filter((overlay) => overlay.cutId === cutId);
      if (cutLetteringRevision(current) !== replacement.baseRevision) {
        throw new OpError(
          "stale",
          "This cut's lettering changed after the proposal was made. Ask for it again.",
        );
      }
      const cast = castOf(tx.before.project.webtoon.characters ?? []);
      const lines = normalizeLines(replacement.lines, cast);
      const theme = await projectTheme(tx.root, tx.before.project.webtoon.letteringTheme);
      const taken = new Set(
        bundle.lettering.filter((o) => o.cutId !== cutId).map((overlay) => overlay.id),
      );
      const fresh = compileDialogueOverlays(cutId, lines, cast.names, {
        ...(theme === undefined ? {} : { theme }),
        takenIds: new Set([...taken, ...current.map((o) => o.id)]),
      }).overlays;
      const next: LetteringOverlay[] = lines.map((line, i) => {
        const existing = current[i];
        const created = fresh[i] as LetteringOverlay;
        const wanted = view(line, cast);
        if (existing === undefined) return created;
        if (existing.kind !== wanted.kind) {
          return { ...created, id: existing.id, geometry: existing.geometry };
        }
        const text = reconcileLetteringText(
          {
            text: existing.text,
            ...(existing.textRanges ? { textRanges: existing.textRanges } : {}),
          },
          wanted.text,
        );
        const updated: LetteringOverlay = { ...existing, speaker: wanted.speaker, text: text.text };
        if (text.textRanges && text.textRanges.length > 0) updated.textRanges = text.textRanges;
        else delete updated.textRanges;
        return updated;
      });
      const others = bundle.lettering.filter((overlay) => overlay.cutId !== cutId);
      await writeLettering(tx.root, episodeId, [...others, ...next]);
      overlayIds = next.map((overlay) => overlay.id);
      tx.setSummary(`Replaced dialogue on ${cutLabel(tx.before, episodeId, cutId)}`);
    },
  );
  return { overlayIds, change };
}
