"use client";

// The conversation: the person's messages, the agent's replies (Markdown),
// activity grouped per turn, cards, the streaming draft of the running turn,
// and the greeting with starters while the conversation is empty. It follows
// new content only while the reader is at the bottom; otherwise it offers
// "Jump to latest".

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  focusChipLabel,
  groupItems,
  type PendingMessage,
  type RouteKind,
  type Starter,
  startersFor,
} from "@/lib/agent/panel-state";
import type {
  AgentProvider,
  AgentTarget,
  ConversationItem,
  ConversationView,
} from "@/lib/agent/protocol";
import {
  ActivityGroup,
  ChangeCard,
  NoticeCard,
  ProposalCard,
  QuestionCard,
  TargetLinks,
} from "./cards";
import { MarkdownView } from "./markdown-view";
import { AgentMark, PanelIcon } from "./panel-icon";

type Change = Extract<ConversationItem, { kind: "change" }>;
type Question = Extract<ConversationItem, { kind: "question" }>;
type Proposal = Extract<ConversationItem, { kind: "proposal" }>;

/** A place the agent wanted to show that the panel did not open on its own. */
export interface NavHint {
  key: string;
  turnId: string | null;
  href: string;
  label: string;
}

export interface MessageListProps {
  conversation: ConversationView | null;
  pending: PendingMessage[];
  provider: AgentProvider | null;
  routeKind: RouteKind;
  hints: NavHint[];
  /** Increment to scroll to the newest message, for example after sending. */
  scrollSignal: number;
  onNavigate: () => void;
  onStarter: (starter: Starter) => void;
  onUndo: (item: Change) => Promise<void>;
  onAnswer: (item: Question, choices: string[], other?: string) => Promise<void>;
  onDecide: (item: Proposal, decision: "apply" | "dismiss") => Promise<void>;
  onRetry: () => void;
  onSettings: () => void;
}

const FOLLOW_DISTANCE = 80;

function hintTarget(hint: NavHint): AgentTarget {
  return { type: "episode", workId: "", label: hint.label, href: hint.href };
}

function greetingFor(kind: RouteKind): { title: string; body: string } {
  switch (kind) {
    case "library":
    case "settings":
    case "other":
      return {
        title: "What should we make?",
        body: "Tell me about your story. I will set up the webtoon, its characters and the first episode, and draw it while you watch.",
      };
    case "story":
    case "characters":
    case "episodes":
      return {
        title: "What's next for this story?",
        body: "Ask me to plan, write or revise. Changes show up on the left as I make them.",
      };
    default:
      return {
        title: "Working on this episode?",
        body: "I can edit cuts, dialogue and transitions. You keep the final say on lettering.",
      };
  }
}

