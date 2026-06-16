// Agent-readable exit codes, documented in `toony --help`.

/** Command succeeded; for `validate`, the project is valid. */
export const EXIT_OK = 0;
/** Validation found schema errors (used by `validate`). */
export const EXIT_VALIDATION = 1;
/** Usage error or IO failure (bad args, missing/unreadable files). */
export const EXIT_USAGE = 2;
