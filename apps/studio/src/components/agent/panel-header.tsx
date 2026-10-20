"use client";

// The panel header: the agent's mark and name, a status pill (Ready, Working,
// Waiting for you, Needs attention, Not connected), and the actions New chat,
// History, Settings (a popover), Expand and Hide.

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { type PanelStatus, providerName, STATUS_LABELS } from "@/lib/agent/panel-state";
import type { AgentPreferences, AgentProvider, ProviderStatus } from "@/lib/agent/protocol";
import { AgentMark, PanelIcon, Spinner } from "./panel-icon";

export type PanelMode = "docked" | "hidden" | "expanded";

export function StatusPill({ status }: { status: PanelStatus }) {
  return (
    <span className="agent-status" data-status={status}>
      {status === "working" || status === "loading" ? (
        <Spinner />
      ) : (
        <span className="agent-status-dot" aria-hidden="true" />
      )}
      {STATUS_LABELS[status]}
    </span>
  );
}

export interface PanelHeaderProps {
  provider: AgentProvider | null;
  status: PanelStatus;
  mode: PanelMode;
  narrow: boolean;
  connected: boolean;
  canStartChat: boolean;
  settingsOpen: boolean;
  settings: ReactNode;
  onSettingsOpen: (open: boolean) => void;
  onNewChat: () => void;
  onHistory: () => void;
  onExpand: () => void;
  onCollapse: () => void;
  onHide: () => void;
}

