// Public API for @toony/project-io: the single source of truth for the on-disk
// Toony project format (hybrid YAML content + JSON structural files per
// PROJECT_FORMAT.md). Consumed by the CLI (#5), the studio app and preview (#6),
// and downstream tickets (#7, #10) so the on-disk contract lives in one place.

export { ProjectIoError } from "./errors.js";
export {
  decodeJson,
  decodeYaml,
  encodeJson,
  encodeYaml,
} from "./format.js";
export {
  type AssetSlot,
  type AssetTarget,
  type CutAssetTarget,
  type IngestResult,
  ingestImageAsset,
  type TransitionAssetTarget,
} from "./ingest.js";
export {
  CUTS_FILE,
  cutsFile,
  EPISODE_DIRS,
  EPISODE_FILE,
  EPISODES_DIR,
  episodeDir,
  episodeFile,
  episodesDir,
  LETTERING_FILE,
  letteringFile,
  PROJECT_DIRS,
  STORY_BIBLE_FILE,
  STYLE_GUIDE_FILE,
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
export { buildInitialProject, slugify } from "./scaffold.js";
export { writeLettering, writeProject, writeTransitions } from "./writer.js";
