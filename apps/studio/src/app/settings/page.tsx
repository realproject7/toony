// Workspace settings (issue #52).
//
// Studio v2 is workspace-scoped: generation settings live ONCE per workspace, not
// per work, so this page sits at the workspace level (`/settings`). It reads the
// shared config (`.toony/config.json`) server-side and hands it to a client form
// that persists edits through `/api/config` (the same file the CLI and agents
// resolve from; env vars still override it). The page also runs an initial
// connection probe so the status badge is populated on first paint.
//
// No path input is accepted anywhere — the config is always the workspace root's,
// resolved server-side by `@/lib/workspace`.

import { readConfig } from "@toony/project-io";
import { SettingsForm } from "@/components/settings-form";
import { workspaceRoot } from "@/lib/workspace";

// The config is read from disk per request; never cache it.
export const dynamic = "force-dynamic";

const PING_TIMEOUT_MS = 4_000;

/**
 * Probe the configured ComfyUI `/system_stats` for the initial badge. Mirrors the
 * route's probe; kept here so the first paint already shows reachability without a
 * client round-trip. Any failure is "unreachable"; an unset endpoint is
 * "unconfigured".
 */
async function probe(
  endpoint: string | null,
): Promise<{ state: "reachable" | "unreachable" | "unconfigured"; detail?: string }> {
  if (endpoint === null) return { state: "unconfigured" };
  let base: URL;
  try {
    base = new URL(endpoint);
  } catch {
    return { state: "unreachable" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  try {
    const response = await fetch(new URL("/system_stats", base), { signal: controller.signal });
    if (!response.ok) return { state: "unreachable" };
    let detail: string | undefined;
    try {
      const stats = (await response.json()) as { system?: { comfyui_version?: unknown } };
      const version = stats.system?.comfyui_version;
      if (typeof version === "string" && version.length > 0) detail = `ComfyUI ${version}`;
    } catch {
      // Reachable but non-JSON is still reachable.
    }
    return { state: "reachable", detail };
  } catch {
    return { state: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

export default async function SettingsPage() {
  const config = await readConfig(workspaceRoot());
  const connection = await probe(config.comfyui.endpoint);

  return (
    <div data-testid="studio-settings">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">Workspace</p>
          <h1 className="page-title">Settings</h1>
          <p className="page-meta">
            Connect the image model you generate with. Saved to this workspace and shared with the
            CLI and agents.
          </p>
        </div>
      </header>

      <SettingsForm initialConfig={config} initialConnection={connection} />
    </div>
  );
}
