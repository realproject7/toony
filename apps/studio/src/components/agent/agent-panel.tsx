"use client";

// The agent panel (right side). It owns the conversation state for the work on
// screen: it bootstraps the connection, follows the live feed (`useLiveEvent`)
// through the pure reducer in lib/agent/panel-state.ts, opens the last
// conversation of the current work, and sends every action through
// `POST /api/agent`. Views: setup (not connected), chat, history and memory,
// plus a settings popover in the header.

import { usePathname, useRouter } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  type AgentPanelRequest,
  getAgentFocus,
  subscribeAgentFocus,
} from "@/lib/agent/focus-store";
import { isInternalHref } from "@/lib/agent/markdown";
import {
  canAutoNavigate,
  connectionPreferences,
  focusChipLabel,
  focusForRoute,
  formatElapsed,
  INITIAL_PANEL_STATE,
  labelForHref,
  lastUserText,
  type PanelStatus,
  panelReducer,
  panelScope,
  panelStatus,
  readActionResult,
  routeInfo,
  type Starter,
} from "@/lib/agent/panel-state";
import {
  type AgentFocus,
  type AgentPreferences,
  type AgentProvider,
  type ConversationItem,
  type ConversationSummary,
  DEFAULT_PREFERENCES,
  type LiveEvent,
  type MemoryView,
  type TurnState,
} from "@/lib/agent/protocol";
import { useLiveEvent } from "@/lib/live/provider";
import { callAgent, errorText, newRequestId } from "./agent-api";
import { CopyCommand } from "./cards";
import { Composer } from "./composer";
import { MessageList, type NavHint } from "./message-list";
import { PanelHeader, type PanelMode, SettingsPopover } from "./panel-header";
import { PanelIcon, Spinner } from "./panel-icon";
import { SetupView } from "./setup-view";
import { HistoryView, MemoryPanel, PlanBar } from "./side-views";

type Change = Extract<ConversationItem, { kind: "change" }>;
type Question = Extract<ConversationItem, { kind: "question" }>;
type Proposal = Extract<ConversationItem, { kind: "proposal" }>;

export interface PanelRequest extends AgentPanelRequest {
  nonce: number;
}

export interface AgentPanelProps {
  mode: PanelMode;
  narrow: boolean;
  request: PanelRequest | null;
  onExpand: () => void;
  onCollapse: () => void;
  onHide: () => void;
  /** The person followed a link into the workspace. */
  onInternalNavigate: () => void;
  onStatus: (status: PanelStatus) => void;
}

const NO_FOCUS: AgentFocus = { route: "library" };
const PENDING_TIMEOUT_MS = 20_000;

// The composer's square button stops the turn, so the bar only reports it.
function WorkingBar({ turn }: { turn: TurnState }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const started = Date.parse(turn.startedAt);
  const elapsed = Number.isFinite(started) ? formatElapsed(now - started) : "";
  return (
    <div className="agent-working">
      <Spinner />
      <span className="agent-working-step">{turn.step || "Thinking"}</span>
      <span className="agent-working-time" aria-hidden="true">
        {elapsed}
      </span>
    </div>
  );
}

