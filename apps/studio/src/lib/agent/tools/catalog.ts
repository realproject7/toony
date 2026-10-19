// The Toony tools the agent sees over MCP (server `toony`): names, what each
// does, its argument schema and the step label the panel shows while it runs.
// Arguments are checked again by hand in `args.ts`; the schema guides the model.

import { BUBBLE_KINDS, EXPORT_OPTION_KEYS, SHOT_TYPES, TRANSITION_TYPES } from "@toony/schema";
import type { McpToolDefinition } from "../bridge.js";

export const EXPORT_OUTPUTS = [
  "strip",
  "cuts",
  "instagram",
  "instagram-square",
  "x",
  "webtoon",
] as const;

export type ToolKind = "read" | "write" | "collab";

export interface ToolSpec extends McpToolDefinition {
  kind: ToolKind;
  /** What the panel shows while the tool runs. */
  step: string;
}

type Schema = Record<string, unknown>;

const str = (description: string, extra: Schema = {}): Schema => ({
  type: "string",
  description,
  ...extra,
});
const obj = (properties: Record<string, Schema>, required: string[] = []): Schema => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});
const arr = (items: Schema, description: string, extra: Schema = {}): Schema => ({
  type: "array",
  items,
  description,
  ...extra,
});

const episodeId = str("Episode id, for example ep-001 (from get_status or read_episode).");
const cutId = str("Cut id, for example cut-003 (from read_episode).");

const dialogueLine = obj(
  {
    speaker: {
      type: ["string", "null"],
      description: "Character id (or name) who says it; null for narration.",
    },
    text: str("What is said, in the work's dialogue language."),
    kind: str("Bubble kind. Default speech, or narration when there is no speaker.", {
      enum: [...BUBBLE_KINDS],
    }),
  },
  ["speaker", "text"],
);

const scriptCut = obj(
  {
    intent: str("What this cut does for the story, in one sentence."),
    scene: str(
      "What the cut shows: place, action, framing. Shown in place of art until art exists.",
    ),
    characters: arr(str("Character id"), "Ids of characters in the cut."),
    dialogue: arr(dialogueLine, "Lines in reading order. Two or three short lines at most."),
    letteringIntent: str("Optional note on how the lettering should feel."),
    shotType: str("Optional shot.", { enum: [...SHOT_TYPES] }),
    palette: str("Optional color mood."),
    transitionAfter: obj(
      {
        type: str("Transition after this cut.", { enum: [...TRANSITION_TYPES] }),
        gutterHeight: { type: "integer", description: "Optional gap height in px." },
        text: str("Optional text the transition carries (cards, time skips)."),
      },
      ["type"],
    ),
  },
  ["intent", "scene"],
);

const characterInput = obj({
  id: str("Id of an existing character to update. Leave out to add a new character."),
  name: str("Name. Required for a new character."),
  lockstring: str("Short, fixed visual description that keeps the character on model."),
  visualIdentity: str("Longer look description."),
  development: obj(
    {
      role: str("Role in the story."),
      desire: str("What they want."),
      flaw: str("What holds them back."),
      voice: str("How they talk."),
      arc: str("How they change."),
    },
    [],
  ),
  wardrobe: arr(
    obj({ id: str("Outfit id"), description: str("Outfit") }, ["id", "description"]),
    "Outfits.",
  ),
});

const cutOperation = {
  type: "object",
  description:
    'One edit. op "add" (after: cut id, null for first, absent for last; scene, shotType, characters, palette), "update" (cutId; scene, shotType, characters, palette), "remove" (cutId) or "move" (cutId, after).',
  properties: {
    op: str("add, update, remove or move.", { enum: ["add", "update", "remove", "move"] }),
    cutId: str("The cut to update, remove or move."),
    after: { type: ["string", "null"], description: "Place after this cut id; null for first." },
    scene: str("What the cut shows."),
    shotType: { type: ["string", "null"], enum: [...SHOT_TYPES, null] },
    characters: arr(str("Character id"), "Character ids in the cut."),
    palette: { type: ["string", "null"], description: "Color mood; null removes it." },
  },
  required: ["op"],
  additionalProperties: false,
};

