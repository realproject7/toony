// Hand-written argument checks for every Toony tool. A failed check becomes a
// tool error the model can read and fix ("episodeId must be ..."), so messages
// name the field and say what is expected. Semantic checks (does the episode
// exist, is the script valid) stay in lib/ops.

import {
  BUBBLE_KINDS,
  type BubbleKind,
  SHOT_TYPES,
  type ShotType,
  TRANSITION_TYPES,
  type TransitionType,
} from "@toony/schema";
import type {
  CharacterInput,
  CutOperation,
  DialogueLine,
  EpisodeScriptInput,
  StoryPatch,
  TransitionItem,
} from "../../ops/index.js";
import {
  SUGGESTION_KINDS,
  SUGGESTION_TEXT_MAX,
  SUGGESTIONS_MAX,
  type SuggestionKind,
} from "../../suggestions/types.js";
import type { MemoryNote, QuestionOption, TaskItem } from "../protocol.js";
import { EXPORT_OUTPUTS } from "./catalog.js";

export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

type Args = Record<string, unknown>;

function fail(message: string): never {
  throw new ToolInputError(message);
}

export function argsObject(value: unknown): Args {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) fail("Arguments must be an object.");
  return value as Args;
}

function noExtra(args: Args, allowed: readonly string[], where = "arguments"): void {
  const extra = Object.keys(args).filter((key) => !allowed.includes(key));
  if (extra.length > 0) {
    fail(`Unknown ${where}: ${extra.join(", ")}. Allowed: ${allowed.join(", ") || "none"}.`);
  }
}

function text(args: Args, key: string, max: number, where = key): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim() === "") fail(`${where} must be non-empty text.`);
  if (value.length > max) fail(`${where} must be at most ${max} characters.`);
  return value;
}

function optionalText(args: Args, key: string, max: number, where = key): string | undefined {
  if (args[key] === undefined) return undefined;
  return text(args, key, max, where);
}

function nullableText(args: Args, key: string, max: number): string | null | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") fail(`${key} must be text or null.`);
  if (value.length > max) fail(`${key} must be at most ${max} characters.`);
  return value;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;

function id(args: Args, key: string, what: string): string {
  const value = args[key];
  if (typeof value !== "string" || !ID.test(value) || value.includes("..")) {
    fail(
      `${key} must be ${what} id such as ${what === "an episode" ? "ep-001" : what === "a cut" ? "cut-003" : "the one shown by the read tools"}.`,
    );
  }
  return value;
}

function bool(args: Args, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") fail(`${key} must be true or false.`);
  return value;
}

function list(value: unknown, where: string, min: number, max: number): unknown[] {
  if (!Array.isArray(value)) fail(`${where} must be a list.`);
  if (value.length < min)
    fail(`${where} needs at least ${min} ${min === 1 ? "entry" : "entries"}.`);
  if (value.length > max) fail(`${where} can have at most ${max} entries.`);
  return value;
}

function stringList(value: unknown, where: string, max: number, itemMax = 500): string[] {
  return list(value, where, 0, max).map((item, i) => {
    if (typeof item !== "string" || item.trim() === "")
      fail(`${where}[${i}] must be non-empty text.`);
    if (item.length > itemMax) fail(`${where}[${i}] must be at most ${itemMax} characters.`);
    return item;
  });
}

// ---------------------------------------------------------------------------

export function noArgs(raw: unknown): Record<string, never> {
  noExtra(argsObject(raw), []);
  return {};
}

export function episodeArgs(raw: unknown): { episodeId: string } {
  const args = argsObject(raw);
  noExtra(args, ["episodeId"]);
  return { episodeId: id(args, "episodeId", "an episode") };
}

export function cutArgs(raw: unknown): { episodeId: string; cutId: string } {
  const args = argsObject(raw);
  noExtra(args, ["episodeId", "cutId"]);
  return { episodeId: id(args, "episodeId", "an episode"), cutId: id(args, "cutId", "a cut") };
}

const LANGUAGE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

