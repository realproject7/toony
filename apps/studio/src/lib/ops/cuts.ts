// Cut edits in reading order: add, update (scene, shot, characters, palette),
// remove and move, applied as one change.
//
// Sequence rules:
//   - add: the new cut goes right after the named cut (or first / last), with
//     no transition of its own;
//   - remove: the cut, its lettering, and any transition that would be left
//     without a cut on both sides (at the start, at the end, or doubled up);
//   - move: transitions stay between positions, so the reading rhythm keeps
//     its shape and no transition is lost.
// Agent and Studio edits never change a cut's review status.

import type { Cut, EpisodeBundle, SequenceItem, ShotType } from "@toony/schema";
import { SHOT_TYPES } from "@toony/schema";
import type { ProjectChange } from "../agent/protocol.js";
import { OpError } from "./errors.js";
import { cutNumber, episodeLabel, findEpisode } from "./labels.js";
import { assertSafeId, episodeFiles } from "./paths.js";
import { assertEpisodeValid, writeEpisodeRecords } from "./records.js";
import { type OpContext, withProjectWrite } from "./write.js";

export type CutOperation =
  | {
      op: "add";
      /** Place after this cut; null puts it first; absent puts it last. */
      after?: string | null;
      scene?: string;
      shotType?: ShotType;
      characters?: string[];
      palette?: string;
      /** Panel height as a multiple of its width. */
      panelAspect?: number;
    }
  | {
      op: "update";
      cutId: string;
      scene?: string;
      shotType?: ShotType | null;
      characters?: string[];
      palette?: string | null;
      /** Panel height as a multiple of its width; null returns to the default. */
      panelAspect?: number | null;
    }
  | { op: "remove"; cutId: string }
  | { op: "move"; cutId: string; after: string | null };

export interface CutEditResult {
  /** Cut ids in reading order after the edit. */
  cuts: string[];
  added: string[];
  removed: string[];
  change: ProjectChange | null;
}

const SCENE_MAX = 4000;

function cutsInOrder(sequence: readonly SequenceItem[]): string[] {
  return sequence.filter((item) => item.type === "cut").map((item) => item.id);
}

/** Gaps between consecutive cuts: the transition id after cut i, or null. */
function gapsOf(sequence: readonly SequenceItem[]): Array<string | null> {
  const gaps: Array<string | null> = [];
  let sawCut = false;
  let pending: string | null = null;
  for (const item of sequence) {
    if (item.type === "cut") {
      if (sawCut) gaps.push(pending);
      sawCut = true;
      pending = null;
    } else if (sawCut) {
      pending = item.id;
    }
  }
  return gaps;
}

function sequenceOf(cuts: readonly string[], gaps: ReadonlyArray<string | null>): SequenceItem[] {
  const sequence: SequenceItem[] = [];
  cuts.forEach((id, i) => {
    if (i > 0) {
      const gap = gaps[i - 1];
      if (gap) sequence.push({ type: "transition", id: gap });
    }
    sequence.push({ type: "cut", id });
  });
  return sequence;
}

function nextCutId(taken: ReadonlySet<string>): string {
  for (let n = 1; ; n++) {
    const id = `cut-${String(n).padStart(3, "0")}`;
    if (!taken.has(id)) return id;
  }
}

function sceneText(scene: string): string {
  const clean = scene.trim();
  if (clean.length > SCENE_MAX)
    throw new OpError("invalid", `Keep a scene under ${SCENE_MAX} characters.`);
  return clean;
}

/**
 * Apply cut operations to an episode in memory. Pure, so the sequence rules
 * are testable without a project on disk.
 */
