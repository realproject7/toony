"use client";

// Artwork engine settings (ComfyUI on this computer) for the workspace. The
// agent draws and edits cut artwork with this engine, and the command line tools
// use the same settings. One "Save and test" writes the workspace file and
// probes the saved address, and always says what it found.

import { useState } from "react";
import { asValue, type ConnectionState, describeTestOutcome } from "@/lib/settings-test-outcome";
import { studioFetch } from "@/lib/studio-fetch";

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
  unconfigured: { text: "Not set up", tone: "chip" },
  unknown: { text: "Unknown", tone: "chip" },
};

export interface SettingsFormProps {
  initialConfig: { comfyui: ComfyConfig };
  initialConnection: { state: Exclude<ConnectionState, "unknown">; detail?: string };
}

function sentenceCase(text: string): string {
  return text.length > 0 ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

export function SettingsForm({ initialConfig, initialConnection }: SettingsFormProps) {
  const [endpoint, setEndpoint] = useState(asValue(initialConfig.comfyui.endpoint));
  const [checkpoint, setCheckpoint] = useState(asValue(initialConfig.comfyui.checkpoint));
  const [workflow, setWorkflow] = useState(asValue(initialConfig.comfyui.workflow));
  const [state, setState] = useState<ConnectionState>(initialConnection.state);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ text: string; error?: boolean } | null>(null);

  const saveAndTest = async () => {
    setBusy(true);
    setOutcome(null);
    try {
      const response = await studioFetch("/api/config", {
        method: "POST",
        body: JSON.stringify({
          comfyui: {
            endpoint: endpoint.trim(),
            checkpoint: checkpoint.trim(),
            workflow: workflow.trim(),
          },
        }),
      });
      const data = (await response.json()) as ConfigResponse;
      if (!response.ok || !data.ok) {
        setOutcome({
          text: sentenceCase(data.error ?? "Toony could not save these settings."),
          error: true,
        });
        return;
      }
      const connection = data.connection;
      setState(connection?.state ?? "unknown");
      setOutcome({
        text:
          connection?.state === "unconfigured"
            ? "Saved. No address is set, so the agent cannot draw yet."
            : `Saved. ${describeTestOutcome(connection?.state, connection?.detail)}`,
        error: connection?.state === "unreachable",
      });
    } catch {
      setOutcome({ text: "Could not reach Toony. Check that it is still running.", error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="settings-form"
      data-testid="settings-comfyui"
      onSubmit={(event) => {
        event.preventDefault();
        void saveAndTest();
      }}
    >
      <p className="page-meta">
        Status{" "}
        <span className={`chip ${BADGE[state].tone}`} data-testid="connection-badge">
          {BADGE[state].text}
        </span>
      </p>
      <label className="field">
        <span>Address</span>
        <input
          className="text-input"
          type="url"
          value={endpoint}
          placeholder="http://127.0.0.1:8188"
          onChange={(event) => setEndpoint(event.target.value)}
          data-testid="settings-endpoint"
        />
      </label>
      <div className="form-grid">
        <label className="field">
          <span>Model file</span>
          <input
            className="text-input"
            value={checkpoint}
            onChange={(event) => setCheckpoint(event.target.value)}
            data-testid="settings-checkpoint"
          />
          <span className="field-hint">
            The checkpoint filename as ComfyUI lists it. The built-in workflow needs it; a custom
            workflow or a model set when starting Toony can supply it instead.
          </span>
        </label>
        <label className="field">
          <span>Workflow (optional)</span>
          <input
            className="text-input"
            value={workflow}
            placeholder="Built-in workflow"
            onChange={(event) => setWorkflow(event.target.value)}
            data-testid="settings-workflow"
          />
        </label>
      </div>
      <div className="form-actions">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy}
          data-testid="settings-save"
        >
          {busy ? "Saving and testing…" : "Save and test"}
        </button>
      </div>
      {outcome && (
        <p
          className={outcome.error ? "form-error" : "form-ok"}
          role={outcome.error ? "alert" : "status"}
          data-testid="settings-test-result"
        >
          {outcome.text}
        </p>
      )}
    </form>
  );
}
