// Studio's single write path and the project operations built on it. Agent
// tools and the left workspace's routes call these; nothing else writes a
// project. See write.ts for the write path itself.

export {
  ARTWORK_BYTES_MAX,
  checkArtworkBytes,
  type ImportedArtwork,
  importArtwork,
} from "./artwork.js";
export {
  type CharacterInput,
  characterIdFor,
  removeCharacter,
  type SavedCharacter,
  upsertCharacters,
} from "./characters.js";
export { type ActorInfo, contextFor } from "./context.js";
export {
  applyCutOperations,
  type CutEditResult,
  type CutOperation,
  editCuts,
} from "./cuts.js";
export {
  applyDialogueReplacement,
  type DialogueLine,
  type DialogueLineView,
  type DialogueReplacement,
  normalizeLines,
  type SetDialogueResult,
  setDialogue,
} from "./dialogue.js";
export {
  BLANK_CUTS_MAX,
  type CreatedEpisode,
  createBlankEpisode,
  createEpisode,
  deleteEpisode,
  type EpisodeScriptInput,
  renameEpisode,
} from "./episodes.js";
export { OpError, type OpErrorCode, opFailure } from "./errors.js";
export { type ChangeManifest, HISTORY_KEEP, listManifests } from "./history.js";
export { type JournalEntry, readJournal } from "./journal.js";
export { type StoryPatch, updateStory } from "./story.js";
export { applyTransitionItems, setTransitions, type TransitionItem } from "./transitions.js";
export {
  type CreatedWork,
  type CreateWorkOptions,
  cleanTitle,
  createWork,
  renameWork,
  workFolderSlug,
} from "./works.js";
export {
  canonicalRoot,
  type OpContext,
  undoChange,
  type WriteContext,
  type WriteOutcome,
  type WritePlan,
  withProjectWrite,
} from "./write.js";