export function applyCutOperations(
  bundle: EpisodeBundle,
  operations: readonly CutOperation[],
  knownCharacters: ReadonlySet<string>,
): { bundle: EpisodeBundle; added: string[]; removed: string[]; touched: string[] } {
  let order = cutsInOrder(bundle.episode.sequence);
  let gaps = gapsOf(bundle.episode.sequence);
  const cuts = new Map(bundle.cuts.map((cut) => [cut.id, structuredClone(cut)]));
  let lettering = [...bundle.lettering];
  const added: string[] = [];
  const removed: string[] = [];
  const touched = new Set<string>();
  const need = (cutId: string): Cut => {
    const cut = cuts.get(cutId);
    if (cut === undefined || !order.includes(cutId)) {
      throw new OpError("not-found", "One of these cuts is not in the episode.");
    }
    return cut;
  };
  const checkCharacters = (ids: readonly string[]): string[] => {
    const clean = [...new Set(ids.map((id) => id.trim()).filter((id) => id !== ""))];
    const unknown = clean.filter((id) => !knownCharacters.has(id));
    if (unknown.length > 0) {
      throw new OpError(
        "invalid",
        `Add these characters to the cast first: ${unknown.join(", ")}.`,
      );
    }
    return clean;
  };
  const position = (after: string | null | undefined): number => {
    if (after === undefined) return order.length;
    if (after === null) return 0;
    need(after);
    return order.indexOf(after) + 1;
  };

  for (const operation of operations) {
    switch (operation.op) {
      case "add": {
        const id = nextCutId(new Set(cuts.keys()));
        const cut: Cut = {
          id,
          image: null,
          imagePrompt: operation.scene === undefined ? "" : sceneText(operation.scene),
          negativePrompt: "",
        };
        if (operation.shotType !== undefined) cut.shotType = operation.shotType;
        if (operation.palette?.trim()) cut.palette = operation.palette.trim();
        if (operation.panelAspect !== undefined) cut.panelAspect = operation.panelAspect;
        const characters = checkCharacters(operation.characters ?? []);
        if (characters.length > 0) cut.characters = characters;
        const at = position(operation.after);
        // A gap that separated the cuts around the insertion point now sits
        // after the new cut; the new cut follows its predecessor directly.
        order = [...order.slice(0, at), id, ...order.slice(at)];
        gaps = at === 0 ? [null, ...gaps] : [...gaps.slice(0, at - 1), null, ...gaps.slice(at - 1)];
        cuts.set(id, cut);
        added.push(id);
        touched.add(id);
        break;
      }
      case "update": {
        const cut = need(operation.cutId);
        if (operation.scene !== undefined) cut.imagePrompt = sceneText(operation.scene);
        if (operation.shotType !== undefined) {
          if (operation.shotType === null) delete cut.shotType;
          else if (SHOT_TYPES.includes(operation.shotType)) cut.shotType = operation.shotType;
          else throw new OpError("invalid", `Use one of these shots: ${SHOT_TYPES.join(", ")}.`);
        }
        if (operation.characters !== undefined) {
          const characters = checkCharacters(operation.characters);
          if (characters.length > 0) cut.characters = characters;
          else delete cut.characters;
        }
        if (operation.palette !== undefined) {
          const palette = operation.palette?.trim() ?? "";
          if (palette === "") delete cut.palette;
          else cut.palette = palette;
        }
        if (operation.panelAspect === null) delete cut.panelAspect;
        else if (operation.panelAspect !== undefined) cut.panelAspect = operation.panelAspect;
        touched.add(cut.id);
        break;
      }
      case "remove": {
        need(operation.cutId);
        if (order.length === 1) {
          throw new OpError(
            "refused",
            "An episode keeps at least one cut. Delete the episode instead.",
          );
        }
        const index = order.indexOf(operation.cutId);
        // A transition that would be left without a cut on one side goes: the
        // one after the first cut, the one before the last cut, and, between
        // two cuts, the second of two that would now sit side by side. A
        // single transition next to a removed middle cut stays between its
        // new neighbours.
        if (index === 0) gaps = gaps.slice(1);
        else if (index === order.length - 1) gaps = gaps.slice(0, -1);
        else {
          const merged = gaps[index - 1] ?? gaps[index] ?? null;
          gaps = [...gaps.slice(0, index - 1), merged, ...gaps.slice(index + 1)];
        }
        order = order.filter((id) => id !== operation.cutId);
        cuts.delete(operation.cutId);
        lettering = lettering.filter((overlay) => overlay.cutId !== operation.cutId);
        removed.push(operation.cutId);
        touched.add(operation.cutId);
        break;
      }
      case "move": {
        need(operation.cutId);
        if (operation.after === operation.cutId) break;
        const rest = order.filter((id) => id !== operation.cutId);
        if (operation.after !== null && !rest.includes(operation.after)) need(operation.after);
        const at = operation.after === null ? 0 : rest.indexOf(operation.after) + 1;
        // Transitions stay between positions: only the cut order changes.
        order = [...rest.slice(0, at), operation.cutId, ...rest.slice(at)];
        touched.add(operation.cutId);
        break;
      }
      default:
        throw new OpError("invalid", "Use add, update, remove or move for each cut edit.");
    }
  }

  const keptTransitions = new Set(gaps.filter((gap): gap is string => gap !== null));
  const next: EpisodeBundle = {
    episode: { ...bundle.episode, sequence: sequenceOf(order, gaps) },
    cuts: order.map((id) => cuts.get(id) as Cut),
    transitions: bundle.transitions.filter((t) => keptTransitions.has(t.id)),
    lettering,
  };
  return { bundle: next, added, removed, touched: [...touched] };
}

