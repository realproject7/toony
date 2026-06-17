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

/** Connection-badge state, mirrored from the `/api/config` probe result. */
type ConnectionState = "reachable" | "unreachable" | "unconfigured" | "unknown";

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

/** Empty-string for a null field, so the inputs are always controlled. */
function asValue(value: string | null): string {
  return value ?? "";
}

export function SettingsForm({ initialConfig, initialConnection }: SettingsFormProps) {
  const [endpoint, setEndpoint] = useState(asValue(initialConfig.comfyui.endpoint));
  const [checkpoint, setCheckpoint] = useState(asValue(initialConfig.comfyui.checkpoint));
  const [workflow, setWorkflow] = useState(asValue(initialConfig.comfyui.workflow));
  const [connection, setConnection] = useState<Connection>(initialConnection);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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

  const save = useCallback(async () => {
    setBusy("save");
    setError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload()),
      });
      const data = (await response.json()) as ConfigResponse;
      if (!response.ok || !data.ok) {
        setError(data.error ?? "Could not save settings.");
        return;
      }
      if (data.connection) setConnection(data.connection);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }, [payload]);

  // "Test connection" re-reads the saved config and re-probes it. It reflects the
  // ON-DISK endpoint, so save first to test unsaved edits.
  const test = useCallback(async () => {
    setBusy("test");
    setError(null);
    try {
      const response = await fetch("/api/config", { method: "GET" });
      const data = (await response.json()) as ConfigResponse;
      if (!response.ok || !data.ok) {
        setError(data.error ?? "Could not reach the settings service.");
        return;
      }
      if (data.connection) setConnection(data.connection);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }, []);

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
        {error && (
          <span className="new-work-error" role="alert" data-testid="settings-error">
            {error}
          </span>
        )}
      </div>
    </section>
  );
}
