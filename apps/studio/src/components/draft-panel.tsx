"use client";

// The draft review and apply panel (#330). It renders the diff the server
// computed with the same function `toony draft show` uses, and its one write
// action posts to `/api/draft`, which runs the shipped apply. Nothing here
// recomputes a diff or decides a conflict: the panel shows and asks.

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
  const [showDefaults, setShowDefaults] = useState(false);

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
          setMessage({ kind: "error", text: data.error ?? "The draft could not be updated." });
        } else if (action === "apply") {
          setMessage({
            kind: "ok",
            text: data.created
              ? "Applied. The episode was created from the draft."
              : "Applied. The draft's records are in the episode.",
          });
        } else {
          setMessage({
            kind: "ok",
            text: data.removed ? "Draft discarded." : "There was no draft to discard.",
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
        <h2 className="card-title">Draft</h2>
        <p className="notice notice-danger">
          The draft file exists but is not valid JSON. Recompile it with the Toony CLI, or discard
          it.
        </p>
        <div className="draft-actions">
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy !== null}
            onClick={() => post("discard")}
            data-testid="draft-discard"
          >
            Discard draft
          </button>
        </div>
        {message && <p role="status">{message.text}</p>}
      </section>
    );
  }

  if (draft === null) {
    return (
      <section className="card draft-panel" data-testid="draft-panel">
        <h2 className="card-title">Draft</h2>
        {draftIssues.length > 0 ? (
          <div className="notice notice-danger" data-testid="draft-invalid">
            <p>The draft file does not validate:</p>
            <ul>
              {draftIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="empty-state" data-testid="draft-empty">
            <h3>No proposed changes</h3>
            <p>
              When a draft is prepared, compare it with this episode before applying any changes.
            </p>
            <details>
              <summary>Preparing a draft</summary>
              <p>
                Compile the saved script with <code>toony draft compile --episode {episodeId}</code>
                .
              </p>
            </details>
          </div>
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
              Discard draft
            </button>
          </div>
        )}
        {message && <p role="status">{message.text}</p>}
      </section>
    );
  }

  const blocked = conflicts.length > 0;
  return (
    <section className="card draft-panel" data-testid="draft-panel">
      <div className="draft-head">
        <h2 className="card-title">Draft</h2>
        <span className={`chip ${blocked ? "chip-warn" : "chip-accent"}`}>
          {blocked ? "Needs attention" : "Ready to review"}
        </span>
      </div>
      <details className="draft-source">
        <summary>Source revisions</summary>{" "}
        <span className="field-hint" data-testid="draft-revision">
          script {draft.scriptRevision.slice(0, 12)}
          {draft.briefRevision ? ` · brief ${draft.briefRevision.slice(0, 12)}` : ""}
        </span>
      </details>
      {draft.continuity && (
        <p className="draft-continuity" data-testid="draft-continuity">
          Continues from <code>{draft.continuity.previousEpisodeId}</code>
          {draft.continuity.previousExists ? "" : " (not in the project yet)"}: “
          {draft.continuity.startsFrom}”
        </p>
      )}
      <p className="draft-summary">
        {draft.records.cuts} {draft.records.cuts === 1 ? "cut" : "cuts"},{" "}
        {draft.records.transitions} {draft.records.transitions === 1 ? "transition" : "transitions"}
        , {draft.records.overlays} {draft.records.overlays === 1 ? "bubble" : "bubbles"}.{" "}
        {diff?.episodeExists
          ? "Compared with the episode as the project holds it now."
          : "The episode does not exist yet; applying creates it."}
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
                  <td>{kind}s</td>
                  <td>{diff.counts[kind].added}</td>
                  <td>{diff.counts[kind].changed}</td>
                  <td>{diff.counts[kind].removed}</td>
                  <td>{diff.counts[kind].unchanged}</td>
                </tr>
              ))}
              <tr>
                <td>sequence</td>
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
                {record.marks.reviewStatus && (
                  <span className="chip chip-warn">review {record.marks.reviewStatus}</span>
                )}
                {record.marks.imageSeed !== undefined && (
                  <span className="chip">seed {record.marks.imageSeed}</span>
                )}
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
          <h3 className="section-title">Records the draft drops</h3>
          {diff.removed.map((record) => (
            <p className="diff-field" key={`${record.kind}-${record.id}`}>
              <code>
                {record.kind} {record.id}
              </code>
              {record.marks.reviewStatus ? ` (review ${record.marks.reviewStatus})` : ""}
            </p>
          ))}
        </div>
      )}

      <div className={blocked ? "notice notice-danger" : "notice"} data-testid="draft-conflicts">
        {blocked
          ? `${conflicts.length} conflict(s). Apply refuses while any remain: the draft would change or drop records the project already holds.`
          : "No conflicts. Applying adds the draft's records and changes nothing the project already holds."}
      </div>

      <button
        type="button"
        className="btn btn-ghost draft-defaults-toggle"
        onClick={() => setShowDefaults((v) => !v)}
        data-testid="draft-defaults-toggle"
      >
        {showDefaults ? "Hide" : "Show"} defaulted fields ({draft.defaults.length})
      </button>
      {showDefaults && (
        <ul className="draft-defaults" data-testid="draft-defaults">
          {groupDefaults(draft.defaults).map(([record, fields]) => (
            <li key={record}>
              <code>{record}</code>: {fields.join(", ")}
            </li>
          ))}
        </ul>
      )}

      <div className="draft-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy !== null || blocked}
          onClick={() => post("apply")}
          data-testid="draft-apply"
        >
          {busy === "apply"
            ? "Applying…"
            : diff?.episodeExists
              ? "Apply to episode"
              : "Create episode from draft"}
        </button>
        <button
          type="button"
          className="btn btn-danger"
          disabled={busy !== null}
          onClick={() => post("discard")}
          data-testid="draft-discard"
        >
          Discard draft
        </button>
      </div>
      {message && (
        <p
          className={
            message.kind === "ok"
              ? "editor-toast editor-toast-ok"
              : "editor-toast editor-toast-error"
          }
          role="status"
          data-testid="draft-message"
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
