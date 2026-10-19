// Public API for @toony/project-io: the single source of truth for the on-disk
// Toony project format (hybrid YAML content + JSON structural files per
// PROJECT_FORMAT.md). Consumed by the CLI (#5), the studio app and preview (#6),
// and downstream tickets (#7, #10) so the on-disk contract lives in one place.

export { type AtomicFileWrite, atomicWrite, atomicWriteAll, stagingPathFor } from "./atomic.js";
export {
  CONFIG_DIR,
  CONFIG_FILE,
  type ComfyUiConfig,
  configPath,
  defaultConfig,
  readConfig,
  type ToonyConfig,
  writeConfig,
} from "./config.js";
export {
  type ApplyRefusal,
  type ApplyResult,
  applyDraft,
  type ChangedRecord,
  type CompiledDialogue,
  type CompiledDraft,
  type CompileOptions,
  compileDialogueOverlays,
  compileEpisodeScript,
  DRAFT_DEFAULT_GUTTER_HEIGHT,
  DRAFT_FORMAT_VERSION,
  type DraftConflict,
  type DraftContinuity,
  type DraftDefault,
  type DraftDiff,
  diffDraft,
  draftCommitSteps,
  draftConflicts,
  draftPath,
  type EpisodeDraft,
  type FieldChange,
  fingerprintEpisode,
  type LoadedDraft,
  type ProjectFingerprint,
  projectWithDraft,
  readDraft,
  removeDraft,
  sameFingerprint,
  writeDraft,
} from "./draft.js";
export {
  compareEpisodeIds,
  EPISODE_ID_PREFIX,
  nextEpisodeId,
  sortEpisodeIds,
} from "./episode-order.js";
export { ProjectIoError } from "./errors.js";
export {
  decodeJson,
  decodeYaml,
  encodeJson,
  encodeYaml,
} from "./format.js";
export {
  buildGenreEpisodeBundle,
  GENRES,
  type Genre,
  type GenreScaffold,
  type GenreSeed,
  isGenre,
  listGenreIds,
  resolveGenreSeed,
} from "./genres.js";
export {
  type AssetSlot,
  type AssetTarget,
  type CutAssetTarget,
  type IngestResult,
  importedAssetPath,
  importImageBytes,
  ingestImageAsset,
  type RenderInputs,
  recordedRenderInputs,
  type TransitionAssetTarget,
} from "./ingest.js";
export {
  BRIEF_FILE,
  briefPath,
  CUTS_FILE,
  cutsFile,
  EPISODE_DIRS,
  EPISODE_FILE,
  EPISODES_DIR,
  episodeDir,
  episodeFile,
  episodeScriptFile,
  episodesDir,
  LETTERING_FILE,
  letteringFile,
  PROJECT_DIRS,
  SCRIPT_DIR,
  SCRIPT_EPISODES_DIR,
  SCRIPT_FILE_SUFFIX,
  STORY_BIBLE_FILE,
  STYLE_GUIDE_FILE,
  scriptDir,
  scriptEpisodesDir,
  TRANSITIONS_FILE,
  transitionsFile,
  WEBTOON_FILE,
  webtoonPath,
} from "./paths.js";
export {
  type EpisodeSummary,
  type LoadedProject,
  loadProject,
  summarizeEpisodes,
} from "./reader.js";
export {
  type ArtRevision,
  applyArtRevision,
  artRevisionBrief,
  artRevisionContext,
  createArtRevision,
  listArtRevisions,
  RevisionError,
  readArtRevision,
  stageArtRevision,
} from "./revisions.js";
export {
  buildInitialProject,
  buildSeededProject,
  type InitialCraftOptions,
  seedCraftOptions,
  slugify,
} from "./scaffold.js";
export {
  type LoadedBrief,
  type LoadedEpisodeScript,
  readBrief,
  readEpisodeScript,
  readEpisodeScriptFrom,
  revisionId,
  writeBrief,
  writeEpisodeScript,
} from "./script.js";
export { readStoryBible, STORY_BIBLE_TEMPLATE, writeStoryBible } from "./story-bible.js";
export { listWorkspace, type WorkspaceEntry } from "./workspace.js";
export {
  writeCuts,
  writeLettering,
  writeProject,
  writeTransitions,
  writeWebtoon,
} from "./writer.js";
