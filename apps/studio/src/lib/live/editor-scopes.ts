// The browser's registry of open editors with unsaved edits. An editor
// registers the scope it edits and a function that says whether it is dirty;
// `useProjectSync` asks before refreshing the page for a live change, so a
// change never replaces unsaved work silently. Keys use `scopeKey` format.

import type { ChangeScope } from "../agent/protocol.js";
import { parseScopeKey, scopesOverlap } from "./scope.js";

interface Registration {
  key: string;
  scope: ChangeScope;
  isDirty: () => boolean;
}

const registrations = new Set<Registration>();

/**
 * Register an editor for `key` (for example `lettering:ep-001/cut-003`).
 * Returns the function that unregisters it. An invalid key throws, so a typo
 * cannot silently opt an editor out of protection.
 */
export function registerEditorScope(key: string, isDirty: () => boolean): () => void {
  const scope = parseScopeKey(key);
  if (scope === null) throw new Error(`Unknown editor scope "${key}".`);
  const registration = { key, scope, isDirty };
  registrations.add(registration);
  return () => {
    registrations.delete(registration);
  };
}

/** Keys of the registered editors that are dirty right now. */
export function dirtyEditorScopes(): string[] {
  const keys: string[] = [];
  for (const registration of registrations) {
    try {
      if (registration.isDirty()) keys.push(registration.key);
    } catch {
      // An editor that cannot answer is treated as dirty: never refresh over it.
      keys.push(registration.key);
    }
  }
  return keys;
}

/** Whether any dirty editor holds edits a change to `scopes` could overwrite. */
export function hasDirtyOverlap(scopes: readonly ChangeScope[]): boolean {
  for (const key of dirtyEditorScopes()) {
    const scope = parseScopeKey(key);
    if (scope !== null && scopes.some((changed) => scopesOverlap(scope, changed))) return true;
  }
  return false;
}