export function createWorkArgs(raw: unknown): {
  title: string;
  logline?: string;
  language?: string;
} {
  const args = argsObject(raw);
  noExtra(args, ["title", "logline", "language"]);
  const title = text(args, "title", 200);
  const logline = optionalText(args, "logline", 1000);
  const language = optionalText(args, "language", 20);
  if (language !== undefined && !LANGUAGE.test(language)) {
    fail("language must be a language code such as en, ko or ja.");
  }
  return { title, ...(logline ? { logline } : {}), ...(language ? { language } : {}) };
}

export function updateStoryArgs(raw: unknown): { title?: string; patch: StoryPatch } {
  const args = argsObject(raw);
  const keys = [
    "title",
    "logline",
    "synopsis",
    "intent",
    "audience",
    "world",
    "storyGoals",
    "contentConstraints",
    "storyBible",
  ];
  noExtra(args, keys);
  if (Object.keys(args).length === 0) fail(`Give at least one of: ${keys.join(", ")}.`);
  const patch: StoryPatch = {};
  const title = optionalText(args, "title", 200);
  const logline = nullableText(args, "logline", 1000);
  if (logline !== undefined) patch.logline = logline;
  const synopsis = nullableText(args, "synopsis", 20_000);
  if (synopsis !== undefined) patch.synopsis = synopsis;
  for (const key of ["intent", "audience", "world"] as const) {
    const value = optionalText(args, key, 20_000);
    if (value !== undefined) patch[key] = value;
  }
  if (args.storyGoals !== undefined) {
    patch.storyGoals = stringList(args.storyGoals, "storyGoals", 30, 1000);
    if (patch.storyGoals.length === 0) fail("storyGoals needs at least one goal.");
  }
  if (args.contentConstraints !== undefined) {
    patch.contentConstraints =
      args.contentConstraints === null
        ? null
        : stringList(args.contentConstraints, "contentConstraints", 30, 1000);
  }
  if (args.storyBible !== undefined) {
    if (typeof args.storyBible !== "string") fail("storyBible must be Markdown text.");
    if (args.storyBible.length > 200_000) fail("storyBible must be at most 200000 characters.");
    patch.storyBible = args.storyBible;
  }
  return { ...(title ? { title } : {}), patch };
}

const DEVELOPMENT_KEYS = ["role", "desire", "flaw", "voice", "arc"] as const;

export function saveCharactersArgs(raw: unknown): { characters: CharacterInput[] } {
  const args = argsObject(raw);
  noExtra(args, ["characters"]);
  const characters = list(args.characters, "characters", 1, 30).map((item, i) => {
    const where = `characters[${i}]`;
    const c = argsObject(item);
    noExtra(
      c,
      ["id", "name", "lockstring", "visualIdentity", "development", "wardrobe"],
      `fields in ${where}`,
    );
    const input: CharacterInput = {};
    if (c.id !== undefined) input.id = id(c, "id", "a character");
    if (c.name !== undefined) input.name = text(c, "name", 100, `${where}.name`);
    if (input.id === undefined && input.name === undefined)
      fail(`${where} needs a name (or the id of an existing character).`);
    if (c.lockstring !== undefined)
      input.lockstring = text(c, "lockstring", 1000, `${where}.lockstring`);
    if (c.visualIdentity !== undefined) {
      input.visualIdentity = nullableText(c, "visualIdentity", 4000) ?? null;
    }
    if (c.development !== undefined) {
      if (c.development === null) input.development = null;
      else {
        const d = argsObject(c.development);
        noExtra(d, [...DEVELOPMENT_KEYS], `fields in ${where}.development`);
        const development: Record<string, string> = {};
        for (const key of DEVELOPMENT_KEYS) {
          const value = optionalText(d, key, 4000, `${where}.development.${key}`);
          if (value !== undefined) development[key] = value;
        }
        input.development = development;
      }
    }
    if (c.wardrobe !== undefined) {
      input.wardrobe =
        c.wardrobe === null
          ? null
          : list(c.wardrobe, `${where}.wardrobe`, 0, 32).map((outfit, j) => {
              const o = argsObject(outfit);
              noExtra(o, ["id", "description"], `fields in ${where}.wardrobe[${j}]`);
              return {
                id: text(o, "id", 100, `${where}.wardrobe[${j}].id`),
                description: text(o, "description", 4000, `${where}.wardrobe[${j}].description`),
              };
            });
    }
    return input;
  });
  return { characters };
}

