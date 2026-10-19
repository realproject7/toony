"use client";

// The panel's conversation cards: activity rows (grouped per turn), change
// cards with Open and Undo, question cards (single or multiple choice, Other),
// proposal cards (before/after, Apply or Dismiss) and notices (sign-in command
// with Copy, Retry, Settings). Each card calls back into the panel; it never
// talks to the server itself.

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { isInternalHref } from "@/lib/agent/markdown";
import type { AgentTarget, ConversationItem } from "@/lib/agent/protocol";
import { errorText } from "./agent-api";
import { PanelIcon, Spinner } from "./panel-icon";

type Activity = Extract<ConversationItem, { kind: "activity" }>;
type Change = Extract<ConversationItem, { kind: "change" }>;
type Question = Extract<ConversationItem, { kind: "question" }>;
type Proposal = Extract<ConversationItem, { kind: "proposal" }>;
type Notice = Extract<ConversationItem, { kind: "notice" }>;

export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState<"idle" | "copied" | "select">("idle");
  const codeRef = useRef<HTMLElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied("copied");
    } catch {
      // Clipboard access can be refused; select the text so Cmd/Ctrl+C works.
      const node = codeRef.current;
      const selection = window.getSelection();
      if (node && selection) {
        const range = document.createRange();
        range.selectNodeContents(node);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      setCopied("select");
    }
    window.setTimeout(() => setCopied("idle"), 2400);
  };
  return (
    <div className="agent-command">
      <code ref={codeRef}>{command}</code>
      <button type="button" className="agent-text-button" onClick={() => void copy()}>
        <PanelIcon name={copied === "copied" ? "check" : "copy"} />
        {copied === "copied" ? "Copied" : copied === "select" ? "Selected" : "Copy"}
      </button>
    </div>
  );
}

export function TargetLinks({
  targets,
  onNavigate,
}: {
  targets: AgentTarget[];
  onNavigate: () => void;
}) {
  // Targets come from the server, but a link only ever opens a Toony page.
  const safe = targets.filter((target) => isInternalHref(target.href));
  if (safe.length === 0) return null;
  return (
    <div className="agent-targets">
      {safe.map((target) => (
        <Link
          key={`${target.type}:${target.href}`}
          href={target.href}
          className="agent-open-link"
          onClick={onNavigate}
        >
          Open {target.label}
          <PanelIcon name="arrow" />
        </Link>
      ))}
    </div>
  );
}

function ActivityRow({ item, onNavigate }: { item: Activity; onNavigate: () => void }) {
  return (
    <li className="agent-activity-row" data-status={item.status}>
      <span className="agent-activity-icon">
        {item.status === "running" ? (
          <Spinner label="Running" />
        ) : item.status === "failed" ? (
          <PanelIcon name="alert" />
        ) : (
          <PanelIcon name="check" />
        )}
      </span>
      <span className="agent-activity-text">
        <span className="agent-activity-title">{item.title}</span>
        {item.detail &&
          (item.status === "failed" ? (
            // A refused step is usually fixed by the agent on its next try; the
            // exact reason stays one click away instead of filling the chat.
            <details className="agent-activity-why">
              <summary>Why</summary>
              <span className="agent-activity-detail">{item.detail}</span>
            </details>
          ) : (
            <span className="agent-activity-detail">{item.detail}</span>
          ))}
        {item.targets && item.targets.length > 0 && (
          <TargetLinks targets={item.targets} onNavigate={onNavigate} />
        )}
      </span>
    </li>
  );
}

const COLLAPSE_AFTER = 4;

