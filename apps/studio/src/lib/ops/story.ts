// The story: logline and synopsis (in `webtoon.json`), the production brief
// (`script/brief.json`) and the story bible (`story-bible.md`), updated in one
// change. Only the fields a patch names change.

import {
  readBrief,
  readStoryBible,
  writeBrief,
  writeStoryBible,
  writeWebtoon,
} from "@toony/project-io";
import {
  type BriefCastNote,
  IssueCollector,
  PRODUCTION_BRIEF_FORMAT_VERSION,
  type ProductionBrief,
  validateProductionBriefValue,
  type Webtoon,
} from "@toony/schema";
import type { ProjectChange } from "../agent/protocol.js";
import { OpError } from "./errors.js";
import { type OpContext, withProjectWrite } from "./write.js";

export interface StoryPatch {
  /** One sentence; empty or null removes it. */
  logline?: string | null;
  /** A short summary; empty or null removes it. */
  synopsis?: string | null;
  /** Brief: what the work is and what it is trying to do. */
  intent?: string;
  /** Brief: who the work is for. */
  audience?: string;
  /** Brief: where and when it is set. */
  world?: string;
  /** Brief: what the story is going for, most important first. */
  storyGoals?: string[];
  /** Brief: what the work must not contain; empty or null removes them. */
  contentConstraints?: string[] | null;
  /** Brief: story notes keyed to registry characters; empty or null removes them. */
  cast?: BriefCastNote[] | null;
  /** The story bible as Markdown. Empty text restores the blank template. */
  storyBible?: string;
}

const BRIEF_FIELDS = [
  "intent",
  "audience",
  "world",
  "storyGoals",
  "contentConstraints",
  "cast",
] as const;
const STORY_TEXT_MAX = 20_000;
const BIBLE_MAX = 200_000;

function text(value: string, what: string, max = STORY_TEXT_MAX): string {
  const clean = value.trim();
  if (clean.length > max) throw new OpError("invalid", `Keep the ${what} under ${max} characters.`);
  return clean;
}

function briefPatch(patch: StoryPatch, current: ProductionBrief | null): ProductionBrief {
  const next: Record<string, unknown> = current
    ? { ...current }
    : { briefFormat: PRODUCTION_BRIEF_FORMAT_VERSION };
  for (const key of ["intent", "audience", "world"] as const) {
    if (patch[key] !== undefined) next[key] = text(patch[key], key);
  }
  if (patch.storyGoals !== undefined) next.storyGoals = patch.storyGoals.map((g) => g.trim());
  for (const key of ["contentConstraints", "cast"] as const) {
    const value = patch[key];
    if (value === undefined) continue;
    if (value === null || value.length === 0) delete next[key];
    else
      next[key] = key === "contentConstraints" ? (value as string[]).map((v) => v.trim()) : value;
  }
  const c = new IssueCollector();
  validateProductionBriefValue(next, "brief", c);
  const result = c.result();
  if (!result.valid) {
    if (current === null) {
      throw new OpError(
        "invalid",
        "To start the story brief, give its intent, audience, world and at least one story goal.",
      );
    }
    const detail = result.issues
      .slice(0, 3)
      .map((issue) => issue.message)
      .join(" ");
    throw new OpError("invalid", `The story brief would not be valid: ${detail}`);
  }
  return next as unknown as ProductionBrief;
}

/** Apply a story patch as one change. Returns null when nothing differs. */
export async function updateStory(
  ctx: OpContext,
  patch: StoryPatch,
): Promise<ProjectChange | null> {
  const touchesBrief = BRIEF_FIELDS.some((key) => patch[key] !== undefined);
  const touchesWebtoon = patch.logline !== undefined || patch.synopsis !== undefined;
  if (!touchesBrief && !touchesWebtoon && patch.storyBible === undefined) {
    throw new OpError("invalid", "Say what to change in the story.");
  }
  const { change } = await withProjectWrite(
    ctx,
    {
      summary: "Updated the story",
      scopes: [{ kind: "story" }],
      files: ["webtoon.json", "script/brief.json", "story-bible.md"],
    },
    async (tx) => {
      const changed: string[] = [];
      if (touchesWebtoon) {
        const webtoon: Webtoon = { ...tx.before.project.webtoon };
        for (const key of ["logline", "synopsis"] as const) {
          const value = patch[key];
          if (value === undefined) continue;
          const clean = value === null ? "" : text(value, key);
          if (clean === "") delete webtoon[key];
          else webtoon[key] = clean;
          if ((tx.before.project.webtoon[key] ?? "") !== clean) changed.push(key);
        }
        await writeWebtoon(tx.root, webtoon);
      }
      if (touchesBrief) {
        const current = await readBrief(tx.root);
        if (!current.absent && current.brief === null) {
          throw new OpError(
            "invalid",
            "The story brief file has errors. Fix script/brief.json before updating it.",
          );
        }
        await writeBrief(tx.root, briefPatch(patch, current.brief));
        changed.push(current.absent ? "brief (new)" : "brief");
      }
      if (patch.storyBible !== undefined) {
        const bible = text(patch.storyBible, "story bible", BIBLE_MAX);
        if ((await readStoryBible(tx.root)) !== bible) changed.push("story bible");
        await writeStoryBible(tx.root, bible);
      }
      if (changed.length > 0) tx.setSummary(`Updated the story: ${changed.join(", ")}`);
    },
  );
  return change;
}
