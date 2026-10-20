// `toony generate`: the run lives in @toony/generate, shared with Studio's
// agent tools, so the CLI and the in-app agent draw a cut the same way.

export {
  DEFAULT_EDIT_STRENGTH,
  FRESH_SEED,
  type GenerateEvent,
  type GenerateIo,
  injectCharacterLockstrings,
  runGenerate,
} from "@toony/generate";
