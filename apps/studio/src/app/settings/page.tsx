// Settings for this workspace: the agent, where webtoons are saved, the look of
// Studio, the artwork engine the agent draws with and installed packs.

import { loadPacks } from "@toony/packs";
import { defaultConfig, readConfig, type ToonyConfig } from "@toony/project-io";
import { SettingsForm } from "@/components/settings-form";
import { AgentStatusCard, CopyText, ThemePicker } from "@/components/settings-panels";
import { RouteFocus } from "@/components/work-presence";
import { artEngineStatus } from "@/lib/art/engine";
import { probeComfyui } from "@/lib/comfyui-probe";
import { redactPaths } from "@/lib/redact";
import { workspaceDisplayPath, workspaceRoot } from "@/lib/workspace";

// The config is read from disk per request; never cache it.
export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const root = workspaceRoot();
  // A settings file that cannot be read must not take the page down: show the
  // defaults and say so; saving writes a valid file over it.
  let config: ToonyConfig;
  let configUnreadable = false;
  try {
    config = await readConfig(root);
  } catch {
    config = defaultConfig();
    configUnreadable = true;
  }
  // An address set for this computer (TOONY_COMFYUI_URL) is what the agent
  // draws with, ahead of the address saved below.
  const fromEnvironment = Boolean(process.env.TOONY_COMFYUI_URL?.trim());
  const [connection, packs, engine] = await Promise.all([
    probeComfyui(config.comfyui.endpoint),
    loadPacks(root, process.env).catch(() => null),
    artEngineStatus(root, process.env, { fresh: true }),
  ]);
  const displayPath = workspaceDisplayPath(root);

  return (
    <div className="page settings-page" data-testid="studio-settings">
      <RouteFocus route="settings" />
      <header className="page-head">
        <h1 className="page-title">Settings</h1>
      </header>

      <section className="settings-section" aria-labelledby="settings-agent">
        <h2 id="settings-agent">Agent</h2>
        <AgentStatusCard />
      </section>

      <section className="settings-section" aria-labelledby="settings-workspace">
        <h2 id="settings-workspace">Workspace</h2>
        <div className="settings-row">
          <div>
            <p className="settings-status">Your webtoons are saved in</p>
            <p className="path-text" data-testid="workspace-path">
              {displayPath}
            </p>
          </div>
          <CopyText text={displayPath} label="Copy location" />
        </div>
      </section>

      <section className="settings-section" aria-labelledby="settings-appearance">
        <h2 id="settings-appearance">Appearance</h2>
        <div className="settings-row">
          <p className="settings-status">Theme</p>
          <ThemePicker />
        </div>
      </section>

      <section className="settings-section" aria-labelledby="settings-artwork">
        <h2 id="settings-artwork">Artwork engine</h2>
        {fromEnvironment && (
          <p className="page-meta" data-testid="engine-from-environment">
            This computer sets the engine address, and the agent uses it before the one below.{" "}
            {engine.message}
          </p>
        )}
        <details
          className="disclosure"
          open={fromEnvironment ? !engine.ready : connection.state !== "reachable"}
        >
          <summary>ComfyUI on this computer, which your agent draws with</summary>
          {configUnreadable && (
            <p className="form-error" role="alert" data-testid="settings-config-error">
              The settings file could not be read. Saving replaces it.
            </p>
          )}
          <SettingsForm initialConfig={config} initialConnection={connection} />
        </details>
      </section>

      <section className="settings-section" aria-labelledby="settings-packs">
        <h2 id="settings-packs">Packs</h2>
        {packs === null ? (
          <p className="page-meta">Toony could not read the installed packs.</p>
        ) : packs.packs.length === 0 && packs.issues.length === 0 ? (
          <p className="page-meta">
            No packs installed. Packs add genres, lettering themes and export presets.
          </p>
        ) : (
          <>
            {packs.packs.length > 0 && (
              <ul className="pack-list">
                {packs.packs.map((pack) => (
                  <li key={pack.id}>{pack.name}</li>
                ))}
              </ul>
            )}
            {packs.issues.length > 0 && (
              <details className="disclosure" data-testid="pack-warnings">
                <summary>
                  {packs.issues.length === 1
                    ? "One pack item could not be loaded"
                    : `${packs.issues.length} pack items could not be loaded`}
                </summary>
                <ul className="plain-list">
                  {[...new Set(packs.issues.map((issue) => redactPaths(issue.message)))].map(
                    (text) => (
                      <li key={text}>{text}</li>
                    ),
                  )}
                </ul>
              </details>
            )}
          </>
        )}
      </section>
    </div>
  );
}
