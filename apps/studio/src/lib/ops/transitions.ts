// Transitions between cuts, set by the cut they follow: add one where there is
// none, change its type, height or text, or remove it (`type: "none"`).

import { DRAFT_DEFAULT_GUTTER_HEIGHT } from "@toony/project-io";
import {
  type EpisodeBundle,
  GUTTER_HEIGHT_MAX_PX,
  GUTTER_HEIGHT_MIN_PX,
  type SequenceItem,
  TRANSITION_TYPES,
  type Transition,
  type TransitionType,
} from "@toony/schema";
import type { ProjectChange } from "../agent/protocol.js";
import { OpError } from "./errors.js";
import { episodeLabel, findEpisode } from "./labels.js";
import { assertSafeId, episodeFiles } from "./paths.js";
import { assertEpisodeValid, writeEpisodeRecords } from "./records.js";
import { type OpContext, withProjectWrite } from "./write.js";

export interface TransitionItem {
  /** The cut the transition follows. It cannot be the last cut. */
  afterCut: string;
  /** The transition type, or "none" to remove the transition after this cut. */
  type: TransitionType | "none";
  /** Gap height in px on the project's reference column. */
  gutterHeight?: number;
  /** Text the gap carries; null or empty removes it. */
  text?: string | null;
}

/** Apply transition items to an episode in memory. Pure. */
export function applyTransitionItems(
  bundle: EpisodeBundle,
  items: readonly TransitionItem[],
): EpisodeBundle {
  const sequence: SequenceItem[] = [...bundle.episode.sequence];
  const transitions = new Map(bundle.transitions.map((t) => [t.id, { ...t }]));
  for (const item of items) {
    const index = sequence.findIndex((entry) => entry.type === "cut" && entry.id === item.afterCut);
    if (index === -1) throw new OpError("not-found", "One of these cuts is not in the episode.");
    const following = sequence.slice(index + 1);
    if (!following.some((entry) => entry.type === "cut")) {
      throw new OpError("invalid", "The last cut has no transition after it.");
    }
    const next = sequence[index + 1];
    const existing = next?.type === "transition" ? transitions.get(next.id) : undefined;
    if (item.type === "none") {
      if (next?.type === "transition") {
        sequence.splice(index + 1, 1);
        transitions.delete(next.id);
      }
      continue;
    }
    if (!TRANSITION_TYPES.includes(item.type)) {
      throw new OpError("invalid", `Use one of these transitions: ${TRANSITION_TYPES.join(", ")}.`);
    }
    if (
      item.gutterHeight !== undefined &&
      (!Number.isInteger(item.gutterHeight) ||
        item.gutterHeight < GUTTER_HEIGHT_MIN_PX ||
        item.gutterHeight > GUTTER_HEIGHT_MAX_PX)
    ) {
      throw new OpError(
        "invalid",
        `Use a gap height between ${GUTTER_HEIGHT_MIN_PX} and ${GUTTER_HEIGHT_MAX_PX} px.`,
      );
    }
    const text = item.text === undefined ? undefined : item.text?.trim() || null;
    if (existing !== undefined) {
      existing.type = item.type;
      if (item.gutterHeight !== undefined) existing.gutterHeight = item.gutterHeight;
      if (text !== undefined) existing.text = text;
      transitions.set(existing.id, existing);
      continue;
    }
    let id = `tr-${item.afterCut}`;
    for (let n = 2; transitions.has(id); n++) id = `tr-${item.afterCut}-${n}`;
    const created: Transition = {
      id,
      type: item.type,
      gutterHeight: item.gutterHeight ?? DRAFT_DEFAULT_GUTTER_HEIGHT,
      text: text ?? null,
      sfx: null,
      agentNote: null,
      humanNote: null,
      image: null,
      reviewStatus: "draft",
    };
    transitions.set(id, created);
    sequence.splice(index + 1, 0, { type: "transition", id });
  }
  const used = new Set(sequence.filter((e) => e.type === "transition").map((e) => e.id));
  return {
    ...bundle,
    episode: { ...bundle.episode, sequence },
    transitions: [...transitions.values()].filter((t) => used.has(t.id)),
  };
}

/** Set transitions in one episode as one change. */
export async function setTransitions(
  ctx: OpContext,
  episodeId: string,
  items: readonly TransitionItem[],
): Promise<ProjectChange | null> {
  assertSafeId(episodeId, "episode");
  if (!Array.isArray(items) || items.length === 0) {
    throw new OpError("invalid", "Name at least one transition to set.");
  }
  const files = episodeFiles(episodeId);
  const { change } = await withProjectWrite(
    ctx,
    {
      summary: "Updated transitions",
      scopes: [{ kind: "sequence", episodeId }],
      files: [files.transitions, files.episode],
    },
    async (tx) => {
      const bundle = findEpisode(tx.before, episodeId);
      if (bundle === undefined) throw new OpError("not-found", "This episode does not exist.");
      const next = applyTransitionItems(bundle, items);
      assertEpisodeValid(tx.before, next);
      await writeEpisodeRecords(tx.root, bundle, next);
      tx.setSummary(`Updated transitions in ${episodeLabel(bundle, episodeId)}`);
    },
  );
  return change;
}