export function removeCharacterArgs(raw: unknown): { characterId: string } {
  const args = argsObject(raw);
  noExtra(args, ["characterId"]);
  return { characterId: id(args, "characterId", "a character") };
}

function dialogueLines(value: unknown, where: string, max: number): DialogueLine[] {
  return list(value, where, 1, max).map((item, i) => {
    const line = argsObject(item);
    noExtra(line, ["speaker", "text", "kind"], `fields in ${where}[${i}]`);
    const speaker = line.speaker;
    if (
      speaker !== null &&
      speaker !== undefined &&
      (typeof speaker !== "string" || speaker.length > 100)
    ) {
      fail(`${where}[${i}].speaker must be a character id or name, or null for narration.`);
    }
    const kind = line.kind;
    if (kind !== undefined && !BUBBLE_KINDS.includes(kind as BubbleKind)) {
      fail(`${where}[${i}].kind must be one of: ${BUBBLE_KINDS.join(", ")}.`);
    }
    return {
      speaker: typeof speaker === "string" && speaker.trim() ? speaker : null,
      text: text(line, "text", 2000, `${where}[${i}].text`),
      ...(kind === undefined ? {} : { kind: kind as BubbleKind }),
    };
  });
}

function shotType(value: unknown, where: string): ShotType {
  if (!SHOT_TYPES.includes(value as ShotType))
    fail(`${where} must be one of: ${SHOT_TYPES.join(", ")}.`);
  return value as ShotType;
}

function transitionType(value: unknown, where: string): TransitionType {
  if (!TRANSITION_TYPES.includes(value as TransitionType)) {
    fail(`${where} must be one of: ${TRANSITION_TYPES.join(", ")}.`);
  }
  return value as TransitionType;
}

function gutterHeight(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 4000) {
    fail(`${where} must be a whole number of pixels.`);
  }
  return value;
}