export function MessageList(props: MessageListProps) {
  const {
    conversation,
    pending,
    provider,
    routeKind,
    hints,
    scrollSignal,
    onNavigate,
    onStarter,
    onUndo,
    onAnswer,
    onDecide,
    onRetry,
    onSettings,
  } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const items = conversation?.items ?? [];
  const turn = conversation?.turn ?? null;
  const running = turn?.state === "running";
  const ownPending = pending.filter((message) => message.conversationId === conversation?.id);
  const blocks = useMemo(() => groupItems(items), [items]);

  const { extraTargets, looseHints } = useMemo(() => {
    const extra = new Map<string, AgentTarget[]>();
    const loose: NavHint[] = [];
    for (const hint of hints) {
      let change: Change | undefined;
      for (let i = items.length - 1; i >= 0; i -= 1) {
        const item = items[i];
        if (item?.kind === "change" && (hint.turnId === null || item.turnId === hint.turnId)) {
          change = item;
          break;
        }
      }
      if (!change) {
        loose.push(hint);
        continue;
      }
      if (change.targets.some((target) => target.href === hint.href)) continue;
      extra.set(change.id, [...(extra.get(change.id) ?? []), hintTarget(hint)]);
    }
    return { extraTargets: extra, looseHints: loose };
  }, [hints, items]);

  const scrollToEnd = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    atBottom.current = true;
    setShowJump(false);
  }, []);

  const lastItem = items[items.length - 1];
  const signature = `${conversation?.id}|${items.length}|${lastItem?.id}|${JSON.stringify(lastItem ?? null).length}|${turn?.draft?.length ?? 0}|${turn?.state}|${ownPending.length}|${looseHints.length}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow new content, keyed by a compact signature of what changed.
  useLayoutEffect(() => {
    if (atBottom.current) scrollToEnd();
    else setShowJump(true);
  }, [signature]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new conversation or an explicit request starts at the newest message.
  useEffect(() => {
    scrollToEnd();
  }, [conversation?.id, scrollSignal]);

  // Stay pinned to the newest message when the list area changes size
  // (composer growing, a banner appearing) while the reader is at the bottom.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (atBottom.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const onScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    atBottom.current = distance < FOLLOW_DISTANCE;
    if (atBottom.current) setShowJump(false);
  };

  const empty = items.length === 0 && ownPending.length === 0;
  const greeting = greetingFor(routeKind);
  let noticeAfterUser = false;
  for (let i = items.length - 1; i >= 0 && items[i]?.kind !== "user"; i -= 1) {
    if (items[i]?.kind === "notice") noticeAfterUser = true;
  }

  return (
    <div className="agent-scroll-wrap">
      <div className="agent-scroll" ref={scrollRef} onScroll={onScroll}>
        {empty ? (
          <section className="agent-greeting" aria-labelledby="agent-greeting-title">
            <AgentMark provider={provider} size="lg" />
            <h2 id="agent-greeting-title">{greeting.title}</h2>
            <p>{greeting.body}</p>
            <div className="agent-starters">
              {startersFor(routeKind).map((starter) => (
                <button
                  key={starter.label}
                  type="button"
                  className="agent-starter"
                  onClick={() => onStarter(starter)}
                >
                  <span>{starter.label}</span>
                  <PanelIcon name={starter.send ? "send" : "arrow"} />
                </button>
              ))}
            </div>
          </section>
        ) : (
          <div
            className="agent-log"
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            aria-label="Conversation"
          >
            {blocks.map((block) => {
              if (block.kind === "activity") {
                return (
                  <ActivityGroup key={block.key} items={block.items} onNavigate={onNavigate} />
                );
              }
              const item = block.item;
              switch (item.kind) {
                case "user": {
                  const context = focusChipLabel(item.focus);
                  return (
                    <div key={item.id} className="agent-user">
                      <p>{item.text}</p>
                      {context && <span className="agent-user-context">{context}</span>}
                    </div>
                  );
                }
                case "assistant":
                  return (
                    <div key={item.id} className="agent-reply">
                      <MarkdownView text={item.text} onNavigate={onNavigate} />
                    </div>
                  );
                case "activity":
                  return null;
                case "change":
                  return (
                    <ChangeCard
                      key={item.id}
                      item={item}
                      extraTargets={extraTargets.get(item.id) ?? []}
                      onNavigate={onNavigate}
                      onUndo={onUndo}
                    />
                  );
                case "question":
                  return (
                    <QuestionCard
                      key={item.id}
                      item={item}
                      disabled={running}
                      onAnswer={onAnswer}
                    />
                  );
                case "proposal":
                  return (
                    <ProposalCard
                      key={item.id}
                      item={item}
                      onNavigate={onNavigate}
                      onDecide={onDecide}
                    />
                  );
                case "notice":
                  return (
                    <NoticeCard
                      key={item.id}
                      item={item}
                      canRetry={!running}
                      onRetry={onRetry}
                      onSettings={onSettings}
                    />
                  );
              }
              return null;
            })}
            {ownPending.map((message) => (
              <div key={message.requestId} className="agent-user" data-pending="true">
                <p>{message.text}</p>
                <span className="agent-user-context">Sending</span>
              </div>
            ))}
            {looseHints.map((hint) => (
              <div key={hint.key} className="agent-card agent-hint">
                <p className="agent-card-text">{hint.label} is ready.</p>
                <TargetLinks targets={[hintTarget(hint)]} onNavigate={onNavigate} />
              </div>
            ))}
            {turn?.state === "failed" && !noticeAfterUser && (
              <NoticeCard
                item={{
                  tone: "error",
                  text: turn.error?.message ?? "The agent stopped before it finished.",
                  action: "retry",
                }}
                canRetry
                onRetry={onRetry}
                onSettings={onSettings}
              />
            )}
            {turn?.state === "cancelled" && (
              <p className="agent-stopped">Stopped. Your conversation is kept.</p>
            )}
          </div>
        )}
        {running && turn?.draft && (
          <div className="agent-reply agent-draft" aria-hidden="true">
            <MarkdownView text={turn.draft} />
          </div>
        )}
      </div>
      {showJump && (
        <button type="button" className="agent-jump" onClick={scrollToEnd}>
          <PanelIcon name="chevron" /> Jump to latest
        </button>
      )}
    </div>
  );
}
