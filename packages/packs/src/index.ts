// Public API for @toony/packs: the pack format, its validators, and local
// discovery of the content packs contribute.
//
// A pack is a directory of DATA — a `toony-pack.json` manifest plus the JSON
// files it names — that adds named ComfyUI workflows, genre scaffolds, export
// presets, and craft bands without editing core source. See docs/PACK_FORMAT.md.
//
// This package depends only on `@toony/schema`, and nothing in the core depends
// on it: the CLI discovers packs once and passes the resolved content down to
// the registries in `@toony/project-io`, `@toony/export`, and `@toony/providers`.
// That keeps the seam a one-way edge, so the core never needs a pack to work.

export {
  EMPTY_PACK_CONTENT,
  type LoadedPacks,
  loadPacks,
  type PackContent,
  type PackContributions,
  type PackGenre,
  type PackIssue,
  type PackSummary,
  packRoots,
  readPackManifest,
} from "./discover.js";
export {
  PACK_FORMAT_VERSION,
  PACK_MANIFEST_FILE,
  PACK_PRESET_FORMATS,
  PACKS_ENV_VAR,
  type PackCraftBandRef,
  type PackExportOptions,
  type PackExportPreset,
  type PackGenreRef,
  type PackManifest,
  type PackPresetFormat,
  type PackWorkflowRef,
  PROJECT_PACKS_DIR,
} from "./manifest.js";
export { asPackManifest, validateGenreScaffold, validatePackManifest } from "./validate.js";
