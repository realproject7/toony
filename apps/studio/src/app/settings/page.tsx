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
import { probeComfyui } from "@/lib/comfyui-probe";
import { workspaceRoot } from "@/lib/workspace";

// The config is read from disk per request; never cache it.
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const config = await readConfig(workspaceRoot());
  // Single-sourced probe (#154), so the first-paint badge matches /api/config
  // exactly — including the http/https SSRF guard the settings page now adopts.
  const connection = await probeComfyui(config.comfyui.endpoint);

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