/** Apply cut operations to one episode as one change. */
export async function editCuts(
  ctx: OpContext,
  episodeId: string,
  operations: readonly CutOperation[],
): Promise<CutEditResult> {
  assertSafeId(episodeId, "episode");
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new OpError("invalid", "Name at least one cut edit.");
  }
  const files = episodeFiles(episodeId);
  let outcome = { cuts: [] as string[], added: [] as string[], removed: [] as string[] };
  const { change } = await withProjectWrite(
    ctx,
    {
      summary: "Edited cuts",
      scopes: [{ kind: "sequence", episodeId }],
      files: [files.cuts, files.transitions, files.episode, files.lettering],
    },
    async (tx) => {
      const bundle = findEpisode(tx.before, episodeId);
      if (bundle === undefined) throw new OpError("not-found", "This episode does not exist.");
      const known = new Set((tx.before.project.webtoon.characters ?? []).map((c) => c.id));
      const edited = applyCutOperations(bundle, operations, known);
      for (const cutId of edited.touched) tx.addScope({ kind: "cut", episodeId, cutId });
      for (const cutId of edited.removed) tx.addScope({ kind: "lettering", episodeId, cutId });
      assertEpisodeValid(tx.before, edited.bundle);
      await writeEpisodeRecords(tx.root, bundle, edited.bundle);
      const label = episodeLabel(bundle, episodeId);
      const parts: string[] = [];
      if (edited.added.length > 0) {
        const numbers = edited.added.map((id) => cutNumber(edited.bundle, id));
        parts.push(
          `added ${numbers.length === 1 ? `Cut ${numbers[0]}` : `${numbers.length} cuts`}`,
        );
      }
      if (edited.removed.length > 0) {
        parts.push(
          `removed ${edited.removed.length === 1 ? "a cut" : `${edited.removed.length} cuts`}`,
        );
      }
      const updated = [
        ...new Set(operations.flatMap((o) => (o.op === "update" ? [o.cutId] : []))),
      ].map((id) => cutNumber(edited.bundle, id));
      if (updated.length > 0) {
        parts.push(
          updated.length <= 3 && updated.every((n) => n > 0)
            ? `updated Cut ${updated.join(", ")}`
            : `updated ${updated.length} cuts`,
        );
      }
      if (operations.some((o) => o.op === "move")) parts.push("reordered cuts");
      const sentence = parts.join(", ");
      tx.setSummary(`${sentence.charAt(0).toUpperCase()}${sentence.slice(1)} in ${label}`);
      outcome = {
        cuts: edited.bundle.cuts.map((cut) => cut.id),
        added: edited.added,
        removed: edited.removed,
      };
    },
  );
  return { ...outcome, change };
}
