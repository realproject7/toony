// Icons for the agent panel. Symbols the Studio set already has come from
// `StudioIcon`; the rest are drawn here on the same 24-unit grid, 16 px size,
// 1.7 stroke and round caps, so the panel reads as one icon family.

import type { AgentProvider } from "@/lib/agent/protocol";
import { StudioIcon } from "../studio-icon";

const shared = {
  plus: "plus",
  close: "close",
  check: "check",
  chevron: "chevron",
  copy: "copy",
  undo: "undo",
  trash: "trash",
  stop: "stop",
  arrow: "arrow",
  chat: "chat",
} as const;

const own = {
  send: "M12 19V5m-6 6 6-6 6 6",
  history: "M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4M12 8v4l3 2",
  settings: "M4 7h9m4 0h3M4 17h3m4 0h9M15 4.5v5M9 14.5v5",
  expand: "M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7",
  collapse: "M4 14h6v6M20 10h-6V4M10 14l-6 6M14 10l6-6",
  hide: "M4 4h16v16H4zM15 4v16M8 10l2 2-2 2",
  alert: "M12 3 2 20h20L12 3Zm0 6v5m0 3h.01",
  external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  refresh: "M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4",
  memory: "M6 3h12v18l-6-4-6 4V3Z",
  sparkle: "M12 3c.6 4.4 2.6 6.4 7 7-4.4.6-6.4 2.6-7 7-.6-4.4-2.6-6.4-7-7 4.4-.6 6.4-2.6 7-7Z",
  dot: "M12 12h.01",
} as const;

export type PanelIconName = keyof typeof shared | keyof typeof own;

export function PanelIcon({ name }: { name: PanelIconName }) {
  if (name in shared) return <StudioIcon name={shared[name as keyof typeof shared]} />;
  return (
    <svg
      className="studio-icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "dot" ? 6 : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={own[name as keyof typeof own]} />
    </svg>
  );
}

/** A small spinner for running steps. It stops turning when reduced motion is on. */
export function Spinner({ label }: { label?: string }) {
  const svg = (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        opacity="0.25"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
  return label ? (
    <span className="agent-spinner" role="img" aria-label={label}>
      {svg}
    </span>
  ) : (
    <span className="agent-spinner" aria-hidden="true">
      {svg}
    </span>
  );
}

/**
 * The agent's mark: a neutral glyph per provider (a burst for Claude, a prompt
 * for Codex, a sparkle before one is chosen). Not a brand logo.
 */
export function AgentMark({
  provider,
  size = "md",
}: {
  provider: AgentProvider | null | undefined;
  size?: "md" | "lg";
}) {
  const px = size === "lg" ? 22 : 16;
  return (
    <span
      className="agent-mark"
      data-size={size}
      data-provider={provider ?? "none"}
      aria-hidden="true"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width={px}
        height={px}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {provider === "claude" ? (
          <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" />
        ) : provider === "codex" ? (
          <path d="m5 7 5 5-5 5M12 18h7" />
        ) : (
          <path d={own.sparkle} />
        )}
      </svg>
    </span>
  );
}
