"use client";

// First-run connection inside the panel: one card per supported agent with its
// live readiness (ready, sign in needed, not installed, unsupported version,
// checking), the exact fix command with Copy, "Check again", the model under
// Advanced, and one primary Connect button.

import { useEffect, useId, useState } from "react";
import { isSafeExternalHref } from "@/lib/agent/markdown";
import type { AgentProvider, ProviderReadiness, ProviderStatus } from "@/lib/agent/protocol";
import { CopyCommand } from "./cards";
import { AgentMark, PanelIcon, Spinner } from "./panel-icon";

const PROVIDERS: Array<{ provider: AgentProvider; label: string; name: string }> = [
  { provider: "claude", label: "Claude Code", name: "Claude" },
  { provider: "codex", label: "Codex", name: "Codex" },
];

export interface SetupViewProps {
  providers: ProviderStatus[] | null;
  checking: boolean;
  connecting: boolean;
  error: string | null;
  initialProvider?: AgentProvider;
  initialModel?: string;
  onCheck: () => void;
  onConnect: (provider: AgentProvider, model: string) => void;
}

function readinessBadge(readiness: ProviderReadiness): { text: string; tone: string } {
  switch (readiness.state) {
    case "ready":
      return { text: "Ready", tone: "ready" };
    case "sign-in-required":
      return { text: "Sign in needed", tone: "warn" };
    case "missing":
      return { text: "Not installed", tone: "muted" };
    case "unsupported":
      return { text: "Unsupported version", tone: "warn" };
    case "checking":
      return { text: "Checking", tone: "muted" };
    case "unavailable":
      return { text: "Could not check", tone: "warn" };
  }
}

function ReadinessDetail({ readiness }: { readiness: ProviderReadiness }) {
  switch (readiness.state) {
    case "ready":
      return <p className="agent-provider-note">Signed in. Version {readiness.version}.</p>;
    case "sign-in-required":
      return (
        <div className="agent-provider-fix">
          {readiness.message && <p className="agent-provider-note">{readiness.message}</p>}
          <p className="agent-provider-note">
            Sign in with your subscription in a terminal, then check again.
          </p>
          <CopyCommand command={readiness.command} />
        </div>
      );
    case "missing":
      return (
        <div className="agent-provider-fix">
          <p className="agent-provider-note">Install it in a terminal, then check again.</p>
          <CopyCommand command={readiness.installCommand} />
          {isSafeExternalHref(readiness.docsUrl) && (
            <a
              className="agent-text-link"
              href={readiness.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Setup guide <PanelIcon name="external" />
            </a>
          )}
        </div>
      );
    case "unsupported":
      return (
        <p className="agent-provider-note">
          {readiness.detail ??
            `Toony supports ${readiness.supported}. This computer has ${readiness.version}.`}
        </p>
      );
    case "checking":
      return <p className="agent-provider-note">Looking for it on this computer.</p>;
    case "unavailable":
      return <p className="agent-provider-note">{readiness.detail}</p>;
  }
}

export function SetupView(props: SetupViewProps) {
  const {
    providers,
    checking,
    connecting,
    error,
    initialProvider,
    initialModel,
    onCheck,
    onConnect,
  } = props;
  const id = useId();
  const statusOf = (provider: AgentProvider): ProviderReadiness =>
    providers?.find((row) => row.provider === provider)?.readiness ?? { state: "checking" };
  const [chosen, setChosen] = useState<AgentProvider | null>(initialProvider ?? null);
  const [model, setModel] = useState(initialModel ?? "");

  // Pick the first ready agent once readiness arrives, unless the person chose.
  useEffect(() => {
    if (chosen !== null || !providers) return;
    const ready = providers.find((row) => row.readiness.state === "ready");
    if (ready) setChosen(ready.provider);
  }, [providers, chosen]);

  const selected = chosen ?? "claude";
  const selectedReady = statusOf(selected).state === "ready";
  const selectedName = PROVIDERS.find((row) => row.provider === selected)?.name ?? "agent";

  return (
    <section className="agent-setup" aria-labelledby={`${id}-title`}>
      <div className="agent-setup-intro">
        <AgentMark provider={chosen} size="lg" />
        <h2 id={`${id}-title`}>Connect your agent</h2>
        <p>Toony works with the coding agent you already use. Pick one to continue.</p>
      </div>
      <div className="agent-provider-list" role="radiogroup" aria-label="Agent">
        {PROVIDERS.map(({ provider, label }) => {
          const readiness = statusOf(provider);
          const badge = readinessBadge(readiness);
          const isChosen = selected === provider;
          return (
            <label
              key={provider}
              className="agent-provider"
              data-chosen={isChosen ? "true" : undefined}
            >
              <input
                type="radio"
                name={`${id}-provider`}
                value={provider}
                checked={isChosen}
                disabled={connecting}
                onChange={() => setChosen(provider)}
              />
              <span className="agent-provider-head">
                <AgentMark provider={provider} />
                <span className="agent-provider-name">{label}</span>
                <span className="agent-readiness" data-tone={badge.tone}>
                  {readiness.state === "checking" ? (
                    <Spinner />
                  ) : (
                    <span className="agent-readiness-dot" />
                  )}
                  {badge.text}
                </span>
              </span>
              {isChosen && <ReadinessDetail readiness={readiness} />}
            </label>
          );
        })}
      </div>
      <div className="agent-setup-row">
        <button
          type="button"
          className="agent-text-button"
          disabled={checking || connecting}
          onClick={onCheck}
        >
          {checking ? <Spinner /> : <PanelIcon name="refresh" />}
          {checking ? "Checking" : "Check again"}
        </button>
      </div>
      <details className="agent-advanced">
        <summary>
          <PanelIcon name="chevron" /> Advanced
        </summary>
        <label className="agent-field">
          <span>Model</span>
          <input
            value={model}
            maxLength={100}
            disabled={connecting}
            spellCheck={false}
            autoComplete="off"
            placeholder="Default"
            onChange={(event) => setModel(event.target.value)}
          />
          <small>Leave empty to use your agent's default model.</small>
        </label>
      </details>
      {error && (
        <p className="agent-card-error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="btn btn-primary agent-connect"
        disabled={!selectedReady || connecting}
        onClick={() => onConnect(selected, model.trim())}
      >
        {connecting ? <Spinner /> : null}
        {connecting ? "Connecting" : `Connect ${selectedName}`}
      </button>
      <p className="agent-disclosure">
        Your agent runs on this computer with your own subscription. It reads and edits this
        workspace through Toony.
      </p>
    </section>
  );
}