export function AgentPanel(props: AgentPanelProps) {
  const { mode, narrow, request, onExpand, onCollapse, onHide, onInternalNavigate, onStatus } =
    props;
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const route = routeInfo(pathname);
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const [scope, setScope] = useState<string | null>(() => panelScope(pathname, null));
  useEffect(() => {
    setScope((previous) => panelScope(pathname, previous));
  }, [pathname]);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const [state, dispatch] = useReducer(panelReducer, INITIAL_PANEL_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;
  const reportedFocus = useSyncExternalStore(subscribeAgentFocus, getAgentFocus, () => NO_FOCUS);
  const focus = focusForRoute(route, reportedFocus);
  const focusRef = useRef(focus);
  focusRef.current = focus;

  const [view, setView] = useState<"chat" | "history" | "memory">("chat");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [history, setHistory] = useState<ConversationSummary[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [memory, setMemory] = useState<MemoryView | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [chipRemoved, setChipRemoved] = useState(false);
  const chipRemovedRef = useRef(chipRemoved);
  chipRemovedRef.current = chipRemoved;
  const [hints, setHints] = useState<Array<NavHint & { conversationId: string }>>([]);
  const [scrollSignal, setScrollSignal] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastConversation = useRef(new Map<string, string>());
  const openToken = useRef(0);
  /** Highest navigate event handled, so a replayed one never moves the page twice. */
  const navigateSeq = useRef(0);

  // Drafts live per conversation (or per work before its first message) for the life of the tab.
  const drafts = useRef(new Map<string, string>());
  const draftKey = state.conversation?.id ?? `new:${scope ?? ""}`;
  const draftKeyRef = useRef(draftKey);
  const [draft, setDraftValue] = useState("");
  useEffect(() => {
    draftKeyRef.current = draftKey;
    setDraftValue(drafts.current.get(draftKey) ?? "");
  }, [draftKey]);
  const setDraft = useCallback((text: string) => {
    drafts.current.set(draftKeyRef.current, text);
    setDraftValue(text);
  }, []);

  const preferences = connectionPreferences(state.connection);
  const connected = preferences !== null;
  const provider: AgentProvider | null = preferences?.provider ?? null;
  const conversation = state.conversation;
  const turn = conversation?.turn ?? null;
  const running = turn?.state === "running";
  const status = panelStatus(state.connection, conversation);

  useEffect(() => {
    onStatus(status);
  }, [status, onStatus]);

  const focusComposer = useCallback((atEnd = true) => {
    window.requestAnimationFrame(() => {
      const element = textareaRef.current;
      if (!element || element.disabled) return;
      element.focus();
      if (atEnd) element.setSelectionRange(element.value.length, element.value.length);
    });
  }, []);

  // ---- Connection --------------------------------------------------------

  const bootstrap = useCallback(async () => {
    try {
      const result = readActionResult(await callAgent({ action: "bootstrap" }));
      if (result.connection) dispatch({ type: "connection", connection: result.connection });
      if (result.providers) dispatch({ type: "providers", providers: result.providers });
      setNotice(null);
    } catch (cause) {
      setNotice(errorText(cause, "The agent service is not available."));
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const checkProviders = useCallback(async (refresh: boolean) => {
    setChecking(true);
    try {
      const result = readActionResult(await callAgent({ action: "providers", refresh }));
      if (result.providers) dispatch({ type: "providers", providers: result.providers });
      setSetupError(null);
    } catch (cause) {
      setSetupError(errorText(cause, "Could not look for agents on this computer."));
    } finally {
      setChecking(false);
    }
  }, []);

  const showSetup = state.connection?.status === "disconnected";
  const needProviders = (showSetup || settingsOpen) && state.providers === null;
  useEffect(() => {
    if (needProviders) void checkProviders(false);
  }, [needProviders, checkProviders]);

  const connect = useCallback(
    async (next: AgentPreferences) => {
      setConnecting(true);
      setSetupError(null);
      setPrefsError(null);
      try {
        const result = readActionResult(await callAgent({ action: "connect", preferences: next }));
        if (result.connection) dispatch({ type: "connection", connection: result.connection });
        if (result.providers) dispatch({ type: "providers", providers: result.providers });
        if (result.connection?.status === "needs-attention") {
          setSetupError(result.connection.message);
        } else {
          setView("chat");
          setSettingsOpen(false);
          focusComposer();
        }
      } catch (cause) {
        const message = errorText(cause, "Could not connect. Check again, then retry.");
        setSetupError(message);
        setPrefsError(message);
      } finally {
        setConnecting(false);
      }
    },
    [focusComposer],
  );

  const savePreferences = useCallback(async (next: AgentPreferences) => {
    setSavingPrefs(true);
    setPrefsError(null);
    try {
      const result = readActionResult(
        await callAgent({ action: "preferences", preferences: next }),
      );
      const current = stateRef.current.connection;
      if (result.connection) dispatch({ type: "connection", connection: result.connection });
      else if (current && current.status !== "disconnected")
        dispatch({ type: "connection", connection: { ...current, preferences: next } });
    } catch (cause) {
      setPrefsError(errorText(cause, "That setting was not saved."));
    } finally {
      setSavingPrefs(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    setSettingsOpen(false);
    try {
      const result = readActionResult(await callAgent({ action: "disconnect" }));
      dispatch({ type: "connection", connection: result.connection ?? { status: "disconnected" } });
      dispatch({ type: "view", view: null });
      setView("chat");
      void checkProviders(false);
    } catch (cause) {
      setNotice(errorText(cause, "Could not disconnect. Try again."));
    }
  }, [checkProviders]);

  // ---- Conversation for the work on screen -------------------------------

  const openConversation = useCallback(async (workId: string | null, conversationId?: string) => {
    const token = ++openToken.current;
    try {
      const result = readActionResult(
        await callAgent({ action: "open", workId, ...(conversationId ? { conversationId } : {}) }),
      );
      if (token !== openToken.current) return null;
      dispatch({ type: "view", view: result.view ?? null });
      return result.view ?? null;
    } catch (cause) {
      if (token === openToken.current)
        setNotice(errorText(cause, "Could not open the conversation."));
      return null;
    }
  }, []);

  useEffect(() => {
    if (!connected) return;
    const current = stateRef.current.conversation;
    // A conversation that already belongs here (for example one the agent just
    // moved to its new work) stays open.
    if (current && (current.workId ?? null) === scope) return;
    void openConversation(scope, lastConversation.current.get(scope ?? ""));
    setView((value) => (value === "memory" || value === "history" ? "chat" : value));
    setHistory(null);
    setMemory(null);
  }, [scope, connected, openConversation]);

  useEffect(() => {
    if (conversation) lastConversation.current.set(conversation.workId ?? "", conversation.id);
  }, [conversation]);

  useEffect(() => {
    if (!state.stale) return;
    dispatch({ type: "refreshed" });
    const current = stateRef.current.conversation;
    if (current) void openConversation(current.workId, current.id);
  }, [state.stale, openConversation]);

  // ---- Live feed ---------------------------------------------------------

  const handleNavigate = useCallback(
    (event: Extract<LiveEvent, { type: "navigate" }>) => {
      const current = stateRef.current;
      if (event.seq <= current.lastSeq || event.seq <= navigateSeq.current) return;
      navigateSeq.current = event.seq;
      const open = current.conversation;
      if (!open || open.id !== event.conversationId || !isInternalHref(event.href)) return;
      const target = routeInfo(event.href);
      if (event.reason === "work-created" && target.workId) {
        // The conversation follows the agent into the work it created.
        lastConversation.current.set(target.workId, open.id);
      }
      if (pathRef.current === event.href) return;
      if (canAutoNavigate(pathRef.current)) {
        router.push(event.href);
        return;
      }
      setHints((list) => [
        ...list,
        {
          key: `navigate-${event.seq}`,
          conversationId: open.id,
          turnId: open.turn?.id ?? null,
          href: event.href,
          label: labelForHref(event.href),
        },
      ]);
    },
    [router],
  );

  useLiveEvent(
    (event) => event.type !== "ping" && event.type !== "project" && event.type !== "export",
    (event) => {
      if (event.type === "hello" && event.serverId !== stateRef.current.serverId)
        navigateSeq.current = 0;
      if (event.type === "navigate") handleNavigate(event);
      if (event.type === "rebind") {
        const open = stateRef.current.conversation;
        if (open && open.id === event.conversationId && event.seq > stateRef.current.lastSeq)
          lastConversation.current.set(event.workId, open.id);
      }
      dispatch({ type: "live", event });
    },
  );

  // ---- Messages ----------------------------------------------------------

  const send = useCallback(
    async (raw: string, fromDraft: boolean) => {
      const text = raw.trim();
      const current = stateRef.current;
      if (!text || sendingRef.current) return;
      if (current.conversation?.turn?.state === "running") return;
      if (!connectionPreferences(current.connection)) return;
      sendingRef.current = true;
      setSending(true);
      setNotice(null);
      if (fromDraft) setDraft("");
      const requestId = newRequestId();
      const focusToSend = chipRemovedRef.current ? undefined : focusRef.current;
      let conversationId = current.conversation?.id ?? null;
      try {
        if (!conversationId) {
          const created = readActionResult(
            await callAgent({ action: "new", workId: scopeRef.current }),
          );
          if (!created.view) throw new Error("Could not start a conversation. Try again.");
          dispatch({ type: "view", view: created.view });
          conversationId = created.view.id;
        }
        dispatch({
          type: "pending",
          message: { requestId, conversationId, text, at: new Date().toISOString() },
        });
        setScrollSignal((value) => value + 1);
        const result = readActionResult(
          await callAgent({
            action: "send",
            conversationId,
            requestId,
            text,
            ...(focusToSend ? { focus: focusToSend } : {}),
          }),
        );
        if (result.view) dispatch({ type: "view", view: result.view });
        window.setTimeout(() => dispatch({ type: "pending-done", requestId }), PENDING_TIMEOUT_MS);
        setChipRemoved(false);
      } catch (cause) {
        dispatch({ type: "pending-done", requestId });
        if (fromDraft && !(drafts.current.get(draftKeyRef.current) ?? "").trim()) setDraft(raw);
        setNotice(errorText(cause, "Your message was not sent. It is back in the box."));
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [setDraft],
  );

  const stop = useCallback(async () => {
    const open = stateRef.current.conversation;
    if (!open) return;
    try {
      await callAgent({ action: "cancel", conversationId: open.id });
    } catch (cause) {
      setNotice(errorText(cause, "Could not stop the agent."));
    }
  }, []);

  const answer = useCallback(async (item: Question, choices: string[], other?: string) => {
    const open = stateRef.current.conversation;
    if (!open) return;
    const at = new Date().toISOString();
    dispatch({
      type: "item",
      conversationId: open.id,
      item: { ...item, answer: { choices, ...(other ? { other } : {}), at } },
    });
    try {
      const result = readActionResult(
        await callAgent({
          action: "answer",
          conversationId: open.id,
          questionId: item.questionId,
          requestId: newRequestId(),
          choices,
          ...(other ? { other } : {}),
        }),
      );
      if (result.view) dispatch({ type: "view", view: result.view });
      setScrollSignal((value) => value + 1);
    } catch (cause) {
      dispatch({ type: "item", conversationId: open.id, item });
      throw cause;
    }
  }, []);

  const decide = useCallback(async (item: Proposal, decision: "apply" | "dismiss") => {
    const open = stateRef.current.conversation;
    if (!open) return;
    const result = readActionResult(
      await callAgent({
        action: "proposal",
        conversationId: open.id,
        proposalId: item.proposalId,
        decision,
      }),
    );
    if (result.view) dispatch({ type: "view", view: result.view });
  }, []);

  const undo = useCallback(async (item: Change) => {
    const open = stateRef.current.conversation;
    if (!open) return;
    const result = readActionResult(
      await callAgent({ action: "undo", conversationId: open.id, changeId: item.changeId }),
    );
    if (result.view) dispatch({ type: "view", view: result.view });
    else dispatch({ type: "item", conversationId: open.id, item: { ...item, undone: true } });
  }, []);

  const retry = useCallback(() => {
    const open = stateRef.current.conversation;
    const text = open ? lastUserText(open.items) : null;
    if (text) void send(text, false);
  }, [send]);

  const startStarter = useCallback(
    (starter: Starter) => {
      if (starter.send) {
        void send(starter.text, false);
        return;
      }
      setDraft(starter.text);
      focusComposer();
    },
    [send, setDraft, focusComposer],
  );

  // ---- History and memory ------------------------------------------------

  const newChat = useCallback(() => {
    setSettingsOpen(false);
    setView("chat");
    lastConversation.current.delete(scopeRef.current ?? "");
    openToken.current += 1;
    dispatch({ type: "view", view: null });
    focusComposer();
  }, [focusComposer]);

  const openHistory = useCallback(async () => {
    setSettingsOpen(false);
    setView("history");
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const result = readActionResult(
        await callAgent({ action: "history", workId: scopeRef.current }),
      );
      setHistory(result.conversations ?? []);
    } catch (cause) {
      setHistoryError(errorText(cause, "Could not load your conversations."));
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const pickConversation = useCallback(
    async (id: string) => {
      const opened = await openConversation(scopeRef.current, id);
      if (opened) {
        setView("chat");
        focusComposer();
      }
    },
    [openConversation, focusComposer],
  );

  const deleteConversation = useCallback(async (id: string) => {
    try {
      await callAgent({ action: "delete", conversationId: id });
      if (stateRef.current.conversation?.id === id) dispatch({ type: "view", view: null });
      for (const [key, value] of lastConversation.current) {
        if (value === id) lastConversation.current.delete(key);
      }
      setHistory((rows) => rows?.filter((row) => row.id !== id) ?? null);
    } catch (cause) {
      setHistoryError(errorText(cause, "Could not delete that conversation."));
    }
  }, []);

  const openMemory = useCallback(async () => {
    setSettingsOpen(false);
    setView("memory");
    setMemoryError(null);
    const workId = scopeRef.current;
    if (!workId) return;
    setMemoryLoading(true);
    try {
      const result = readActionResult(await callAgent({ action: "memory", workId }));
      setMemory(result.memory ?? { notes: [], tasks: [], journal: [] });
    } catch (cause) {
      setMemoryError(errorText(cause, "Could not load what the agent remembers."));
    } finally {
      setMemoryLoading(false);
    }
  }, []);

  const forget = useCallback(async (noteId: string) => {
    const workId = scopeRef.current;
    if (!workId) return;
    try {
      const result = readActionResult(await callAgent({ action: "forget", workId, noteId }));
      setMemory(
        (current) =>
          result.memory ??
          (current
            ? { ...current, notes: current.notes.filter((note) => note.id !== noteId) }
            : null),
      );
    } catch (cause) {
      setMemoryError(errorText(cause, "Could not forget that note."));
    }
  }, []);

  // ---- Requests from the workspace (openAgentPanel) ----------------------

  // biome-ignore lint/correctness/useExhaustiveDependencies: run once per request, identified by its nonce.
  useEffect(() => {
    if (!request) return;
    const isConnected = connectionPreferences(stateRef.current.connection) !== null;
    if (request.view === "history" && isConnected) void openHistory();
    else if ((request.view === "settings" || request.view === "setup") && isConnected) {
      setView("chat");
      setSettingsOpen(true);
    } else {
      setView("chat");
      setSettingsOpen(false);
    }
    if (request.prefill) {
      const existing = drafts.current.get(draftKeyRef.current) ?? "";
      setDraft(existing.trim() ? `${existing}\n\n${request.prefill}` : request.prefill);
    }
    if (request.view === "chat" || request.prefill) focusComposer();
  }, [request?.nonce]);

  // ---- Context chip ------------------------------------------------------

  const chip = focusChipLabel(focus);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new focus brings the chip back.
  useEffect(() => {
    setChipRemoved(false);
  }, [chip]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: hints belong to the conversation they came from.
  useEffect(() => {
    setHints((list) => (list.length ? [] : list));
  }, [conversation?.id]);

  const navigateFromPanel = useCallback(() => {
    setSettingsOpen(false);
    onInternalNavigate();
  }, [onInternalNavigate]);

  // ---- Render ------------------------------------------------------------

  const attention = state.connection?.status === "needs-attention" ? state.connection : null;
  const composerHint = running
    ? "Write your next message"
    : route.kind === "library"
      ? "Describe your story, or ask anything"
      : "Ask for a change, a plan or a review";

  let body: ReactNode;
  if (state.connection === null) {
    body = (
      <div className="agent-loading">
        {notice ? (
          <>
            <p className="agent-card-error" role="alert">
              {notice}
            </p>
            <button
              type="button"
              className="btn btn-ghost agent-small-button"
              onClick={() => void bootstrap()}
            >
              Try again
            </button>
          </>
        ) : (
          <p>
            <Spinner /> Checking your agent
          </p>
        )}
      </div>
    );
  } else if (showSetup) {
    body = (
      <div className="agent-body-scroll">
        <SetupView
          providers={state.providers}
          checking={checking}
          connecting={connecting}
          error={setupError}
          onCheck={() => void checkProviders(true)}
          onConnect={(chosen, model) =>
            void connect({ ...DEFAULT_PREFERENCES, provider: chosen, model })
          }
        />
      </div>
    );
  } else if (view === "history") {
    body = (
      <div className="agent-body-scroll">
        <HistoryView
          conversations={history}
          currentId={conversation?.id ?? null}
          loading={historyLoading}
          error={historyError}
          onBack={() => setView("chat")}
          onOpen={(id) => void pickConversation(id)}
          onDelete={deleteConversation}
        />
      </div>
    );
  } else if (view === "memory") {
    body = (
      <div className="agent-body-scroll">
        <MemoryPanel
          memory={memory}
          hasWork={scope !== null}
          loading={memoryLoading}
          error={memoryError}
          onBack={() => setView("chat")}
          onForget={forget}
        />
      </div>
    );
  } else {
    body = (
      <MessageList
        conversation={conversation}
        pending={state.pending}
        provider={provider}
        routeKind={route.kind}
        hints={hints.filter((hint) => hint.conversationId === conversation?.id)}
        scrollSignal={scrollSignal}
        onNavigate={navigateFromPanel}
        onStarter={startStarter}
        onUndo={undo}
        onAnswer={answer}
        onDecide={decide}
        onRetry={retry}
        onSettings={() => setSettingsOpen(true)}
      />
    );
  }

  const inChat = connected && view === "chat";

  return (
    <div className="agent-panel">
      <PanelHeader
        provider={provider}
        status={status}
        mode={mode}
        narrow={narrow}
        connected={connected}
        canStartChat={connected && !running && (conversation !== null || view !== "chat")}
        settingsOpen={settingsOpen && connected}
        onSettingsOpen={setSettingsOpen}
        onNewChat={newChat}
        onHistory={() => void openHistory()}
        onExpand={onExpand}
        onCollapse={onCollapse}
        onHide={onHide}
        settings={
          preferences ? (
            <SettingsPopover
              preferences={preferences}
              providers={state.providers}
              saving={savingPrefs || connecting}
              error={prefsError}
              onChange={(next) => void savePreferences(next)}
              onSwitchProvider={(next) =>
                void connect({ ...preferences, provider: next, model: "" })
              }
              onMemory={() => void openMemory()}
              onDisconnect={() => void disconnect()}
            />
          ) : null
        }
      />
      {attention && (
        <div className="agent-attention" role="alert">
          <p>
            <PanelIcon name="alert" />
            <span>{attention.message}</span>
          </p>
          {attention.command && <CopyCommand command={attention.command} />}
          <div className="agent-card-actions">
            <button
              type="button"
              className="btn btn-ghost agent-small-button"
              disabled={connecting}
              onClick={() => void connect(attention.preferences)}
            >
              {connecting ? <Spinner /> : <PanelIcon name="refresh" />} Check again
            </button>
          </div>
        </div>
      )}
      {inChat && conversation && <PlanBar tasks={conversation.tasks} />}
      <div className="agent-body">{body}</div>
      {inChat && (
        <div className="agent-footer">
          {running && turn && <WorkingBar turn={turn} />}
          {notice && (
            <div className="agent-error-bar" role="alert">
              <span>{notice}</span>
              <button
                type="button"
                className="agent-icon-button"
                aria-label="Dismiss"
                onClick={() => setNotice(null)}
              >
                <PanelIcon name="close" />
              </button>
            </div>
          )}
          <Composer
            draft={draft}
            onDraft={setDraft}
            chip={chip}
            chipRemoved={chipRemoved}
            onToggleChip={() => setChipRemoved((value) => !value)}
            disabled={!connected}
            running={running}
            sending={sending}
            hint={composerHint}
            textareaRef={textareaRef}
            onSend={() => void send(draft, true)}
            onStop={() => void stop()}
          />
        </div>
      )}
    </div>
  );
}
