// The agent connection, saved as `<workspace>/.toony-agent/settings.json`
// (0600). Version 2 holds the preferences and when the connection was checked.
// A version 1 file (provider, model, projectContext, retainHistory) from an
// older build is migrated on load: same provider and model, retention kept,
// changes without asking and artwork viewing on.

import { join } from "node:path";
import { type AgentPreferences, DEFAULT_PREFERENCES } from "./protocol.js";
import { readPrivateJson, writePrivateJson } from "./storage.js";
import { agentPreferences, isModelName, isProvider } from "./types.js";

export const SETTINGS_VERSION = 2;

export interface SavedConnection {
  version: 2;
  preferences: AgentPreferences;
  verifiedAt: string;
}

export function settingsFile(agentDir: string): string {
  return join(agentDir, "settings.json");
}

/** Read a saved connection, migrating a version 1 file. Null when none or unusable. */
export function parseSettings(
  value: unknown,
  now: () => Date = () => new Date(),
): {
  connection: SavedConnection | null;
  migrated: boolean;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { connection: null, migrated: false };
  }
  const v = value as Record<string, unknown>;
  if (v.version === SETTINGS_VERSION) {
    try {
      const preferences = agentPreferences(v.preferences);
      const verifiedAt = typeof v.verifiedAt === "string" ? v.verifiedAt : now().toISOString();
      return { connection: { version: 2, preferences, verifiedAt }, migrated: false };
    } catch {
      return { connection: null, migrated: false };
    }
  }
  // Version 1: the file existed only after a successful connection check.
  if (v.version === undefined && isProvider(v.provider) && isModelName(v.model ?? "")) {
    return {
      connection: {
        version: 2,
        preferences: {
          ...DEFAULT_PREFERENCES,
          provider: v.provider,
          model: typeof v.model === "string" ? v.model : "",
          retainHistory:
            typeof v.retainHistory === "boolean"
              ? v.retainHistory
              : DEFAULT_PREFERENCES.retainHistory,
        },
        verifiedAt: now().toISOString(),
      },
      migrated: true,
    };
  }
  return { connection: null, migrated: false };
}

export async function loadSettings(agentDir: string): Promise<SavedConnection | null> {
  const raw = await readPrivateJson(settingsFile(agentDir), 64 * 1024).catch(() => null);
  const { connection, migrated } = parseSettings(raw);
  if (connection && migrated) await saveSettings(agentDir, connection).catch(() => {});
  return connection;
}

export async function saveSettings(agentDir: string, connection: SavedConnection): Promise<void> {
  await writePrivateJson(settingsFile(agentDir), connection);
}
