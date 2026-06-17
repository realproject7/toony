// Path-free client error mapping for the studio API routes.
//
// The studio is local-first, but its product rule is a path-free / project-
// relative error contract: an API response must NEVER leak an absolute on-disk
// path. `@toony/project-io` builds IO error messages like `could not read
// ${file}` where `file` is an absolute work path, and a raw Node `ENOENT` cause
// also carries an absolute path. Routes therefore must not return those messages
// verbatim. This module is the single place that maps any caught error to a
// generic, path-free message the UI can show, mirroring the `toony export` CLI's
// path-free posture.
//
// `ExportError` is handled separately by the export route: it is an actionable,
// path-free engine error (e.g. PlotLink markdown too short) whose message is
// safe to surface as-is.

import { ProjectIoError } from "@toony/project-io";

/**
 * A generic, path-free message for an IO/unknown failure caught while serving a
 * route. `ProjectIoError` (and raw Node errors) embed absolute on-disk paths, so
 * their messages are deliberately discarded here; the route logs nothing private
 * and the client sees a stable, path-free reason. `fallback` lets a route phrase
 * the action that failed (e.g. "could not save the cut").
 */
export function safeErrorMessage(_cause: unknown, fallback = "could not load the project"): string {
  // The cause is intentionally not interpolated into the message: both
  // `ProjectIoError.message` and raw Node IO errors carry absolute paths.
  return fallback;
}

/**
 * Whether a caught error is an IO-layer failure from `@toony/project-io`. Kept so
 * a route can choose a 422 vs 500 status while still returning a path-free body.
 */
export function isProjectIoError(cause: unknown): cause is ProjectIoError {
  return cause instanceof ProjectIoError;
}