export function PanelHeader(props: PanelHeaderProps) {
  const {
    provider,
    status,
    mode,
    narrow,
    connected,
    canStartChat,
    settingsOpen,
    settings,
    onSettingsOpen,
    onNewChat,
    onHistory,
    onExpand,
    onCollapse,
    onHide,
  } = props;
  const popoverId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close the settings popover on an outside click or Escape. Escape is
  // caught first so it does not also close the expanded panel.
  useEffect(() => {
    if (!settingsOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) onSettingsOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      onSettingsOpen(false);
      wrapRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [settingsOpen, onSettingsOpen]);

  return (
    <header className="agent-header">
      <div className="agent-identity">
        <AgentMark provider={provider} />
        <div className="agent-identity-text">
          <strong>{connected ? providerName(provider) : "Agent"}</strong>
          <span role="status" aria-live="polite">
            <StatusPill status={status} />
          </span>
        </div>
      </div>
      <div className="agent-header-actions">
        <button
          type="button"
          className="agent-icon-button"
          title="New chat"
          aria-label="New chat"
          disabled={!canStartChat}
          onClick={onNewChat}
        >
          <PanelIcon name="plus" />
        </button>
        <button
          type="button"
          className="agent-icon-button"
          title="History"
          aria-label="Conversation history"
          disabled={!connected}
          onClick={onHistory}
        >
          <PanelIcon name="history" />
        </button>
        <div className="agent-settings-wrap" ref={wrapRef}>
          <button
            type="button"
            className="agent-icon-button"
            title="Agent settings"
            aria-label="Agent settings"
            aria-expanded={settingsOpen}
            aria-controls={settingsOpen ? popoverId : undefined}
            disabled={!connected}
            onClick={() => onSettingsOpen(!settingsOpen)}
          >
            <PanelIcon name="settings" />
          </button>
          {settingsOpen && (
            <div className="agent-popover" id={popoverId} role="dialog" aria-label="Agent settings">
              {settings}
            </div>
          )}
        </div>
        {!narrow &&
          (mode === "expanded" ? (
            <button
              type="button"
              className="agent-icon-button"
              title="Back to side panel"
              aria-label="Back to side panel"
              onClick={onCollapse}
            >
              <PanelIcon name="collapse" />
            </button>
          ) : (
            <button
              type="button"
              className="agent-icon-button"
              title="Expand"
              aria-label="Expand the conversation"
              onClick={onExpand}
            >
              <PanelIcon name="expand" />
            </button>
          ))}
        {!narrow && (
          <button
            type="button"
            className="agent-icon-button"
            title="Hide panel"
            aria-label="Hide the agent panel"
            onClick={onHide}
          >
            <PanelIcon name="hide" />
          </button>
        )}
      </div>
    </header>
  );
}

const PROVIDERS: Array<{ provider: AgentProvider; name: string }> = [
  { provider: "claude", name: "Claude" },
  { provider: "codex", name: "Codex" },
];

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="agent-toggle">
      <span className="agent-toggle-text">
        <span>{label}</span>
        <small>{hint}</small>
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

export interface SettingsPopoverProps {
  preferences: AgentPreferences;
  providers: ProviderStatus[] | null;
  saving: boolean;
  error: string | null;
  onChange: (preferences: AgentPreferences) => void;
  onSwitchProvider: (provider: AgentProvider) => void;
  onMemory: () => void;
  onDisconnect: () => void;
}

export function SettingsPopover(props: SettingsPopoverProps) {
  const {
    preferences,
    providers,
    saving,
    error,
    onChange,
    onSwitchProvider,
    onMemory,
    onDisconnect,
  } = props;
  const [model, setModel] = useState(preferences.model);
  useEffect(() => setModel(preferences.model), [preferences.model]);
  const readinessOf = (provider: AgentProvider) =>
    providers?.find((row) => row.provider === provider)?.readiness.state ?? null;
  const modelChanged = model.trim() !== preferences.model;

  return (
    <div className="agent-settings">
      <div className="agent-settings-group">
        <span className="agent-settings-label">Agent</span>
        <div className="agent-segmented">
          {PROVIDERS.map(({ provider, name }) => {
            const state = readinessOf(provider);
            const active = preferences.provider === provider;
            return (
              <button
                key={provider}
                type="button"
                aria-pressed={active}
                disabled={saving}
                onClick={() => {
                  if (!active) onSwitchProvider(provider);
                }}
              >
                {name}
                {!active && state && state !== "ready" && state !== "checking" && (
                  <small> · Not ready</small>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <Toggle
        label="Let the agent make changes without asking"
        hint="Every change can be undone. When off, you approve each change."
        checked={preferences.autoApply}
        disabled={saving}
        onChange={(value) => onChange({ ...preferences, autoApply: value })}
      />
      <Toggle
        label="Agent can look at artwork"
        hint="It can view cuts with their lettering to check its work."
        checked={preferences.viewArtwork}
        disabled={saving}
        onChange={(value) => onChange({ ...preferences, viewArtwork: value })}
      />
      <Toggle
        label="Keep conversations on this computer"
        hint="When off, conversations end when Toony stops."
        checked={preferences.retainHistory}
        disabled={saving}
        onChange={(value) => onChange({ ...preferences, retainHistory: value })}
      />
      <details className="agent-advanced">
        <summary>
          <PanelIcon name="chevron" /> Advanced
        </summary>
        <form
          className="agent-field"
          onSubmit={(event) => {
            event.preventDefault();
            if (modelChanged) onChange({ ...preferences, model: model.trim() });
          }}
        >
          <label htmlFor="agent-settings-model">Model</label>
          <div className="agent-field-row">
            <input
              id="agent-settings-model"
              value={model}
              maxLength={100}
              spellCheck={false}
              autoComplete="off"
              placeholder="Default"
              disabled={saving}
              onChange={(event) => setModel(event.target.value)}
            />
            <button
              type="submit"
              className="btn btn-ghost agent-small-button"
              disabled={!modelChanged || saving}
            >
              Save
            </button>
          </div>
          <small>Leave empty to use your agent's default model.</small>
        </form>
      </details>
      {error && (
        <p className="agent-card-error" role="alert">
          {error}
        </p>
      )}
      <div className="agent-settings-footer">
        <button type="button" className="agent-text-button" onClick={onMemory}>
          <PanelIcon name="memory" /> What the agent remembers
        </button>
        <button
          type="button"
          className="agent-text-button"
          data-tone="danger"
          onClick={onDisconnect}
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}