export function createEpisodeArgs(raw: unknown): { title: string; script: EpisodeScriptInput } {
  const args = argsObject(raw);
  noExtra(args, ["title", "script"]);
  const title = text(args, "title", 200);
  const script = argsObject(args.script);
  if (args.script === undefined) fail("script is required: { beats: [{ purpose, cuts: [...] }] }.");
  noExtra(script, ["title", "continuity", "beats"], "fields in script");
  let cutCount = 0;
  const beats = list(script.beats, "script.beats", 1, 60).map((rawBeat, b) => {
    const where = `script.beats[${b}]`;
    const beat = argsObject(rawBeat);
    noExtra(beat, ["id", "purpose", "goals", "cuts"], `fields in ${where}`);
    const cuts = list(beat.cuts, `${where}.cuts`, 1, 60).map((rawCut, c) => {
      cutCount += 1;
      const at = `${where}.cuts[${c}]`;
      const cut = argsObject(rawCut);
      noExtra(
        cut,
        [
          "id",
          "intent",
          "scene",
          "characters",
          "dialogue",
          "letteringIntent",
          "shotType",
          "palette",
          "transitionAfter",
          "artDirection",
        ],
        `fields in ${at}`,
      );
      const out: EpisodeScriptInput["beats"][number]["cuts"][number] = {
        intent: text(cut, "intent", 2000, `${at}.intent`),
        scene: text(cut, "scene", 4000, `${at}.scene`),
      };
      if (cut.id !== undefined) out.id = id(cut, "id", "a cut");
      if (cut.characters !== undefined)
        out.characters = stringList(cut.characters, `${at}.characters`, 12, 100);
      if (cut.dialogue !== undefined) {
        out.dialogue = dialogueLines(cut.dialogue, `${at}.dialogue`, 12).map((line) => ({
          speaker: line.speaker,
          text: line.text,
          ...(line.kind ? { kind: line.kind } : {}),
        }));
      }
      const lettering = optionalText(cut, "letteringIntent", 2000, `${at}.letteringIntent`);
      if (lettering) out.letteringIntent = lettering;
      if (cut.shotType !== undefined) out.shotType = shotType(cut.shotType, `${at}.shotType`);
      const palette = optionalText(cut, "palette", 200, `${at}.palette`);
      if (palette) out.palette = palette;
      if (cut.transitionAfter !== undefined) {
        const t = argsObject(cut.transitionAfter);
        noExtra(t, ["type", "gutterHeight", "text"], `fields in ${at}.transitionAfter`);
        out.transitionAfter = {
          type: transitionType(t.type, `${at}.transitionAfter.type`),
          ...(t.gutterHeight === undefined
            ? {}
            : { gutterHeight: gutterHeight(t.gutterHeight, `${at}.transitionAfter.gutterHeight`) }),
          ...(typeof t.text === "string" && t.text.trim() ? { text: t.text.slice(0, 500) } : {}),
        };
      }
      if (cut.artDirection !== undefined) {
        (out as Record<string, unknown>).artDirection = cut.artDirection;
      }
      return out;
    });
    return {
      ...(beat.id === undefined ? {} : { id: id(beat, "id", "a beat") }),
      purpose: text(beat, "purpose", 2000, `${where}.purpose`),
      ...(beat.goals === undefined
        ? {}
        : { goals: list(beat.goals, `${where}.goals`, 0, 20) as never }),
      cuts,
    };
  });
  if (cutCount > 200) fail("An episode can have at most 200 cuts.");
  const result: EpisodeScriptInput = { beats };
  if (script.continuity !== undefined) {
    const c = argsObject(script.continuity);
    noExtra(c, ["previousEpisodeId", "startsFrom"], "fields in script.continuity");
    result.continuity = {
      previousEpisodeId: id(c, "previousEpisodeId", "an episode"),
      startsFrom: text(c, "startsFrom", 2000, "script.continuity.startsFrom"),
    };
  }
  return { title, script: result };
}

export function renameEpisodeArgs(raw: unknown): { episodeId: string; title: string } {
  const args = argsObject(raw);
  noExtra(args, ["episodeId", "title"]);
  return { episodeId: id(args, "episodeId", "an episode"), title: text(args, "title", 200) };
}

export function editCutsArgs(raw: unknown): { episodeId: string; operations: CutOperation[] } {
  const args = argsObject(raw);
  noExtra(args, ["episodeId", "operations"]);
  const episodeId = id(args, "episodeId", "an episode");
  const operations = list(args.operations, "operations", 1, 100).map((item, i): CutOperation => {
    const where = `operations[${i}]`;
    const op = argsObject(item);
    const after = (): string | null | undefined => {
      if (op.after === undefined) return undefined;
      if (op.after === null) return null;
      return id(op, "after", "a cut");
    };
    const fields = (): { scene?: string; characters?: string[] } => ({
      ...(op.scene === undefined
        ? {}
        : {
            scene:
              typeof op.scene === "string"
                ? op.scene.slice(0, 4000)
                : fail(`${where}.scene must be text.`),
          }),
      ...(op.characters === undefined
        ? {}
        : { characters: stringList(op.characters, `${where}.characters`, 12, 100) }),
    });
    switch (op.op) {
      case "add": {
        noExtra(
          op,
          ["op", "after", "scene", "shotType", "characters", "palette"],
          `fields in ${where}`,
        );
        const placed = after();
        return {
          op: "add",
          ...(placed === undefined ? {} : { after: placed }),
          ...fields(),
          ...(op.shotType === undefined || op.shotType === null
            ? {}
            : { shotType: shotType(op.shotType, `${where}.shotType`) }),
          ...(typeof op.palette === "string" && op.palette.trim()
            ? { palette: op.palette.slice(0, 200) }
            : {}),
        };
      }
      case "update": {
        noExtra(
          op,
          ["op", "cutId", "scene", "shotType", "characters", "palette"],
          `fields in ${where}`,
        );
        return {
          op: "update",
          cutId: id(op, "cutId", "a cut"),
          ...fields(),
          ...(op.shotType === undefined
            ? {}
            : {
                shotType: op.shotType === null ? null : shotType(op.shotType, `${where}.shotType`),
              }),
          ...(op.palette === undefined
            ? {}
            : { palette: op.palette === null ? null : String(op.palette).slice(0, 200) }),
        };
      }
      case "remove":
        noExtra(op, ["op", "cutId"], `fields in ${where}`);
        return { op: "remove", cutId: id(op, "cutId", "a cut") };
      case "move": {
        noExtra(op, ["op", "cutId", "after"], `fields in ${where}`);
        const placed = after();
        if (placed === undefined) fail(`${where}.after is required: a cut id, or null for first.`);
        return { op: "move", cutId: id(op, "cutId", "a cut"), after: placed };
      }
      default:
        return fail(`${where}.op must be add, update, remove or move.`);
    }
  });
  return { episodeId, operations };
}

