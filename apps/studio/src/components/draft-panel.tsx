"use client";

// The draft review and apply panel (#330). It renders the diff the server
// computed with the same function `toony draft show` uses, and its one write
// action posts to `/api/draft`, which runs the shipped apply. Nothing here
// recomputes a diff or decides a conflict: the panel shows and asks. The
// default view is one plain summary; the record-level diff, revisions and
// defaulted fields sit behind "Details".

import type {
  DraftConflict,
  DraftContinuity,
  DraftDefault,
  DraftDiff,
  ProjectFingerprint,
} from "@toony/project-io";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { studioFetch } from "@/lib/studio-fetch";

export interface DraftPanelProps {
  workId: string;
  episodeId: string;
  /** Null when there is no valid draft; the panel then says how to make one. */
  draft: {
    scriptRevision: string;
    briefRevision: string | null;
    records: { cuts: number; transitions: number; overlays: number };
    defaults: DraftDefault[];
    continuity: DraftContinuity | null;
  } | null;
  /** Issues when a draft file exists but does not validate. */
  draftIssues: string[];
  unreadable: boolean;
  diff: DraftDiff | null;
  conflicts: DraftConflict[];
  fingerprint: ProjectFingerprint;
}

function show(value: unknown): string {
  if (value === undefined) return "absent";
  return JSON.stringify(value);
}

function groupDefaults(defaults: readonly DraftDefault[]): Array<[string, string[]]> {
  const byRecord = new Map<string, string[]>();
  for (const d of defaults) {
    const key = `${d.kind} ${d.id}`;
    byRecord.set(key, [...(byRecord.get(key) ?? []), d.field]);
  }
  return [...byRecord.entries()];
}

