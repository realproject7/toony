// Public API for @toony/generate: the image generation run shared by the
// `toony generate` command and Toony Studio's agent tools, plus the helpers it
// is built from (prompt composition, preflight findings, the validation gate,
// pack discovery and the exit codes the CLI reports).

export { compositionCapabilities, compositionPrompt } from "./composition.js";
export { EXIT_OK, EXIT_USAGE, EXIT_VALIDATION } from "./exit.js";
export {
  DEFAULT_EDIT_STRENGTH,
  FRESH_SEED,
  type GenerateEvent,
  type GenerateIo,
  injectCharacterLockstrings,
  runGenerate,
} from "./generate.js";
export {
  authoredValueLines,
  type LocatedIssue,
  locateIssue,
  partitionIssues,
  passesAuthoringGate,
  renderAuthoredValue,
  WIRING_CODES,
} from "./generate-gate.js";
export { canvasFinding, type GenerationFinding, promptFindings } from "./generation-preflight.js";
export { discoverPackContent, type PackIo } from "./packs.js";
export { appendPaletteClause, describePalette } from "./palette.js";
export { LATENT_BLOCK_PX, latentHeightFor } from "./panel-shape.js";
export { jsonReport, textReport, type ValidateJsonReport } from "./report.js";
export { shellQuote } from "./shell.js";