export function setDialogueArgs(raw: unknown): {
  episodeId: string;
  cutId: string;
  lines: DialogueLine[];
} {
  const args = argsObject(raw);
  noExtra(args, ["episodeId", "cutId", "lines"]);
  return {
    episodeId: id(args, "episodeId", "an episode"),
    cutId: id(args, "cutId", "a cut"),
    lines: dialogueLines(args.lines, "lines", 24),
  };
}

export function setTransitionsArgs(raw: unknown): { episodeId: string; items: TransitionItem[] } {
  const args = argsObject(raw);
  noExtra(args, ["episodeId", "items"]);
  const items = list(args.items, "items", 1, 200).map((item, i): TransitionItem => {
    const where = `items[${i}]`;
    const t = argsObject(item);
    noExtra(t, ["afterCut", "type", "gutterHeight", "text"], `fields in ${where}`);
    const type = t.type === "none" ? "none" : transitionType(t.type, `${where}.type`);
    return {
      afterCut: id(t, "afterCut", "a cut"),
      type,
      ...(t.gutterHeight === undefined
        ? {}
        : { gutterHeight: gutterHeight(t.gutterHeight, `${where}.gutterHeight`) }),
      ...(t.text === undefined ? {} : { text: nullableText(t, "text", 500) ?? null }),
    };
  });
  return { episodeId: id(args, "episodeId", "an episode"), items };
}

export function importArtworkArgs(raw: unknown): {
  episodeId: string;
  cutId: string;
  path: string;
} {
  const args = argsObject(raw);
  noExtra(args, ["episodeId", "cutId", "path"]);
  const path = text(args, "path", 4096);
  if (!path.startsWith("/") && !path.startsWith("~/")) {
    fail("path must be an absolute path to the image file (or start with ~/).");
  }
  if (path.includes("\0")) fail("path is not a valid file path.");
  return {
    episodeId: id(args, "episodeId", "an episode"),
    cutId: id(args, "cutId", "a cut"),
    path,
  };
}

/** One cut to draw, with the image prompt the engine receives. */
export interface DrawCutInput {
  cutId: string;
  prompt: string;
  negative?: string;
}

const PROMPT_MAX = 2000;
export const DRAW_CUTS_MAX = 24;
/** How much of the current image an edit may change, when the agent names no strength. */
export const EDIT_STRENGTH_DEFAULT = 0.5;
export const EDIT_STRENGTH_MIN = 0.1;
export const EDIT_STRENGTH_MAX = 0.9;
/** The longest an art status call waits for progress, in seconds. */
export const ART_STATUS_WAIT_MAX = 240;

