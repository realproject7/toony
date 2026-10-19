"use client";

// Client parts of Settings: the agent status (from the live feed), the theme
// choice and copying the workspace location.

import { useEffect, useState } from "react";
import { openAgentPanel } from "@/lib/agent/focus-store";
import { connectionLabel } from "@/lib/connection-store";
import {
  readThemeChoice,
  resolveTheme,
  THEME_CHOICES,
  THEME_STORAGE_KEY,
  type ThemeChoice,
} from "@/lib/theme";
import { useConnection } from "./library-welcome";
import { StudioIcon, type StudioIconName } from "./studio-icon";

export function AgentStatusCard() {
  const connection = useConnection();
  const connected = connection?.status === "connected";
  const attention = connection?.status === "needs-attention";
  return (
    <div className="settings-row" data-testid="settings-agent-status">
      <div>
        <p className="settings-status">
          <span
            className={`status-dot${connected ? " is-on" : attention ? " is-warn" : ""}`}
            aria-hidden="true"
          />
          {connectionLabel(connection)}
        </p>
        <p className="page-meta">
          {connected
            ? "Model, permissions and history live in the agent panel."
            : "Your agent runs on this computer with your own subscription."}
        </p>
      </div>
      <button
        type="button"
        className={connected ? "btn" : "btn btn-primary"}
        onClick={() => openAgentPanel({ view: connected ? "settings" : "setup" })}
        data-testid="open-agent-settings"
      >
        {connected ? "Open agent settings" : attention ? "Fix connection" : "Connect your agent"}
      </button>
    </div>
  );
}

const THEME_LABELS: Record<ThemeChoice, { label: string; icon: StudioIconName }> = {
  system: { label: "System", icon: "monitor" },
  light: { label: "Light", icon: "sun" },
  dark: { label: "Dark", icon: "moon" },
};

export function ThemePicker() {
  const [choice, setChoice] = useState<ThemeChoice>("system");
  useEffect(() => {
    try {
      setChoice(readThemeChoice(localStorage.getItem(THEME_STORAGE_KEY)));
    } catch {
      setChoice("system");
    }
  }, []);
  const choose = (next: ThemeChoice) => {
    setChoice(next);
    try {
      if (next === "system") localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // This tab keeps the choice without storage.
    }
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = resolveTheme(next, dark);
    document.documentElement.dataset.themeChoice = next;
  };
  return (
    <div className="segmented" role="radiogroup" aria-label="Theme" data-testid="theme-picker">
      {THEME_CHOICES.map((value) => (
        // biome-ignore lint/a11y/useSemanticElements: a segmented radio group of buttons.
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={choice === value}
          className="segmented-option"
          onClick={() => choose(value)}
        >
          <StudioIcon name={THEME_LABELS[value].icon} />
          {THEME_LABELS[value].label}
        </button>
      ))}
    </div>
  );
}

export function CopyText({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          })
          .catch(() => {});
      }}
    >
      <StudioIcon name={copied ? "check" : "copy"} /> {copied ? "Copied" : label}
    </button>
  );
}