const transitionItem = obj(
  {
    afterCut: str("The cut the transition follows (not the last cut)."),
    type: str('Transition type, or "none" to remove the one after this cut.', {
      enum: [...TRANSITION_TYPES, "none"],
    }),
    gutterHeight: { type: "integer", description: "Gap height in px." },
    text: {
      type: ["string", "null"],
      description: "Text the transition carries; null removes it.",
    },
  },
  ["afterCut", "type"],
);

export const TOOL_CATALOG: readonly ToolSpec[] = [
  {
    name: "get_status",
    kind: "read",
    step: "Checking the project",
    description:
      "Status of this work: story, cast, episodes with progress, your task list, the open question, remembered notes and what changed since your last turn. Call it first in a new session.",
    inputSchema: obj({}),
  },
  {
    name: "list_works",
    kind: "read",
    step: "Looking at the library",
    description: "The webtoons in this workspace (title, id, episode count).",
    inputSchema: obj({}),
  },
  {
    name: "read_story",
    kind: "read",
    step: "Reading the story",
    description: "The story: title, logline, synopsis, the production brief and the story bible.",
    inputSchema: obj({}),
  },
  {
    name: "read_characters",
    kind: "read",
    step: "Reading the cast",
    description: "Every character with id, name, look, profile and outfits.",
    inputSchema: obj({}),
  },
  {
    name: "read_episode",
    kind: "read",
    step: "Reading the episode",
    description:
      "One episode in reading order: each cut with number, id, scene, shot, characters, dialogue (bubble ids, speaker, text, kind) and whether it has artwork, plus the transitions between cuts.",
    inputSchema: obj({ episodeId }, ["episodeId"]),
  },
  {
    name: "view_cut",
    kind: "read",
    step: "Looking at a cut",
    description:
      "See one cut as an image with its lettering (at most 768 px). Use it to judge art and bubble placement. Cuts without art show a plain panel.",
    inputSchema: obj({ episodeId, cutId }, ["episodeId", "cutId"]),
  },
  {
    name: "check_episode",
    kind: "read",
    step: "Checking the episode",
    description: "Validation and craft checks for one episode, as plain sentences.",
    inputSchema: obj({ episodeId }, ["episodeId"]),
  },
  {
    name: "create_work",
    kind: "write",
    step: "Creating the webtoon",
    description:
      "Create a new webtoon (no episodes yet). Only from a library chat; the chat then belongs to the new work and the person's view moves to it.",
    inputSchema: obj(
      {
        title: str("The title, exactly as it should read."),
        logline: str("One-sentence pitch."),
        language: str(
          "Dialogue language code, for example en, ko or ja. Pass the language the dialogue will be written in.",
        ),
      },
      ["title", "language"],
    ),
  },
  {
    name: "update_story",
    kind: "write",
    step: "Updating the story",
    description:
      "Change the title, logline, synopsis, production brief or story bible. Only the fields you give change. Starting a brief needs intent, audience, world and storyGoals together.",
    inputSchema: obj({
      title: str("New title of the work."),
      logline: { type: ["string", "null"], description: "One sentence; null removes it." },
      synopsis: { type: ["string", "null"], description: "Short summary; null removes it." },
      intent: str("Brief: what the work is and is trying to do."),
      audience: str("Brief: who it is for."),
      world: str("Brief: where and when it is set."),
      storyGoals: arr(str("Goal"), "Brief: story goals, most important first."),
      contentConstraints: {
        type: ["array", "null"],
        items: { type: "string" },
        description: "Brief: what the work must not contain; null removes them.",
      },
      storyBible: str("The whole story bible as Markdown (replaces it)."),
    }),
  },
  {
    name: "save_characters",
    kind: "write",
    step: "Updating the cast",
    description:
      "Add characters or update existing ones by id. Only the fields you give change. A profile (development) needs all five fields the first time.",
    inputSchema: obj(
      {
        characters: arr(characterInput, "Characters to add or update.", {
          minItems: 1,
          maxItems: 30,
        }),
      },
      ["characters"],
    ),
  },
  {
    name: "remove_character",
    kind: "write",
    step: "Updating the cast",
    description: "Remove a character from the cast and from every cut that lists them.",
    inputSchema: obj({ characterId: str("The character id.") }, ["characterId"]),
  },
  {
    name: "create_episode",
    kind: "write",
    step: "Writing an episode",
    description:
      "Create the next episode from a script: beats, each with a purpose and its cuts (intent, scene, characters, dialogue, optional shot and transitionAfter). Dialogue becomes lettered bubbles. Returns the new episode id and cut ids.",
    inputSchema: obj(
      {
        title: str("Episode title."),
        script: obj(
          {
            continuity: obj(
              {
                previousEpisodeId: str("The episode this one follows."),
                startsFrom: str("Where the previous episode left the story."),
              },
              ["previousEpisodeId", "startsFrom"],
            ),
            beats: arr(
              obj(
                {
                  purpose: str("What this beat does."),
                  cuts: arr(scriptCut, "Cuts of the beat in reading order.", { minItems: 1 }),
                },
                ["purpose", "cuts"],
              ),
              "Beats in order.",
              { minItems: 1 },
            ),
          },
          ["beats"],
        ),
      },
      ["title", "script"],
    ),
  },
  {
    name: "rename_episode",
    kind: "write",
    step: "Renaming an episode",
    description: "Rename an episode.",
    inputSchema: obj({ episodeId, title: str("New title.") }, ["episodeId", "title"]),
  },
  {
    name: "delete_episode",
    kind: "write",
    step: "Deleting an episode",
    description: "Delete an episode with its cuts, lettering and artwork. The person can undo it.",
    inputSchema: obj({ episodeId }, ["episodeId"]),
  },
  {
    name: "edit_cuts",
    kind: "write",
    step: "Editing cuts",
    description:
      "Add, update, remove or move cuts of an episode in one change. Removing a cut removes its lettering and any transition left dangling. Never changes review status.",
    inputSchema: obj(
      {
        episodeId,
        operations: arr(cutOperation, "Edits, applied in order.", { minItems: 1, maxItems: 100 }),
      },
      ["episodeId", "operations"],
    ),
  },
  {
    name: "set_dialogue",
    kind: "write",
    step: "Lettering a cut",
    description:
      "Set a cut's dialogue. A cut without bubbles gets new, auto-placed bubbles. A cut that already has lettering becomes a proposal the person approves.",
    inputSchema: obj(
      {
        episodeId,
        cutId,
        lines: arr(dialogueLine, "Lines in reading order.", { minItems: 1, maxItems: 24 }),
      },
      ["episodeId", "cutId", "lines"],
    ),
  },
  {
    name: "set_transitions",
    kind: "write",
    step: "Setting transitions",
    description: "Add, change or remove the transitions between cuts, each by the cut it follows.",
    inputSchema: obj(
      {
        episodeId,
        items: arr(transitionItem, "Transitions to set.", { minItems: 1, maxItems: 200 }),
      },
      ["episodeId", "items"],
    ),
  },
  {
    name: "import_artwork",
    kind: "write",
    step: "Adding artwork",
    description:
      "Use an image file on this computer (PNG, JPEG, WebP or GIF, up to 30 MB) as a cut's artwork. Only for a file the person pointed you to.",
    inputSchema: obj(
      { episodeId, cutId, path: str("Absolute path of the image file, or one starting with ~/.") },
      ["episodeId", "cutId", "path"],
    ),
  },
  {
    name: "export_episode",
    kind: "write",
    step: "Exporting",
    description:
      "Export an episode as files (nothing is posted): strip (one tall image), cuts (one image per cut), instagram (4:5 carousel), instagram-square, x (16:9, up to 4 images per post) or webtoon (800 px wide JPEG slices). Waits for the files and returns them.",
    inputSchema: obj(
      {
        episodeId,
        output: str("The output.", { enum: [...EXPORT_OUTPUTS] }),
        options: {
          type: "object",
          description: `Optional: ${EXPORT_OPTION_KEYS.join(", ")}.`,
        },
      },
      ["episodeId", "output"],
    ),
  },
  {
    name: "undo_change",
    kind: "write",
    step: "Undoing a change",
    description: "Undo one earlier change by its change id (only when the person asks).",
    inputSchema: obj({ changeId: str("The change id from a tool result or get_status.") }, [
      "changeId",
    ]),
  },
  {
    name: "update_tasks",
    kind: "collab",
    step: "Updating the plan",
    description:
      "Replace your task list (pinned in the person's panel). Call it before multi-step work and keep the statuses current.",
    inputSchema: obj(
      {
        tasks: arr(
          obj(
            {
              title: str("A short step."),
              status: str("Status.", { enum: ["pending", "in_progress", "done"] }),
            },
            ["title", "status"],
          ),
          "The whole list, in order.",
          { maxItems: 30 },
        ),
      },
      ["tasks"],
    ),
  },
  {
    name: "ask_user",
    kind: "collab",
    step: "Asking you",
    description:
      "Ask the person a question with 2 to 6 options, shown as a card. After calling it, end your turn; the answer arrives as the next message.",
    inputSchema: obj(
      {
        question: str("The question."),
        header: str("Optional short label (a few words)."),
        options: arr(
          obj({ label: str("Option"), description: str("Optional one-line explanation.") }, [
            "label",
          ]),
          "2 to 6 concrete options.",
          { minItems: 2, maxItems: 6 },
        ),
        multiSelect: { type: "boolean", description: "Allow choosing several options." },
        allowOther: { type: "boolean", description: "Offer a free-text answer too. Default true." },
      },
      ["question", "options"],
    ),
  },
  {
    name: "remember",
    kind: "collab",
    step: "Remembering",
    description:
      "Remember a durable decision, preference or note about this work for later sessions.",
    inputSchema: obj(
      {
        text: str("What to remember, in one or two sentences."),
        kind: str("Kind.", { enum: ["decision", "preference", "note"] }),
      },
      ["text"],
    ),
  },
  {
    name: "forget",
    kind: "collab",
    step: "Forgetting a note",
    description: "Forget a remembered note by its id (from get_status).",
    inputSchema: obj({ noteId: str("The note id.") }, ["noteId"]),
  },
];

const BY_NAME = new Map(TOOL_CATALOG.map((tool) => [tool.name, tool]));

export function toolSpec(name: string): ToolSpec | undefined {
  return BY_NAME.get(name);
}

/** The definitions the bridge lists over MCP. */
export function mcpTools(): McpToolDefinition[] {
  return TOOL_CATALOG.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  }));
}

/** The panel's step label for a native tool call, with a title when the arguments name one. */
export function stepLabel(name: string, input?: unknown): string {
  const spec = toolSpec(name);
  if (spec === undefined) return "Working";
  const args = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  if (name === "create_episode" && typeof args.title === "string" && args.title.trim()) {
    return `Writing "${args.title.trim().slice(0, 60)}"`;
  }
  if (name === "create_work" && typeof args.title === "string" && args.title.trim()) {
    return `Creating "${args.title.trim().slice(0, 60)}"`;
  }
  if (name === "export_episode" && typeof args.output === "string") {
    return `Exporting (${args.output.slice(0, 20)})`;
  }
  return spec.step;
}
