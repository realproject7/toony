"use client";

import { usePathname } from "next/navigation";
import {
  type CSSProperties,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  AgentAvailability,
  AgentConversation,
  AgentFocus,
  AgentSettings,
  AgentView,
} from "@/lib/agent/types";
import { Sidebar } from "./sidebar";
import { StudioIcon } from "./studio-icon";

let bootstrap: Promise<void> | null = null;
async function callAgent(
  body: Record<string, unknown>,
  retry = true,
): Promise<Record<string, unknown>> {
  const send = (value: Record<string, unknown>) =>
    fetch("/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json", "x-toony-agent": "1" },
      body: JSON.stringify(value),
    });
  bootstrap ??= send({ action: "bootstrap" })
    .then((response) => {
      if (!response.ok) throw new Error("Open Toony from its local address to connect an agent.");
    })
    .catch((error) => {
      bootstrap = null;
      throw error;
    });
  await bootstrap;
  const response = await send(body);
  if (response.status === 401 && retry) {
    bootstrap = null;
    return callAgent(body, false);
  }
  const result = await response.json();
  if (!response.ok || !result.ok)
    throw new Error(
      typeof result.error === "string" ? result.error : "The agent request could not finish.",
    );
  return result;
}
function routeContext(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  const decode = (value: string | undefined) => {
    try {
      return value ? decodeURIComponent(value) : undefined;
    } catch {
      return undefined;
    }
  };
  const workId = parts[0] === "w" ? (decode(parts[1]) ?? null) : null;
  const focus: AgentFocus = {};
  if (parts[2] === "episodes") {
    const episodeId = decode(parts[3]);
    if (episodeId) focus.episodeId = episodeId;
    if (parts[4] === "cuts") {
      const cutId = decode(parts[5]);
      if (cutId) focus.cutId = cutId;
    }
  }
  return { workId, focus };
}
const AgentWorkspaceContext = createContext<{
  ask: (message: string, focus?: AgentFocus) => void;
  openConnection: () => void;
}>({ ask: () => {}, openConnection: () => {} });
export const useAgentWorkspace = () => useContext(AgentWorkspaceContext);
const EMPTY: AgentView = { settings: null, conversation: null, turn: null };
const DEFAULT: AgentSettings = {
  provider: "claude",
  model: "",
  projectContext: true,
  retainHistory: true,
};
const providerName = (provider: string) => (provider === "claude" ? "Claude" : "Codex");
function Icon({ name }: { name: "send" | "close" | "expand" | "history" | "plus" | "chat" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "send" ? (
        <path d="m12 19 0-14m-6 6 6-6 6 6" />
      ) : name === "close" ? (
        <path d="m6 6 12 12M6 18 18 6" />
      ) : name === "expand" ? (
        <path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4" />
      ) : name === "history" ? (
        <>
          <path d="M4 8a8 8 0 1 1-1 6M3 3v6h6" />
          <path d="M12 7v5l3 2" />
        </>
      ) : name === "plus" ? (
        <path d="M12 5v14M5 12h14" />
      ) : (
        <path d="M4 4h16v12H9l-5 4V4Z" />
      )}
    </svg>
  );
}
interface HistoryRow {
  id: string;
  title: string;
  provider: string;
  saved: boolean;
  canContinue: boolean;
  updatedAt: string;
}
export function AgentWorkspace({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const { workId, focus: routeFocus } = routeContext(pathname);
  const key = workId === null ? "library" : `work:${workId}`;
  const [mode, setMode] = useState<"docked" | "hidden" | "expanded">("docked");
  const [width, setWidth] = useState(360);
  const [view, setView] = useState<AgentView>(EMPTY);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draft = drafts[key] ?? "";
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AgentSettings>(DEFAULT);
  const [trust, setTrust] = useState(false);
  const [providers, setProviders] = useState<AgentAvailability[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [preview, setPreview] = useState<AgentConversation | null>(null);
  const [pinned, setPinned] = useState<{ workId: string | null; focus: AgentFocus } | null>(null);
  const focus = pinned?.workId === workId ? pinned.focus : routeFocus;
  const dock = useRef<HTMLElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const scope = useRef(key);
  scope.current = key;
  const currentFocus = useRef(focus);
  currentFocus.current = focus;
  const isComposing = useRef(false);
  const sending = useRef(false);
  const pendingSend = useRef<{ signature: string; id: string } | null>(null);
  const running = view.turn?.state === "running";
  const refresh = useCallback(async () => {
    const result = await callAgent({ action: "state", workId });
    if (scope.current === key) setView(result as unknown as AgentView);
  }, [workId, key]);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    setView(EMPTY);
    setLoading(true);
    setError("");
    setHistory(null);
    setPreview(null);
    setPinned(null);
    const poll = async () => {
      try {
        const result = (await callAgent({ action: "state", workId })) as unknown as AgentView;
        if (!cancelled) {
          setView(result);
          setLoading(false);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "The agent service is unavailable.");
          setLoading(false);
        }
      }
      if (!cancelled) timer = setTimeout(poll, 1500);
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [workId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll after a newly appended message, without rerunning on every poll.
  useEffect(() => {
    const el = scroll.current;
    if (el && (running || el.scrollHeight - el.scrollTop - el.clientHeight < 180))
      el.scrollTop = el.scrollHeight;
  }, [view.conversation?.messages.length, running]);
  useEffect(() => {
    if (mode !== "expanded") return;
    const previous = document.activeElement;
    const element = dock.current;
    const fields = () =>
      Array.from(
        element?.querySelectorAll<HTMLElement>(
          'button,input,textarea,select,a[href],[tabindex="0"]',
        ) ?? [],
      ).filter((el) => el.getClientRects().length && !el.matches(":disabled"));
    fields()[0]?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setMode("docked");
      }
      if (event.key !== "Tab") return;
      const items = fields(),
        first = items[0],
        last = items.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first || !element?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !element?.contains(document.activeElement))
      ) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [mode]);
  const setDraft = (text: string) => setDrafts((old) => ({ ...old, [key]: text }));
  const ask = (message: string, target?: AgentFocus) => {
    setMode(window.matchMedia("(max-width: 900px)").matches ? "expanded" : "docked");
    setSettingsOpen(false);
    setHistory(null);
    setPreview(null);
    if (target) setPinned({ workId, focus: target });
    setDrafts((old) => ({
      ...old,
      [key]: old[key]?.trim() ? `${old[key]}\n\n${message}` : message,
    }));
    requestAnimationFrame(() => input.current?.focus());
  };
  const openSettings = () => {
    setSettings(view.settings ?? DEFAULT);
    setTrust(false);
    setSettingsOpen(true);
    setHistory(null);
    setPreview(null);
    setError("");
    void callAgent({ action: "providers" })
      .then((result) => setProviders(result.providers as AgentAvailability[]))
      .catch((cause) =>
        setError(
          cause instanceof Error ? cause.message : "Could not check the agent installation.",
        ),
      );
  };
  const connect = async () => {
    setConnecting(true);
    setError("");
    try {
      await callAgent({ action: "verify", settings, trustNative: trust });
      await callAgent({ action: "configure", settings });
      setSettingsOpen(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The connection check failed.");
    } finally {
      setConnecting(false);
    }
  };
  const action = async (name: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    setError("");
    try {
      await callAgent({ action: name, workId, ...extra });
      await refresh();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action could not finish.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    if (
      !draft.trim() ||
      busy ||
      sending.current ||
      running ||
      !view.settings ||
      isComposing.current
    )
      return;
    const message = draft,
      target = { ...currentFocus.current },
      requestScope = key;
    const signature = JSON.stringify([key, message, target]);
    if (pendingSend.current?.signature !== signature)
      pendingSend.current = { signature, id: crypto.randomUUID() };
    const requestId = pendingSend.current.id;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      let id = view.conversation?.id;
      if (!id) {
        const result = await callAgent({ action: "new", workId });
        id = (result.conversation as AgentConversation).id;
      }
      const result = await callAgent({
        action: "send",
        workId,
        conversationId: id,
        message,
        requestId,
        focus: target,
      });
      pendingSend.current = null;
      setDrafts((old) => (old[requestScope] === message ? { ...old, [requestScope]: "" } : old));
      if (scope.current === requestScope) setView(result as unknown as AgentView);
      requestAnimationFrame(() => {
        if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
      });
    } catch (cause) {
      if (scope.current === requestScope)
        setError(
          cause instanceof Error
            ? cause.message
            : "The message could not be sent. Your draft is preserved.",
        );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  const openHistory = async () => {
    setSettingsOpen(false);
    setError("");
    try {
      const result = await callAgent({ action: "history", workId });
      setHistory(result.history as HistoryRow[]);
      setPreview(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "History is unavailable.");
    }
  };
  const chosen = providers.find((row) => row.provider === settings.provider);
  const statusLabel = {
    ready: "Ready to connect",
    "sign-in-required": "Sign in through the official CLI",
    missing: "Install the official CLI",
    unsupported: "CLI version not yet supported",
    unavailable: "Could not check installation",
  };
  return (
    <AgentWorkspaceContext.Provider value={{ ask, openConnection: openSettings }}>
      <div
        className="app-frame agent-workspace"
        data-agent-mode={mode}
        style={{ "--agent-width": `${width}px` } as CSSProperties}
      >
        <div className="workspace-rail" inert={mode === "expanded"}>
          <Sidebar />
        </div>
        <div className="human-workspace" inert={mode === "expanded"}>
          <main className="content">{children}</main>
          {mode === "hidden" && (
            <button type="button" className="agent-restore" onClick={() => setMode("docked")}>
              <Icon name="chat" /> Agent {running ? "· Working" : ""}
            </button>
          )}
          <button type="button" className="agent-mobile-open" onClick={() => setMode("expanded")}>
            <Icon name="chat" /> Agent
          </button>
        </div>
        {mode === "expanded" && (
          <button
            type="button"
            className="agent-backdrop"
            aria-label="Return to workspace"
            onClick={() => setMode("docked")}
          />
        )}
        {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: the expanded dock dynamically becomes an aria-modal dialog. */}
        <aside
          ref={dock}
          className="agent-dock"
          role={mode === "expanded" ? "dialog" : "complementary"}
          aria-modal={mode === "expanded" ? true : undefined}
          aria-label="Toony agent"
          hidden={mode === "hidden"}
        >
          <hr
            className="agent-resize"
            aria-label="Agent panel width"
            aria-orientation="vertical"
            aria-valuemin={320}
            aria-valuemax={520}
            aria-valuenow={width}
            tabIndex={mode === "docked" ? 0 : -1}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                setWidth((w) =>
                  Math.max(320, Math.min(520, w + (event.key === "ArrowLeft" ? 20 : -20))),
                );
              }
            }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                setWidth(Math.max(320, Math.min(520, window.innerWidth - event.clientX)));
            }}
            onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
          />
          <header className="agent-header">
            <div>
              <strong>Toony agent</strong>
              <span>
                {view.settings ? providerName(view.settings.provider) : "Your creative partner"}
              </span>
            </div>
            <div className="agent-header-actions">
              <button
                type="button"
                title="Conversation history"
                aria-label="Conversation history"
                onClick={() => void openHistory()}
              >
                <Icon name="history" />
              </button>
              <button
                type="button"
                title="New conversation"
                aria-label="New conversation"
                disabled={!view.settings || busy || running}
                onClick={() => {
                  setHistory(null);
                  setPreview(null);
                  void action("new");
                }}
              >
                <Icon name="plus" />
              </button>
              <button
                type="button"
                title={mode === "expanded" ? "Restore panel" : "Expand conversation"}
                aria-label={mode === "expanded" ? "Restore agent panel" : "Expand conversation"}
                onClick={() => setMode(mode === "expanded" ? "docked" : "expanded")}
              >
                <Icon name="expand" />
              </button>
              <button
                type="button"
                title="Hide agent"
                aria-label="Hide agent"
                onClick={() => setMode("hidden")}
              >
                <Icon name="close" />
              </button>
            </div>
          </header>
          <div className="agent-conversation" ref={scroll}>
            {settingsOpen ? (
              <section className="agent-setup" aria-label="Agent connection">
                <div className="agent-section-head">
                  <h2>Connect your agent</h2>
                  <button
                    type="button"
                    aria-label="Close connection settings"
                    disabled={connecting}
                    onClick={() => setSettingsOpen(false)}
                  >
                    <Icon name="close" />
                  </button>
                </div>
                <p>Use your own account through the official CLI installed on this computer.</p>
                <div className="agent-provider-options">
                  {(["claude", "codex"] as const).map((provider) => (
                    <button
                      type="button"
                      key={provider}
                      aria-pressed={settings.provider === provider}
                      disabled={connecting}
                      onClick={() => setSettings((s) => ({ ...s, provider, model: "" }))}
                    >
                      <strong>{providerName(provider)}</strong>
                      <span>{provider === "claude" ? "Claude Code" : "Codex CLI"}</span>
                    </button>
                  ))}
                </div>
                <p className="agent-connection-status">
                  {chosen ? statusLabel[chosen.state] : "Checking installed agents…"}
                </p>
                {chosen?.state !== "ready" && (
                  <a
                    className="agent-help-link"
                    href={
                      settings.provider === "claude"
                        ? "https://code.claude.com/docs/en/quickstart"
                        : "https://developers.openai.com/codex/cli"
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open official setup guide ↗
                  </a>
                )}
                <label className="agent-check">
                  <input
                    type="checkbox"
                    checked={settings.projectContext}
                    disabled={connecting}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, projectContext: e.target.checked }))
                    }
                  />
                  <span>
                    Share saved text from the open project
                    <small>
                      Story, characters and selected scene. No image pixels or unsaved edits.
                    </small>
                  </span>
                </label>
                <label className="agent-check">
                  <input
                    type="checkbox"
                    checked={settings.retainHistory}
                    disabled={connecting}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, retainHistory: e.target.checked }))
                    }
                  />
                  <span>
                    Save conversations on this computer
                    <small>
                      Turn off to keep new conversations in memory only. Provider retention is
                      separate.
                    </small>
                  </span>
                </label>
                <details>
                  <summary>Advanced</summary>
                  <label className="agent-model-field">
                    Model
                    <input
                      value={settings.model}
                      disabled={connecting}
                      maxLength={100}
                      placeholder="Use provider default"
                      onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value }))}
                    />
                  </label>
                </details>
                <label className="agent-check agent-native-consent">
                  <input
                    type="checkbox"
                    checked={trust}
                    disabled={connecting}
                    onChange={(e) => setTrust(e.target.checked)}
                  />
                  <span>
                    Use my installed CLI and its account policies.
                    <small>
                      Sign-in stays with the provider. The connection check sends only a greeting.
                    </small>
                  </span>
                </label>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!trust || connecting || chosen?.state !== "ready"}
                  onClick={() => void connect()}
                >
                  {connecting
                    ? "Checking connection…"
                    : `Connect ${providerName(settings.provider)}`}
                </button>
                {view.settings && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={connecting || busy}
                    onClick={() =>
                      void action("disconnect").then((ok) => {
                        if (ok) setSettingsOpen(false);
                      })
                    }
                  >
                    Disconnect from Toony
                  </button>
                )}
              </section>
            ) : history ? (
              <section className="agent-history">
                <div className="agent-section-head">
                  <h2>{preview ? "Saved conversation" : "Conversations"}</h2>
                  <button
                    type="button"
                    onClick={() => {
                      setHistory(null);
                      setPreview(null);
                    }}
                  >
                    Back
                  </button>
                </div>
                {preview ? (
                  <>
                    <div className="agent-messages">
                      {preview.messages.map((m) => (
                        <article key={m.id} className={`agent-message agent-message-${m.role}`}>
                          <span>{m.role === "user" ? "You" : "Toony"}</span>
                          <p>{m.text}</p>
                        </article>
                      ))}
                    </div>
                    {history.find((row) => row.id === preview.id)?.canContinue && (
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={busy || running}
                        onClick={() =>
                          void action("open", { conversationId: preview.id }).then((ok) => {
                            if (ok) {
                              setHistory(null);
                              setPreview(null);
                            }
                          })
                        }
                      >
                        Continue conversation
                      </button>
                    )}
                    <details>
                      <summary>Delete conversation</summary>
                      <p>This removes the local conversation. Your project is unchanged.</p>
                      <button
                        type="button"
                        className="btn btn-danger"
                        disabled={busy || running}
                        onClick={() =>
                          void action("delete", { conversationId: preview.id }).then((ok) => {
                            if (ok) void openHistory();
                          })
                        }
                      >
                        Delete this conversation
                      </button>
                    </details>
                  </>
                ) : history.length ? (
                  history.map((row) => (
                    <button
                      className="agent-history-row"
                      type="button"
                      key={row.id}
                      onClick={() =>
                        void callAgent({ action: "read", workId, conversationId: row.id })
                          .then((result) => setPreview(result.conversation as AgentConversation))
                          .catch(() => setError("This conversation is unavailable."))
                      }
                    >
                      <strong>{row.title}</strong>
                      <span>
                        {providerName(row.provider)} · {row.saved ? "Saved locally" : "In memory"}
                        {row.canContinue ? "" : " · Read only"}
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="agent-empty">
                    <Icon name="history" />
                    <h3>No conversations yet</h3>
                    <p>Conversations you save on this computer will appear here.</p>
                  </div>
                )}
              </section>
            ) : (
              <>
                {!view.conversation?.messages.length && (
                  <div className="agent-welcome">
                    <div className="agent-welcome-mark">
                      <Icon name="chat" />
                    </div>
                    <h2>Your creative partner</h2>
                    <p>
                      Shape your story and characters together. Use the editor to refine every
                      scene.
                    </p>
                    {!view.settings ? (
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={loading}
                        onClick={openSettings}
                      >
                        <StudioIcon name="chat" />{" "}
                        {loading ? "Loading connection…" : "Connect Claude or Codex"}
                      </button>
                    ) : (
                      <div className="agent-starters">
                        <button
                          type="button"
                          onClick={() => ask("Help me develop the story and its central conflict.")}
                        >
                          Develop the story <span>↗</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            ask("Help me strengthen the characters and their motivations.")
                          }
                        >
                          Build the characters <span>↗</span>
                        </button>
                        {focus.cutId && (
                          <button
                            type="button"
                            onClick={() =>
                              ask(
                                "Suggest dialogue for this cut, keeping the character voices consistent.",
                              )
                            }
                          >
                            Explore this scene <span>↗</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <div className="agent-messages" aria-live="polite" aria-relevant="additions text">
                  {view.conversation?.messages.map((message) => (
                    <article
                      key={message.id}
                      className={`agent-message agent-message-${message.role}`}
                    >
                      <span>{message.role === "user" ? "You" : "Toony"}</span>
                      <p>{message.text}</p>
                    </article>
                  ))}
                </div>
                {running && (
                  <p className="agent-working" role="status">
                    Working on your response…
                  </p>
                )}
                {view.turn?.state === "failed" && (
                  <p className="agent-error" role="status">
                    {view.turn.error}
                  </p>
                )}
                {view.turn?.state === "cancelled" && (
                  <p className="agent-muted">Response stopped. Your conversation is preserved.</p>
                )}
              </>
            )}
          </div>
          {error && (
            <div className="agent-error" role="alert">
              {error}
              <button type="button" aria-label="Dismiss agent error" onClick={() => setError("")}>
                <Icon name="close" />
              </button>
            </div>
          )}
          {!view.settings && !settingsOpen && (
            <div className="agent-offline-note">
              <StudioIcon name="chat" />
              <div>
                <strong>Ready when you are</strong>
                <p>
                  Connect your own account to start a conversation. You can keep editing while
                  disconnected.
                </p>
              </div>
            </div>
          )}
          <div className="agent-composer" hidden={settingsOpen || !view.settings || !!history}>
            <div className="agent-context">
              <span title="Only saved text is shared">
                {view.settings?.projectContext && workId
                  ? focus.cutId
                    ? `This cut · ${focus.cutId}`
                    : focus.episodeId
                      ? `This episode · ${focus.episodeId}`
                      : "This project"
                  : "No project context"}
              </span>
              {workId && view.settings?.projectContext && (
                <button
                  type="button"
                  aria-pressed={pinned?.workId === workId}
                  onClick={() =>
                    setPinned(pinned?.workId === workId ? null : { workId, focus: { ...focus } })
                  }
                >
                  {pinned?.workId === workId ? "Unpin" : "Pin"}
                </button>
              )}
            </div>
            <div className="agent-compose-box">
              <textarea
                ref={input}
                aria-label="Message your agent"
                value={draft}
                maxLength={12_000}
                disabled={!view.settings}
                placeholder={
                  view.settings
                    ? "Discuss your story or this scene…"
                    : "Connect your agent to begin"
                }
                rows={3}
                onChange={(event) => setDraft(event.target.value)}
                onCompositionStart={() => {
                  isComposing.current = true;
                }}
                onCompositionEnd={() => {
                  isComposing.current = false;
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing &&
                    event.nativeEvent.keyCode !== 229 &&
                    !isComposing.current
                  ) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="agent-compose-actions">
                <button type="button" className="agent-connection-button" onClick={openSettings}>
                  <span
                    className={view.settings ? "agent-status-dot connected" : "agent-status-dot"}
                  />
                  {view.settings ? providerName(view.settings.provider) : "Connect agent"}
                  <StudioIcon name="chevron" />
                </button>
                {running ? (
                  <button
                    type="button"
                    className="agent-send"
                    aria-label="Stop response"
                    title="Stop response"
                    onClick={() => void action("cancel", { conversationId: view.conversation?.id })}
                  >
                    <StudioIcon name="stop" />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="agent-send"
                    aria-label="Send message"
                    disabled={!view.settings || !draft.trim() || busy}
                    onClick={() => void send()}
                  >
                    <Icon name="send" />
                  </button>
                )}
              </div>
            </div>
            <p className="agent-composer-note">
              {view.settings
                ? "Discuss and plan. Project changes are not applied by chat yet."
                : "Your account. Your project."}
            </p>
          </div>
        </aside>
      </div>
    </AgentWorkspaceContext.Provider>
  );
}