export function ActivityGroup({
  items,
  onNavigate,
}: {
  items: Activity[];
  onNavigate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const running = items.some((item) => item.status === "running");
  const collapsible = items.length > COLLAPSE_AFTER && !running;
  const shown = collapsible && !open ? items.slice(-2) : items;
  const hidden = items.length - shown.length;
  return (
    <div className="agent-activity">
      {collapsible && (
        <button
          type="button"
          className="agent-activity-toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <PanelIcon name="chevron" />
          {open ? "Show fewer steps" : `${hidden} earlier ${hidden === 1 ? "step" : "steps"}`}
        </button>
      )}
      <ul>
        {shown.map((item) => (
          <ActivityRow key={item.id} item={item} onNavigate={onNavigate} />
        ))}
      </ul>
    </div>
  );
}

export function ChangeCard({
  item,
  extraTargets,
  onNavigate,
  onUndo,
}: {
  item: Change;
  extraTargets: AgentTarget[];
  onNavigate: () => void;
  onUndo: (item: Change) => Promise<void>;
}) {
  const [state, setState] = useState<"idle" | "working">("idle");
  const [error, setError] = useState<string | null>(null);
  const targets = [
    ...item.targets,
    ...extraTargets.filter((extra) => !item.targets.some((target) => target.href === extra.href)),
  ];
  const undo = async () => {
    setState("working");
    setError(null);
    try {
      await onUndo(item);
    } catch (cause) {
      setError(errorText(cause, "This change could not be undone."));
    } finally {
      setState("idle");
    }
  };
  return (
    <div className="agent-card agent-change" data-undone={item.undone ? "true" : undefined}>
      <div className="agent-card-head">
        <span className="agent-card-icon">
          <PanelIcon name={item.undone ? "undo" : "check"} />
        </span>
        <p className="agent-card-title">{item.summary}</p>
        {item.undone ? (
          <span className="agent-badge">Undone</span>
        ) : item.undoable ? (
          <button
            type="button"
            className="agent-text-button"
            disabled={state === "working"}
            onClick={() => void undo()}
          >
            {state === "working" ? <Spinner /> : <PanelIcon name="undo" />}
            {state === "working" ? "Undoing" : "Undo"}
          </button>
        ) : null}
      </div>
      {!item.undone && <TargetLinks targets={targets} onNavigate={onNavigate} />}
      {error && (
        <p className="agent-card-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function QuestionCard({
  item,
  disabled,
  onAnswer,
}: {
  item: Question;
  disabled: boolean;
  onAnswer: (item: Question, choices: string[], other?: string) => Promise<void>;
}) {
  const id = useId();
  const [picked, setPicked] = useState<string[]>([]);
  const [otherOpen, setOtherOpen] = useState(false);
  const [other, setOther] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (item.answer) {
    const chosen = [...item.answer.choices];
    if (item.answer.other) chosen.push(item.answer.other);
    return (
      <div className="agent-card agent-question" data-answered="true">
        <p className="agent-question-prompt">{item.prompt}</p>
        <p className="agent-question-answer">
          <PanelIcon name="check" />
          <span>{chosen.join(", ") || "Answered"}</span>
        </p>
      </div>
    );
  }

  const submit = async (choices: string[], otherText?: string) => {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      await onAnswer(item, choices, otherText?.trim() ? otherText.trim() : undefined);
    } catch (cause) {
      setError(errorText(cause, "Your answer could not be sent. Try again."));
    } finally {
      setSending(false);
    }
  };
  const canSubmit =
    !disabled && !sending && (picked.length > 0 || (otherOpen && other.trim().length > 0));

  return (
    <fieldset className="agent-card agent-question" disabled={disabled || sending}>
      <legend className="agent-question-legend">
        {item.header && <span className="agent-question-header">{item.header}</span>}
        <span className="agent-question-prompt">{item.prompt}</span>
      </legend>
      <div className="agent-options" data-multi={item.multiSelect ? "true" : undefined}>
        {item.options.map((option) =>
          item.multiSelect ? (
            <label key={option.label} className="agent-option agent-option-check">
              <input
                type="checkbox"
                checked={picked.includes(option.label)}
                onChange={(event) =>
                  setPicked((current) =>
                    event.target.checked
                      ? [...current, option.label]
                      : current.filter((label) => label !== option.label),
                  )
                }
              />
              <span>
                <strong>{option.label}</strong>
                {option.description && <small>{option.description}</small>}
              </span>
            </label>
          ) : (
            <button
              key={option.label}
              type="button"
              className="agent-option"
              onClick={() => void submit([option.label])}
            >
              <strong>{option.label}</strong>
              {option.description && <small>{option.description}</small>}
            </button>
          ),
        )}
        {item.allowOther && !otherOpen && (
          <button
            type="button"
            className="agent-option agent-option-other"
            onClick={() => setOtherOpen(true)}
          >
            <strong>Other</strong>
            <small>Write your own answer</small>
          </button>
        )}
      </div>
      {item.allowOther && otherOpen && (
        <div className="agent-other">
          <label htmlFor={`${id}-other`}>Your answer</label>
          <textarea
            id={`${id}-other`}
            rows={2}
            maxLength={2000}
            value={other}
            // biome-ignore lint/a11y/noAutofocus: the person just asked to write an answer.
            autoFocus
            onChange={(event) => setOther(event.target.value)}
          />
        </div>
      )}
      {(item.multiSelect || otherOpen) && (
        <div className="agent-card-actions">
          <button
            type="button"
            className="btn btn-primary agent-small-button"
            disabled={!canSubmit}
            onClick={() =>
              void submit(item.multiSelect ? picked : [], otherOpen ? other : undefined)
            }
          >
            {sending ? "Sending" : "Submit"}
          </button>
        </div>
      )}
      {error && (
        <p className="agent-card-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}

function LetteringLines({ lines }: { lines: Array<{ speaker: string; text: string }> }) {
  if (lines.length === 0) return <p className="agent-preview-empty">No lettering</p>;
  return (
    <ul className="agent-preview-lines">
      {lines.map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: preview lines are positional.
        <li key={index}>
          {line.speaker && <span className="agent-preview-speaker">{line.speaker}</span>}
          <span>{line.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function ProposalCard({
  item,
  onNavigate,
  onDecide,
}: {
  item: Proposal;
  onNavigate: () => void;
  onDecide: (item: Proposal, decision: "apply" | "dismiss") => Promise<void>;
}) {
  const [working, setWorking] = useState<"apply" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const decide = async (decision: "apply" | "dismiss") => {
    setWorking(decision);
    setError(null);
    try {
      await onDecide(item, decision);
    } catch (cause) {
      setError(errorText(cause, "That did not work. Try again."));
    } finally {
      setWorking(null);
    }
  };
  const resolved = item.state !== "pending";
  return (
    <div className="agent-card agent-proposal" data-state={item.state}>
      <div className="agent-card-head">
        <span className="agent-card-icon">
          <PanelIcon name={item.state === "applied" ? "check" : "sparkle"} />
        </span>
        <p className="agent-card-title">{item.title}</p>
        {resolved && (
          <span className="agent-badge" data-tone={item.state}>
            {item.state === "applied"
              ? "Applied"
              : item.state === "dismissed"
                ? "Dismissed"
                : "Out of date"}
          </span>
        )}
      </div>
      {item.summary && <p className="agent-card-text">{item.summary}</p>}
      {item.preview && item.state !== "dismissed" && (
        <div className="agent-preview">
          {item.preview.kind === "lettering" ? (
            <>
              <div className="agent-preview-side" data-side="before">
                <span className="agent-preview-label">Now</span>
                <LetteringLines lines={item.preview.before} />
              </div>
              <div className="agent-preview-side" data-side="after">
                <span className="agent-preview-label">Proposed</span>
                <LetteringLines lines={item.preview.after} />
              </div>
            </>
          ) : (
            <p className="agent-preview-text">{item.preview.text}</p>
          )}
        </div>
      )}
      {item.state === "stale" && (
        <p className="agent-card-text agent-muted-text">
          The work changed after this was proposed. Ask the agent to try again.
        </p>
      )}
      {!resolved && (
        <div className="agent-card-actions">
          <button
            type="button"
            className="btn btn-primary agent-small-button"
            disabled={working !== null}
            onClick={() => void decide("apply")}
          >
            {working === "apply" ? "Applying" : "Apply"}
          </button>
          <button
            type="button"
            className="btn btn-ghost agent-small-button"
            disabled={working !== null}
            onClick={() => void decide("dismiss")}
          >
            Dismiss
          </button>
        </div>
      )}
      <TargetLinks targets={item.targets} onNavigate={onNavigate} />
      {error && (
        <p className="agent-card-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function NoticeCard({
  item,
  canRetry,
  onRetry,
  onSettings,
}: {
  item: Pick<Notice, "tone" | "text" | "action" | "command">;
  canRetry: boolean;
  onRetry: () => void;
  onSettings: () => void;
}) {
  const showRetry = canRetry && (item.action === "retry" || item.action === "sign-in");
  return (
    <div
      className="agent-card agent-notice"
      data-tone={item.tone}
      role={item.tone === "error" ? "alert" : undefined}
    >
      <div className="agent-card-head">
        <span className="agent-card-icon">
          <PanelIcon name={item.tone === "info" ? "sparkle" : "alert"} />
        </span>
        <p className="agent-card-title">{item.text}</p>
      </div>
      {item.command && (
        <>
          {item.action === "sign-in" && (
            <p className="agent-card-text">Run this in your terminal, then try again.</p>
          )}
          <CopyCommand command={item.command} />
        </>
      )}
      {(showRetry || item.action === "settings") && (
        <div className="agent-card-actions">
          {showRetry && (
            <button type="button" className="btn btn-ghost agent-small-button" onClick={onRetry}>
              <PanelIcon name="refresh" /> Retry
            </button>
          )}
          {item.action === "settings" && (
            <button type="button" className="btn btn-ghost agent-small-button" onClick={onSettings}>
              <PanelIcon name="settings" /> Settings
            </button>
          )}
        </div>
      )}
    </div>
  );
}
