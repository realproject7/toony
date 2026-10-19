"use client";

// The Studio shell: the rail, the human workspace (the route's page) and the
// agent panel. The panel is docked at 360 px by default (320-520, resized by
// drag or keyboard and remembered on this computer), can be hidden behind a
// small floating button that still shows when the agent works or waits, or
// expanded into a dialog over the workspace. Below 900 px a Workspace / Agent
// switch shows one of the two while both keep their state. Hiding, expanding
// or switching never unmounts the editor or the conversation.
// The workspace opens the panel with `openAgentPanel` (lib/agent/focus-store).

import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AGENT_PANEL_EVENT, type AgentPanelRequest } from "@/lib/agent/focus-store";
import { type PanelStatus, STATUS_LABELS } from "@/lib/agent/panel-state";
import { AgentPanel, type PanelRequest } from "./agent/agent-panel";
import type { PanelMode } from "./agent/panel-header";
import { AgentMark, Spinner } from "./agent/panel-icon";
import { Sidebar } from "./sidebar";

const WIDTH_KEY = "toony-agent-width";
const MODE_KEY = "toony-agent-mode";
const MIN_WIDTH = 320;
const MAX_WIDTH = 520;
const DEFAULT_WIDTH = 360;
const NARROW_QUERY = "(max-width: 899px)";

const clampWidth = (value: number) => Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, value)));

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The choice still holds for this tab.
  }
}

const FOCUSABLE =
  'button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],summary,[tabindex]:not([tabindex="-1"])';