export function drawCutsArgs(raw: unknown): {
  episodeId: string;
  cuts: DrawCutInput[];
  newTake: boolean;
} {
  const args = argsObject(raw);
  noExtra(args, ["episodeId", "cuts", "newTake"]);
  const episodeId = id(args, "episodeId", "an episode");
  const seen = new Set<string>();
  const cuts = list(args.cuts, "cuts", 1, DRAW_CUTS_MAX).map((value, index) => {
    const where = `cuts[${index}]`;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      fail(`${where} must be an object with cutId and prompt.`);
    }
    const item = value as Args;
    noExtra(item, ["cutId", "prompt", "negative"], where);
    const cutId = id(item, "cutId", "a cut");
    if (seen.has(cutId)) fail(`${where}: ${cutId} is listed twice.`);
    seen.add(cutId);
    const negative = optionalText(item, "negative", PROMPT_MAX, `${where}.negative`);
    return {
      cutId,
      prompt: text(item, "prompt", PROMPT_MAX, `${where}.prompt`),
      ...(negative === undefined ? {} : { negative }),
    };
  });
  return { episodeId, cuts, newTake: bool(args, "newTake") ?? false };
}

export function editCutArtArgs(raw: unknown): {
  episodeId: string;
  cutId: string;
  prompt: string;
  negative?: string;
  strength: number;
} {
  const args = argsObject(raw);
  noExtra(args, ["episodeId", "cutId", "prompt", "negative", "strength"]);
  const strength = args.strength ?? EDIT_STRENGTH_DEFAULT;
  if (
    typeof strength !== "number" ||
    !Number.isFinite(strength) ||
    strength < EDIT_STRENGTH_MIN ||
    strength > EDIT_STRENGTH_MAX
  ) {
    fail(`strength must be a number from ${EDIT_STRENGTH_MIN} to ${EDIT_STRENGTH_MAX}.`);
  }
  const negative = optionalText(args, "negative", PROMPT_MAX);
  return {
    episodeId: id(args, "episodeId", "an episode"),
    cutId: id(args, "cutId", "a cut"),
    prompt: text(args, "prompt", PROMPT_MAX),
    ...(negative === undefined ? {} : { negative }),
    strength,
  };
}

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function optionalJobId(args: Args): string | undefined {
  const value = args.jobId;
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !JOB_ID.test(value)) {
    fail("jobId must be a drawing job id from draw_cuts, edit_cut_art or art_status.");
  }
  return value;
}

export function artStatusArgs(raw: unknown): { jobId?: string; wait: number } {
  const args = argsObject(raw);
  noExtra(args, ["jobId", "wait"]);
  const wait = args.wait ?? 0;
  if (
    typeof wait !== "number" ||
    !Number.isInteger(wait) ||
    wait < 0 ||
    wait > ART_STATUS_WAIT_MAX
  ) {
    fail(`wait must be a whole number of seconds from 0 to ${ART_STATUS_WAIT_MAX}.`);
  }
  const jobId = optionalJobId(args);
  return { ...(jobId === undefined ? {} : { jobId }), wait };
}

export function stopDrawingArgs(raw: unknown): { jobId?: string } {
  const args = argsObject(raw);
  noExtra(args, ["jobId"]);
  const jobId = optionalJobId(args);
  return jobId === undefined ? {} : { jobId };
}

export function exportArgs(raw: unknown): { episodeId: string; output: string; options: unknown } {
  const args = argsObject(raw);
  noExtra(args, ["episodeId", "output", "options"]);
  const output = args.output;
  if (typeof output !== "string" || !(EXPORT_OUTPUTS as readonly string[]).includes(output)) {
    fail(`output must be one of: ${EXPORT_OUTPUTS.join(", ")}.`);
  }
  return { episodeId: id(args, "episodeId", "an episode"), output, options: args.options };
}

export function undoArgs(raw: unknown): { changeId: string } {
  const args = argsObject(raw);
  noExtra(args, ["changeId"]);
  const changeId = args.changeId;
  if (typeof changeId !== "string" || !/^c[a-z0-9]{6,20}-[a-f0-9]{6}$/.test(changeId)) {
    fail(
      "changeId must be a change id from a tool result or get_status, such as c1abc2de3-0a1b2c.",
    );
  }
  return { changeId };
}

const TASK_STATES: readonly TaskItem["status"][] = ["pending", "in_progress", "done"];

