// Public API for @toony/authoring: the compile orchestration the CLI and
// Studio share, so an episode script becomes the same draft either way.

export {
  type CompileDraftFailure,
  type CompileDraftRequest,
  type CompileDraftResult,
  type CompileDraftSuccess,
  compileEpisodeDraft,
  DRAFT_LINTS_NOT_RUN,
  type LetteringThemeEntry,
} from "./compile.js";