export function AgentWorkspace({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<PanelMode>("docked");
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [narrow, setNarrow] = useState(false);
  const [pane, setPane] = useState<"workspace" | "agent">("workspace");
  const [status, setStatus] = useState<PanelStatus>("loading");
  const [request, setRequest] = useState<PanelRequest | null>(null);
  const [restored, setRestored] = useState(false);
  const dockRef = useRef<HTMLElement>(null);
  const restoreRef = useRef<HTMLButtonElement>(null);

  // Restore the remembered width and hidden state.
  useEffect(() => {
    const storedWidth = Number(readStored(WIDTH_KEY));
    if (Number.isFinite(storedWidth) && storedWidth > 0) setWidth(clampWidth(storedWidth));
    if (readStored(MODE_KEY) === "hidden") setMode("hidden");
    setRestored(true);
  }, []);

  useEffect(() => {
    if (restored) writeStored(WIDTH_KEY, String(width));
  }, [width, restored]);

  useEffect(() => {
    if (restored && mode !== "expanded") writeStored(MODE_KEY, mode);
  }, [mode, restored]);

  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  // The workspace asks the panel to show itself and open a view.
  useEffect(() => {
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<AgentPanelRequest>).detail;
      if (!detail) return;
      setMode((current) => (current === "hidden" ? "docked" : current));
      setPane("agent");
      setRequest({ ...detail, nonce: Date.now() + Math.random() });
    };
    window.addEventListener(AGENT_PANEL_EVENT, onRequest);
    return () => window.removeEventListener(AGENT_PANEL_EVENT, onRequest);
  }, []);

  const expanded = mode === "expanded" && !narrow;

  // Expanded mode is a modal dialog: trap focus, close on Escape, give focus back.
  useEffect(() => {
    if (!expanded) return;
    const dock = dockRef.current;
    const previous = document.activeElement;
    const focusables = () =>
      Array.from(dock?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (element) => element.getClientRects().length > 0,
      );
    const textarea = dock?.querySelector<HTMLTextAreaElement>("textarea:not([disabled])");
    (textarea ?? focusables()[0])?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setMode("docked");
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dock?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dock?.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [expanded]);

  const hide = useCallback(() => {
    setMode("hidden");
    window.requestAnimationFrame(() => restoreRef.current?.focus());
  }, []);
  const restore = useCallback(() => setMode("docked"), []);
  const onInternalNavigate = useCallback(() => {
    setMode((current) => (current === "expanded" ? "docked" : current));
    setPane("workspace");
  }, []);

  const busy = status === "working" || status === "waiting";
  const agentPaneActive = narrow && pane === "agent";
  const workspacePaneActive = narrow && pane === "workspace";
  const style = { "--agent-width": `${width}px` } as CSSProperties;

  return (
    <div
      className="app-frame agent-workspace"
      data-agent-mode={narrow ? "docked" : mode}
      data-layout={narrow ? "narrow" : "wide"}
      data-pane={narrow ? pane : undefined}
      style={style}
    >
      <div className="workspace-rail" inert={expanded}>
        <Sidebar />
      </div>
      {narrow && (
        <div className="shell-switch">
          <button
            type="button"
            aria-pressed={pane === "workspace"}
            onClick={() => setPane("workspace")}
          >
            Workspace
          </button>
          <button type="button" aria-pressed={pane === "agent"} onClick={() => setPane("agent")}>
            Agent
            {busy && (
              <span className="shell-switch-state" data-status={status}>
                {status === "working" ? <Spinner /> : null}
                <span className="agent-sr-only">{STATUS_LABELS[status]}</span>
              </span>
            )}
          </button>
        </div>
      )}
      <div className="human-workspace" inert={expanded || agentPaneActive}>
        <main className="content">{children}</main>
        {mode === "hidden" && !narrow && (
          <button
            ref={restoreRef}
            type="button"
            className="agent-restore"
            data-status={status}
            aria-label={`Show the agent panel. ${STATUS_LABELS[status]}`}
            onClick={restore}
          >
            <AgentMark provider={null} />
            {busy ? (
              <span className="agent-restore-state">
                {status === "working" ? <Spinner /> : <span className="agent-status-dot" />}
                {STATUS_LABELS[status]}
              </span>
            ) : (
              <span>Agent</span>
            )}
          </button>
        )}
      </div>
      {expanded && (
        <button
          type="button"
          className="agent-backdrop"
          aria-label="Back to the workspace"
          tabIndex={-1}
          onClick={() => setMode("docked")}
        />
      )}
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: the docked panel becomes a modal dialog when expanded. */}
      <aside
        ref={dockRef}
        className="agent-dock"
        role={expanded ? "dialog" : "complementary"}
        aria-modal={expanded ? true : undefined}
        aria-label="Agent"
        hidden={mode === "hidden" && !narrow}
        inert={workspacePaneActive}
      >
        {!narrow && mode === "docked" && (
          <hr
            className="agent-resize"
            aria-label="Agent panel width"
            aria-orientation="vertical"
            aria-valuemin={MIN_WIDTH}
            aria-valuemax={MAX_WIDTH}
            aria-valuenow={width}
            tabIndex={0}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 40 : 16;
              if (event.key === "ArrowLeft") setWidth((value) => clampWidth(value + step));
              else if (event.key === "ArrowRight") setWidth((value) => clampWidth(value - step));
              else if (event.key === "Home") setWidth(MIN_WIDTH);
              else if (event.key === "End") setWidth(MAX_WIDTH);
              else return;
              event.preventDefault();
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              document.documentElement.dataset.agentResizing = "true";
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                setWidth(clampWidth(window.innerWidth - event.clientX));
            }}
            onPointerUp={(event) => {
              event.currentTarget.releasePointerCapture(event.pointerId);
              delete document.documentElement.dataset.agentResizing;
            }}
            onPointerCancel={() => {
              delete document.documentElement.dataset.agentResizing;
            }}
            onDoubleClick={() => setWidth(DEFAULT_WIDTH)}
          />
        )}
        <AgentPanel
          mode={narrow ? "docked" : mode}
          narrow={narrow}
          request={request}
          onExpand={() => setMode("expanded")}
          onCollapse={() => setMode("docked")}
          onHide={hide}
          onInternalNavigate={onInternalNavigate}
          onStatus={setStatus}
        />
      </aside>
    </div>
  );
}