export function tasksArgs(raw: unknown): {
  tasks: Array<{ title: string; status: TaskItem["status"] }>;
} {
  const args = argsObject(raw);
  noExtra(args, ["tasks"]);
  return {
    tasks: list(args.tasks, "tasks", 0, 30).map((item, i) => {
      const t = argsObject(item);
      noExtra(t, ["title", "status"], `fields in tasks[${i}]`);
      const status = t.status as TaskItem["status"];
      if (!TASK_STATES.includes(status))
        fail(`tasks[${i}].status must be pending, in_progress or done.`);
      return { title: text(t, "title", 200, `tasks[${i}].title`), status };
    }),
  };
}

export interface AskArgs {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect: boolean;
  allowOther: boolean;
}

export function askArgs(raw: unknown): AskArgs {
  const args = argsObject(raw);
  noExtra(args, ["question", "header", "options", "multiSelect", "allowOther"]);
  const options = list(args.options, "options", 2, 6).map((item, i) => {
    const o = argsObject(item);
    noExtra(o, ["label", "description"], `fields in options[${i}]`);
    const label = text(o, "label", 120, `options[${i}].label`).trim();
    const description = optionalText(o, "description", 300, `options[${i}].description`);
    return { label, ...(description ? { description: description.trim() } : {}) };
  });
  const labels = new Set(options.map((o) => o.label.toLowerCase()));
  if (labels.size !== options.length) fail("Option labels must be different from each other.");
  const header = optionalText(args, "header", 40);
  return {
    question: text(args, "question", 500).trim(),
    ...(header ? { header: header.trim() } : {}),
    options,
    multiSelect: bool(args, "multiSelect") ?? false,
    allowOther: bool(args, "allowOther") ?? true,
  };
}

export function suggestDialogueArgs(raw: unknown): {
  episodeId: string;
  cutId: string;
  options: Array<{ kind: SuggestionKind; speaker?: string; text?: string; note?: string }>;
} {
  const args = argsObject(raw);
  noExtra(args, ["episodeId", "cutId", "options"]);
  const episodeId = id(args, "episodeId", "an episode");
  const cutId = id(args, "cutId", "a cut");
  const options = list(args.options, "options", 1, SUGGESTIONS_MAX).map((value, index) => {
    const where = `options[${index}]`;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      fail(`${where} must be an object with kind and text.`);
    }
    const item = value as Args;
    noExtra(item, ["kind", "speaker", "text", "note"], where);
    const kind = item.kind as SuggestionKind;
    if (!SUGGESTION_KINDS.includes(kind)) {
      fail(`${where}.kind must be one of ${SUGGESTION_KINDS.join(", ")}.`);
    }
    const note = optionalText(item, "note", 200, `${where}.note`)?.trim();
    if (kind === "silent") {
      if (item.text !== undefined || item.speaker !== undefined) {
        fail(`${where}: a silent option has no text and no speaker.`);
      }
      return { kind, ...(note ? { note } : {}) };
    }
    const line = text(item, "text", SUGGESTION_TEXT_MAX, `${where}.text`).trim();
    if (kind === "narration") {
      if (item.speaker !== undefined) fail(`${where}: narration has no speaker.`);
      return { kind, text: line, ...(note ? { note } : {}) };
    }
    const speaker = id(item, "speaker", "a character");
    return { kind, speaker, text: line, ...(note ? { note } : {}) };
  });
  return { episodeId, cutId, options };
}

export function rememberArgs(raw: unknown): { text: string; kind: MemoryNote["kind"] } {
  const args = argsObject(raw);
  noExtra(args, ["text", "kind"]);
  const kind = (args.kind ?? "note") as MemoryNote["kind"];
  if (!["decision", "preference", "note"].includes(kind))
    fail("kind must be decision, preference or note.");
  return { text: text(args, "text", 500).trim(), kind };
}

export function forgetArgs(raw: unknown): { noteId: string } {
  const args = argsObject(raw);
  noExtra(args, ["noteId"]);
  const noteId = args.noteId;
  if (typeof noteId !== "string" || !/^[A-Za-z0-9-]{1,40}$/.test(noteId))
    fail("noteId must be a note id from get_status.");
  return { noteId };
}