export function DraftPanel({
  workId,
  episodeId,
  draft,
  draftIssues,
  unreadable,
  diff,
  conflicts,
  fingerprint,
}: DraftPanelProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<"apply" | "discard" | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const post = useCallback(
    async (action: "apply" | "discard") => {
      setBusy(action);
      setMessage(null);
      try {
        const response = await studioFetch("/api/draft", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            workId,
            episodeId,
            action,
            ...(action === "apply" ? { reviewedAgainst: fingerprint } : {}),
          }),
        });
        const data = (await response.json()) as {
          ok: boolean;
          error?: string;
          created?: boolean;
          removed?: boolean;
        };
        if (!response.ok || !data.ok) {
          setMessage({ kind: "error", text: data.error ?? "Toony could not update the proposal." });
        } else if (action === "apply") {
          setMessage({
            kind: "ok",
            text: data.created ? "Applied. The episode was created." : "Applied to the episode.",
          });
        } else {
          setMessage({
            kind: "ok",
            text: data.removed ? "Proposal discarded." : "There was no proposal to discard.",
          });
        }
        router.refresh();
      } catch (cause) {
        setMessage({ kind: "error", text: cause instanceof Error ? cause.message : String(cause) });
      } finally {
        setBusy(null);
      }
    },
    [workId, episodeId, fingerprint, router],
  );

  if (unreadable) {
    return (
      <section className="card draft-panel" data-testid="draft-panel">
        <h2 className="card-title">Proposed changes</h2>
        <p className="form-error">
          The proposal could not be read. Discard it, or ask the agent to prepare it again.
        </p>
        <div className="draft-actions">
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy !== null}
            onClick={() => post("discard")}
            data-testid="draft-discard"
          >
            Discard proposal
          </button>
        </div>
        {message && <p role="status">{message.text}</p>}
      </section>
    );
  }

  if (draft === null) {
    return (
      <section className="card draft-panel" data-testid="draft-panel">
        <h2 className="card-title">Proposed changes</h2>
        {draftIssues.length > 0 ? (
          <div data-testid="draft-invalid">
            <p className="form-error">
              The proposal has problems. Ask the agent to prepare it again.
            </p>
            <details className="disclosure">
              <summary>Details</summary>
              <ul className="plain-list">
                {draftIssues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </details>
          </div>
        ) : (
          <p className="empty-note" data-testid="draft-empty">
            Nothing to review. When the agent prepares changes from this script, you review and
            apply them here.
          </p>
        )}
        {draftIssues.length > 0 && (
          <div className="draft-actions">
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy !== null}
              onClick={() => post("discard")}
              data-testid="draft-discard"
            >
              Discard proposal
            </button>
          </div>
        )}
        {message && <p role="status">{message.text}</p>}
      </section>
    );
  }

  const blocked = conflicts.length > 0;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const added = diff
    ? {
        cuts: diff.counts.cut.added,
        transitions: diff.counts.transition.added,
        bubbles: diff.counts.overlay.added,
      }
    : {
        cuts: draft.records.cuts,
        transitions: draft.records.transitions,
        bubbles: draft.records.overlays,
      };
  const nothingNew =
    diff?.episodeExists === true &&
    !blocked &&
    added.cuts + added.transitions + added.bubbles === 0 &&
    diff.changed.length === 0 &&
    diff.title === null;
  return (
    <section className="card draft-panel" data-testid="draft-panel">
      <div className="draft-head">
        <h2 className="card-title">Proposed changes</h2>
        <span className={`chip ${blocked ? "chip-warn" : nothingNew ? "chip-ok" : "chip-accent"}`}>
          {blocked ? "Needs your decision" : nothingNew ? "Already applied" : "Ready to apply"}
        </span>
      </div>
      {draft.continuity && (
        <p className="draft-continuity" data-testid="draft-continuity">
          Continues from the previous episode: “{draft.continuity.startsFrom}”
        </p>
      )}
      <p className="draft-summary">
        {nothingNew
          ? "Everything in this proposal is already in the episode."
          : `${diff?.episodeExists ? "Adds" : "Creates the episode with"} ${plural(added.cuts, "cut", "cuts")}, ${plural(added.transitions, "transition", "transitions")} and ${plural(added.bubbles, "bubble", "bubbles")}.`}
      </p>
      {!nothingNew && (
        <p className={blocked ? "form-error" : "page-meta"} data-testid="draft-conflicts">
          {blocked
            ? `This would change or remove ${plural(conflicts.length, "thing", "things")} already in the episode, so it cannot be applied. Ask the agent to update the proposal.`
            : "Nothing already in the episode changes."}
        </p>
      )}

      <div className="draft-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy !== null || blocked || nothingNew}
          onClick={() => post("apply")}
          data-testid="draft-apply"
        >
          {busy === "apply"
            ? "Applying…"
            : diff?.episodeExists
              ? "Apply to episode"
              : "Create episode"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy !== null}
          onClick={() => post("discard")}
          data-testid="draft-discard"
        >
          Discard proposal
        </button>
      </div>
      {message && (
        <p
          className={message.kind === "ok" ? "form-ok" : "form-error"}
          role="status"
          data-testid="draft-message"
        >
          {message.text}
        </p>
      )}

      <details className="disclosure draft-details">
        <summary>Details</summary>
        <p className="field-hint" data-testid="draft-revision">
          Script {draft.scriptRevision.slice(0, 12)}
          {draft.briefRevision ? ` · story notes ${draft.briefRevision.slice(0, 12)}` : ""}
        </p>
        {diff && (
          <div className="draft-table-scroll">
            <table className="draft-counts" data-testid="draft-counts">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Added</th>
                  <th>Changed</th>
                  <th>Removed</th>
                  <th>Unchanged</th>
                </tr>
              </thead>
              <tbody>
                {(["cut", "transition", "overlay"] as const).map((kind) => (
                  <tr key={kind}>
                    <td>{kind === "overlay" ? "bubbles" : `${kind}s`}</td>
                    <td>{diff.counts[kind].added}</td>
                    <td>{diff.counts[kind].changed}</td>
                    <td>{diff.counts[kind].removed}</td>
                    <td>{diff.counts[kind].unchanged}</td>
                  </tr>
                ))}
                <tr>
                  <td>order</td>
                  <td colSpan={4} data-testid="draft-sequence">
                    {diff.sequence.status}
                    {diff.sequence.added > 0 ? `, ${diff.sequence.added} added` : ""}
                    {diff.sequence.removed.length > 0
                      ? `, drops ${diff.sequence.removed.join(", ")}`
                      : ""}
                    {diff.sequence.reordered ? ", reorders existing entries" : ""}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        {diff?.title && (
          <p className="diff-field">
            title: <span className="diff-old">{show(diff.title.current)}</span> →{" "}
            <span className="diff-new">{show(diff.title.drafted)}</span>
          </p>
        )}
        {diff && diff.changed.length > 0 && (
          <div className="draft-changes" data-testid="draft-changed">
            <h3 className="section-title">Changed records</h3>
            {diff.changed.map((record) => (
              <div className="diff-record" key={`${record.kind}-${record.id}`}>
                <p className="diff-record-head">
                  <code>
                    {record.kind} {record.id}
                  </code>
                </p>
                {record.changes.map((change) => (
                  <p className="diff-field" key={change.field}>
                    {change.field}: <span className="diff-old">{show(change.current)}</span> →{" "}
                    <span className="diff-new">{show(change.drafted)}</span>
                  </p>
                ))}
              </div>
            ))}
          </div>
        )}
        {diff && diff.removed.length > 0 && (
          <div className="draft-changes" data-testid="draft-removed">
            <h3 className="section-title">Records the proposal drops</h3>
            {diff.removed.map((record) => (
              <p className="diff-field" key={`${record.kind}-${record.id}`}>
                <code>
                  {record.kind} {record.id}
                </code>
              </p>
            ))}
          </div>
        )}
        {draft.defaults.length > 0 && (
          <>
            <h3 className="section-title">Filled in with defaults</h3>
            <ul className="draft-defaults" data-testid="draft-defaults">
              {groupDefaults(draft.defaults).map(([record, fields]) => (
                <li key={record}>
                  <code>{record}</code>: {fields.join(", ")}
                </li>
              ))}
            </ul>
          </>
        )}
      </details>
    </section>
  );
}
