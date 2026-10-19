"use client";

// Secondary panel views: conversation history for the current work, what the
// agent remembers about it (notes it can forget, its plan and recent changes),
// and the pinned plan bar under the header.

import { useState } from "react";
import { relativeTime, taskProgress } from "@/lib/agent/panel-state";
import type { ConversationSummary, MemoryView, TaskItem } from "@/lib/agent/protocol";
import { PanelIcon, Spinner } from "./panel-icon";

function ViewHead({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="agent-view-head">
      <button
        type="button"
        className="agent-icon-button"
        aria-label="Back to chat"
        onClick={onBack}
      >
        <PanelIcon name="arrow" />
      </button>
      <h2>{title}</h2>
    </div>
  );
}

export function HistoryView({
  conversations,
  currentId,
  loading,
  error,
  onBack,
  onOpen,
  onDelete,
}: {
  conversations: ConversationSummary[] | null;
  currentId: string | null;
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  return (
    <section className="agent-side-view" aria-label="Conversations">
      <ViewHead title="Conversations" onBack={onBack} />
      {error && (
        <p className="agent-card-error" role="alert">
          {error}
        </p>
      )}
      {loading && !conversations ? (
        <p className="agent-side-empty">
          <Spinner /> Loading conversations
        </p>
      ) : conversations && conversations.length > 0 ? (
        <ul className="agent-history">
          {conversations.map((row) => (
            <li
              key={row.id}
              className="agent-history-row"
              data-current={row.id === currentId ? "true" : undefined}
            >
              <button type="button" className="agent-history-open" onClick={() => onOpen(row.id)}>
                <span className="agent-history-title">{row.title || "New conversation"}</span>
                {row.preview && <span className="agent-history-preview">{row.preview}</span>}
                <span className="agent-history-meta">
                  {row.id === currentId ? "Open now · " : ""}
                  {relativeTime(row.updatedAt)}
                </span>
              </button>
              {confirming === row.id ? (
                <span className="agent-history-confirm">
                  <button
                    type="button"
                    className="agent-text-button"
                    data-tone="danger"
                    disabled={deleting === row.id}
                    onClick={() => {
                      setDeleting(row.id);
                      void onDelete(row.id).finally(() => {
                        setDeleting(null);
                        setConfirming(null);
                      });
                    }}
                  >
                    {deleting === row.id ? "Deleting" : "Delete"}
                  </button>
                  <button
                    type="button"
                    className="agent-text-button"
                    onClick={() => setConfirming(null)}
                  >
                    Keep
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="agent-icon-button"
                  aria-label={`Delete ${row.title || "conversation"}`}
                  onClick={() => setConfirming(row.id)}
                >
                  <PanelIcon name="trash" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="agent-side-empty">
          <PanelIcon name="history" />
          <p>No conversations yet.</p>
        </div>
      )}
      <p className="agent-side-note">Deleting a conversation never changes your webtoon.</p>
    </section>
  );
}

const KIND_LABEL = { decision: "Decision", preference: "Preference", note: "Note" } as const;

export function MemoryPanel({
  memory,
  hasWork,
  loading,
  error,
  onBack,
  onForget,
}: {
  memory: MemoryView | null;
  hasWork: boolean;
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onForget: (noteId: string) => Promise<void>;
}) {
  const [forgetting, setForgetting] = useState<string | null>(null);
  return (
    <section className="agent-side-view" aria-label="What the agent remembers">
      <ViewHead title="What the agent remembers" onBack={onBack} />
      {error && (
        <p className="agent-card-error" role="alert">
          {error}
        </p>
      )}
      {!hasWork ? (
        <div className="agent-side-empty">
          <PanelIcon name="memory" />
          <p>Open a webtoon to see what the agent remembers about it.</p>
        </div>
      ) : loading && !memory ? (
        <p className="agent-side-empty">
          <Spinner /> Loading
        </p>
      ) : memory ? (
        <>
          <h3 className="agent-side-heading">Notes</h3>
          {memory.notes.length === 0 ? (
            <p className="agent-side-note">
              Nothing yet. The agent saves decisions and preferences here as you work.
            </p>
          ) : (
            <ul className="agent-memory-list">
              {memory.notes.map((note) => (
                <li key={note.id} className="agent-memory-note">
                  <span className="agent-badge" data-tone={note.kind}>
                    {KIND_LABEL[note.kind] ?? "Note"}
                  </span>
                  <p>{note.text}</p>
                  <button
                    type="button"
                    className="agent-text-button"
                    disabled={forgetting === note.id}
                    onClick={() => {
                      setForgetting(note.id);
                      void onForget(note.id).finally(() => setForgetting(null));
                    }}
                  >
                    {forgetting === note.id ? "Forgetting" : "Forget"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {memory.tasks.length > 0 && (
            <>
              <h3 className="agent-side-heading">Plan</h3>
              <TaskList tasks={memory.tasks} />
            </>
          )}
          {memory.journal.length > 0 && (
            <>
              <h3 className="agent-side-heading">Recent changes</h3>
              <ul className="agent-journal">
                {memory.journal.slice(0, 15).map((entry) => (
                  <li key={entry.changeId}>
                    <span className="agent-journal-actor">
                      {entry.actor === "agent" ? "Agent" : "You"}
                    </span>
                    <span className="agent-journal-summary">{entry.summary}</span>
                    <span className="agent-journal-time">{relativeTime(entry.at)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : null}
      <p className="agent-side-note">
        This memory is saved with the webtoon, so a new conversation picks up where you left off.
      </p>
    </section>
  );
}

function TaskList({ tasks }: { tasks: TaskItem[] }) {
  return (
    <ol className="agent-tasks">
      {tasks.map((task) => (
        <li key={task.id} data-status={task.status}>
          <span className="agent-task-icon" aria-hidden="true">
            {task.status === "done" ? (
              <PanelIcon name="check" />
            ) : (
              <span className="agent-task-ring" />
            )}
          </span>
          <span className="agent-task-title">{task.title}</span>
          <span className="agent-sr-only">
            {task.status === "done"
              ? "Done"
              : task.status === "in_progress"
                ? "In progress"
                : "To do"}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function PlanBar({ tasks }: { tasks: TaskItem[] }) {
  const [open, setOpen] = useState(false);
  if (tasks.length === 0) return null;
  const progress = taskProgress(tasks);
  const allDone = progress.done === progress.total;
  return (
    <div className="agent-plan" data-open={open ? "true" : undefined}>
      <button
        type="button"
        className="agent-plan-summary"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="agent-plan-meter" aria-hidden="true">
          <span style={{ width: `${(progress.done / progress.total) * 100}%` }} />
        </span>
        <span className="agent-plan-count">
          {progress.done} of {progress.total}
        </span>
        <span className="agent-plan-current">
          {allDone ? "Plan complete" : (progress.current?.title ?? "Plan")}
        </span>
        <PanelIcon name="chevron" />
      </button>
      {open && <TaskList tasks={tasks} />}
    </div>
  );
}
