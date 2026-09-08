"use client";

// Workspace settings editor (issue #52).
//
// Edits the SHARED workspace config (`.toony/config.json`) that the CLI and
// agents resolve generation settings from. The form fields mirror the
// provider-neutral config shape: the ComfyUI endpoint URL, the checkpoint name,
// and the workflow (a path or named workflow). Saving POSTs to `/api/config`,
// which validates + writes the file server-side and returns the live connection
// status; the badge reflects whether the configured endpoint answered its
// `/system_stats` probe.
//
// Secrets never live here: the endpoint is the operator's own (typically local)
// ComfyUI address, and `.toony/` is gitignored. Env vars still override this file
// at generation time — the hint copy says so explicitly.

import { useCallback, useState } from "react";
import {
  asValue,
  type ConnectionState,
  describeTestOutcome,
  isDirty,
  UNSAVED_EDITS_MESSAGE,
} from "@/lib/settings-test-outcome";

interface Connection {
  state: ConnectionState;
  detail?: string;
}

interface ComfyConfig {
  endpoint: string | null;
  checkpoint: string | null;
  workflow: string | null;
}

interface ConfigResponse {
  ok: boolean;
  error?: string;
  config?: { comfyui: ComfyConfig };
  connection?: { state: Exclude<ConnectionState, "unknown">; detail?: string };
}

const BADGE: Record<ConnectionState, { text: string; tone: string }> = {
  reachable: { text: "Reachable", tone: "chip-ok" },
  unreachable: { text: "Not reachable", tone: "chip-danger" },
  unconfigured: { text: "No endpoint set", tone: "chip" },
  unknown: { text: "Unknown", tone: "chip" },
};

export interface SettingsFormProps {
  initialConfig: { comfyui: ComfyConfig };
  initialConnection: { state: Exclude<ConnectionState, "unknown">; detail?: string };
}

export function SettingsForm({ initialConfig, initialConnection }: SettingsFormProps) {
  const [endpoint, setEndpoint] = useState(asValue(initialConfig.comfyui.endpoint));
  const [checkpoint, setCheckpoint] = useState(asValue(initialConfig.comfyui.checkpoint));
  const [workflow, setWorkflow] = useState(asValue(initialConfig.comfyui.workflow));
  const [connection, setConnection] = useState<Connection>(initialConnection);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // What a test run reported. A probe usually resolves to the state already on
  // the badge, so without this the screen is identical before and after and the
  // button reads as broken (#223).
  const [tested, setTested] = useState<string | null>(null);
  // The values last written to disk. `test` probes the FILE, so it has to know
  // whether the form still matches it.
  const [savedConfig, setSavedConfig] = useState<ComfyConfig>(initialConfig.comfyui);

  const payload = useCallback(
    () => ({
      comfyui: {
        endpoint: endpoint.trim(),
        checkpoint: checkpoint.trim(),
        workflow: workflow.trim(),
      },
    }),
    [endpoint, checkpoint, workflow],
  );

  const dirty = isDirty({ endpoint, checkpoint, workflow }, savedConfig);

  const save = useCallback(async () => {
    setBusy("save");
    setError(null);
    setSaved(false);
    setTested(null);
    try {
      const body = payload();
      const response = await fetch("/api/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as ConfigResponse;
      if (!response.ok || !data.ok) {
        setError(data.error ?? "Could not save settings.");
        return;
      }
      if (data.connection) setConnection(data.connection);
      // Track what reached disk from the SERVER's echo where it gives one, so a
      // value the server normalized does not leave the form looking dirty.
      setSavedConfig(data.config?.comfyui ?? body.comfyui);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }, [payload]);

  // "Test connection" re-probes the SAVED config, not the form. That is the
  // config the CLI and agents actually resolve, so a green badge for an unsaved
  // value would be a badge for a state that does not exist on disk.
  //
  // The probe almost always resolves to the state already shown, so this must
  // report an outcome every time it runs. Reporting nothing is what made the
  // button look broken (#223).
  const test = useCallback(async () => {
    if (dirty) {
      setError(null);
      setTested(UNSAVED_EDITS_MESSAGE);
      return;
    }
    setBusy("test");
    setError(null);
    setTested(null);
    try {
      const response = await fetch("/api/config", { method: "GET" });
      const data = (await response.json()) as ConfigResponse;
      if (!response.ok || !data.ok) {
        setError(data.error ?? "Could not reach the settings service.");
        return;
      }
      if (data.connection) setConnection(data.connection);
      setTested(describeTestOutcome(data.connection?.state, data.connection?.detail));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }, [dirty]);

  const badge = BADGE[connection.state];

  return (
    <section className="card settings-card" data-testid="settings-comfyui">
      <div className="settings-card-head">
        <div>
          <h2 className="card-title">Generation — ComfyUI</h2>
          <p className="field-hint">
            Toony is provider-neutral. Point it at your own ComfyUI install; these settings are
            saved to the workspace and shared with the CLI and agents. Environment variables (e.g.{" "}
            <code>TOONY_COMFYUI_URL</code>) override this file when set.
          </p>
        </div>
        <span
          className={`chip ${badge.tone}`}
          data-testid="connection-badge"
          data-state={connection.state}
          title={connection.detail ?? undefined}
        >
          {badge.text}
          {connection.detail ? ` · ${connection.detail}` : ""}
        </span>
      </div>

      <div className="settings-fields">
        <label className="field">
          <span>Endpoint URL</span>
          <input
            type="text"
            inputMode="url"
            placeholder="http://127.0.0.1:8188"
            value={endpoint}
            disabled={busy !== null}
            onChange={(e) => {
              setEndpoint(e.target.value);
              setSaved(false);
              setTested(null);
            }}
            data-testid="settings-endpoint"
          />
          <span className="field-hint">
            The base URL of your ComfyUI server (its documented default is
            <code> http://127.0.0.1:8188</code>).
          </span>
        </label>

        <label className="field">
          <span>Checkpoint</span>
          <input
            type="text"
            placeholder="e.g. sd_xl_base_1.0.safetensors"
            value={checkpoint}
            disabled={busy !== null}
            onChange={(e) => {
              setCheckpoint(e.target.value);
              setSaved(false);
              setTested(null);
            }}
            data-testid="settings-checkpoint"
          />
          <span className="field-hint">
            Optional. The checkpoint/model filename to load on the server.
          </span>
        </label>

        <label className="field">
          <span>Workflow</span>
          <input
            type="text"
            placeholder="e.g. ./workflows/txt2img.json"
            value={workflow}
            disabled={busy !== null}
            onChange={(e) => {
              setWorkflow(e.target.value);
              setSaved(false);
              setTested(null);
            }}
            data-testid="settings-workflow"
          />
          <span className="field-hint">
            Optional. Path to a ComfyUI workflow-graph JSON template. Leave blank to use the bundled
            default workflow.
          </span>
        </label>
      </div>

      <div className="editor-actions settings-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={save}
          disabled={busy !== null}
          data-testid="settings-save"
        >
          {busy === "save" ? "Saving…" : "Save settings"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={test}
          disabled={busy !== null}
          data-testid="settings-test"
        >
          {busy === "test" ? "Testing…" : "Test connection"}
        </button>
        {saved && (
          <span className="settings-ok" role="status" data-testid="settings-saved">
            Saved
          </span>
        )}
        {tested && (
          <span className="field-hint" role="status" data-testid="settings-test-result">
            {tested}
          </span>
        )}
        {error && (
          <span className="new-work-error" role="alert" data-testid="settings-error">
            {error}
          </span>
        )}
      </div>
    </section>
  );
}
