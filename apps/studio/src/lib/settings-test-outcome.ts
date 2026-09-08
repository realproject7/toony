// What pressing "Test connection" reports (#223).
//
// The outcome lives here rather than inside the component for the reason
// `editor-save.ts` does (#150): it is the part with branches worth pinning, and
// the component around it is wiring.
//
// The rule this module exists to enforce is that EVERY press produces a
// sentence. A probe normally resolves to the state already on the badge, so a
// handler that only updates the badge leaves the screen identical before and
// after, and the button reads as broken. That was the defect.

/** Connection-badge state, mirrored from the `/api/config` probe result. */
export type ConnectionState = "reachable" | "unreachable" | "unconfigured" | "unknown";

/** The ComfyUI half of the workspace config, as the form edits it. */
export interface ComfyConfigValues {
  endpoint: string | null;
  checkpoint: string | null;
  workflow: string | null;
}

/** Empty-string for a null field, so the inputs are always controlled. */
export function asValue(value: string | null): string {
  return value ?? "";
}

/**
 * Whether the form still matches what is on disk.
 *
 * `test` probes the FILE, because the file is what the CLI and agents resolve.
 * Probing the typed value instead would let the badge report "Reachable" for a
 * configuration that does not exist on disk, which is a worse failure than
 * asking the user to save first.
 */
export function isDirty(form: ComfyConfigValues, saved: ComfyConfigValues): boolean {
  return (
    asValue(form.endpoint).trim() !== asValue(saved.endpoint).trim() ||
    asValue(form.checkpoint).trim() !== asValue(saved.checkpoint).trim() ||
    asValue(form.workflow).trim() !== asValue(saved.workflow).trim()
  );
}

/**
 * The sentence shown after a test. Never empty: an outcome with nothing to say
 * is the defect this module exists to prevent, so every branch names the next
 * step the user can take.
 */
export function describeTestOutcome(state: ConnectionState | undefined, detail?: string): string {
  switch (state) {
    case "reachable":
      return "Reachable. The saved endpoint answered.";
    case "unreachable":
      return detail
        ? `Not reachable: ${detail}`
        : "Not reachable. Check that ComfyUI is running at the saved endpoint.";
    default:
      // `unconfigured`, `unknown`, and a response with no connection at all
      // share one next step, and it is the one a first-time user needs.
      return "No endpoint is saved yet. Enter one above and press Save settings.";
  }
}

/** The sentence shown when the form has edits that were never written. */
export const UNSAVED_EDITS_MESSAGE =
  "These edits are not saved yet. Save settings first, then test.";
