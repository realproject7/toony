// Per-work, per-episode Script page (#330, #331).
//
// The agreement a person and an agent reach before any art exists lives in two
// authored files: the production brief and the episode script. This page shows
// the script as the shipped reader reports it, with its warnings beside the
// field they concern, and the episode's draft with the same diff `toony draft
// show` prints and one Apply action behind `/api/draft`. The episode may not
// exist yet: a draft for a new episode is reviewed here and apply creates it.

import type { ScriptCut } from "@toony/schema";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DraftPanel } from "@/components/draft-panel";
import { LoadError } from "@/components/load-error";
import { findEpisodeBundle, loadWork, ProjectIoError } from "@/lib/project";
import { loadDraftView, loadScriptView } from "@/lib/script-view";
import { resolveWork } from "@/lib/workspace";

export const dynamic = "force-dynamic";

function Line({
  speaker,
  text,
  kind,
  names,
}: {
  speaker: string | null;
  text: string;
  kind?: string;
  names: Map<string, string>;
}) {
  const label = speaker === null ? "narration" : (names.get(speaker) ?? speaker);
  return (
    <p className="script-line">
      <span
        className={speaker === null ? "script-speaker script-speaker-narration" : "script-speaker"}
      >
        {label}
        {kind && kind !== "speech" && kind !== "narration" ? ` · ${kind}` : ""}
      </span>
      <span className="script-text">{text}</span>
    </p>
  );
}

function Cut({ cut, names }: { cut: ScriptCut; names: Map<string, string> }) {
  return (
    <article className="script-cut" data-testid={`script-cut-${cut.id}`}>
      <div className="script-cut-head">
        <code className="script-cut-id">{cut.id}</code>
        {cut.shotType && <span className="chip">{cut.shotType}</span>}
        {cut.palette && (
          <span className="chip">
            <span
              className="script-swatch"
              style={{ background: cut.palette }}
              aria-hidden="true"
            />
            {cut.palette}
          </span>
        )}
        {(cut.characters ?? []).map((id) => (
          <span className="chip chip-accent" key={id}>
            {names.get(id) ?? id}
          </span>
        ))}
      </div>
      <p className="script-intent">{cut.intent}</p>
      <p className="script-scene">{cut.scene}</p>
      {(cut.dialogue ?? []).map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lines have no id; their position is their identity.
        <Line key={i} speaker={line.speaker} text={line.text} kind={line.kind} names={names} />
      ))}
      {cut.letteringIntent && <p className="script-lettering">Lettering: {cut.letteringIntent}</p>}
      {cut.transitionAfter && (
        <p className="script-gap" data-testid={`script-gap-${cut.id}`}>
          ↓ {cut.transitionAfter.type}
          {cut.transitionAfter.gutterHeight !== undefined
            ? ` · ${cut.transitionAfter.gutterHeight}px`
            : ""}
          {cut.transitionAfter.text ? ` · “${cut.transitionAfter.text}”` : ""}
        </p>
      )}
    </article>
  );
}

export default async function EpisodeScriptPage({
  params,
}: {
  params: Promise<{ workId: string; id: string }>;
}) {
  const { workId, id } = await params;
  const work = await resolveWork(decodeURIComponent(workId));
  if (!work) notFound();
  const episodeId = decodeURIComponent(id);
  const base = `/w/${encodeURIComponent(work.id)}`;
  const episodeHref = `${base}/episodes/${encodeURIComponent(episodeId)}`;

  let loaded: Awaited<ReturnType<typeof loadWork>>;
  try {
    loaded = await loadWork(work.root);
  } catch (cause) {
    const reason = cause instanceof ProjectIoError ? cause.message : String(cause);
    return <LoadError reason={reason} />;
  }

  // The episode may not exist yet: a draft for a new episode is reviewed here.
  const bundle = findEpisodeBundle(loaded, episodeId) ?? null;
  const registry = loaded.project.webtoon.characters ?? [];
  const names = new Map(registry.map((c) => [c.id, c.name]));

  const [scriptView, draftView] = await Promise.all([
    loadScriptView(work.root, episodeId, registry),
    loadDraftView(work.root, episodeId, bundle),
  ]);
  const script = scriptView.script;
  const scriptBody = script?.script ?? null;
  const beats = scriptBody?.beats ?? [];
  const cutCount = beats.reduce((sum, beat) => sum + beat.cuts.length, 0);
  const draft = draftView.draft?.draft ?? null;

  return (
    <div data-testid="studio-episode-script">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">{loaded.project.webtoon.title}</p>
          <h1 className="page-title">{bundle?.episode.title ?? scriptBody?.title ?? episodeId}</h1>
          <div className="page-meta">
            <span>
              id <code>{episodeId}</code>
            </span>
            {bundle === null && <span className="chip chip-warn">episode not created yet</span>}
            {scriptBody && (
              <span>
                <b>{beats.length}</b> beat(s), <b>{cutCount}</b> scripted cut(s)
              </span>
            )}
          </div>
        </div>
        <div className="editor-actions">
          <nav className="reader-toggle" aria-label="View mode">
            {bundle !== null ? (
              <>
                <Link href={episodeHref} className="btn btn-ghost" data-testid="back-to-edit-link">
                  Edit
                </Link>
                <Link href={`${episodeHref}/read`} className="btn btn-ghost">
                  Preview
                </Link>
                <Link href={`${episodeHref}/export`} className="btn btn-ghost">
                  Export
                </Link>
              </>
            ) : (
              <Link href={`${base}/episodes`} className="btn btn-ghost">
                Episodes
              </Link>
            )}
            <span className="btn btn-primary" aria-current="page" data-testid="script-mode-active">
              Script
            </span>
          </nav>
        </div>
      </header>

      <div className="script-layout">
        <section className="script-column" data-testid="script-view">
          <h2 className="card-title">Episode script</h2>
          {scriptView.unreadable.includes("script") && (
            <p className="notice notice-danger">
              The script file exists but is not valid JSON. Fix{" "}
              <code>script/episodes/{episodeId}.json</code>.
            </p>
          )}
          {script?.absent && (
            <p className="empty" data-testid="script-empty">
              No script yet. The agent writes <code>script/episodes/{episodeId}.json</code> after
              agreeing the episode with you; it appears here for review.
            </p>
          )}
          {script && !script.absent && !script.validation.valid && (
            <div className="notice notice-danger" data-testid="script-invalid">
              <p>The script does not validate:</p>
              <ul>
                {script.validation.issues.map((issue) => (
                  <li key={`${issue.path}-${issue.code}`}>
                    <code>{issue.path}</code> {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {script && script.warnings.length > 0 && (
            <ul className="script-warnings" data-testid="script-warnings">
              {script.warnings.map((warning) => (
                <li key={`${warning.path}-${warning.code}`} className="notice">
                  <span className="chip chip-warn">{warning.code}</span> {warning.message}
                </li>
              ))}
            </ul>
          )}
          {scriptBody?.continuity && (
            <p className="notice script-continuity" data-testid="script-continuity">
              Continues from <code>{scriptBody.continuity.previousEpisodeId}</code>: “
              {scriptBody.continuity.startsFrom}”
            </p>
          )}
          {scriptBody && (
            <div className="script-beats">
              {scriptBody.beats.map((beat) => (
                <section
                  className="script-beat"
                  key={beat.id}
                  data-testid={`script-beat-${beat.id}`}
                >
                  <div className="script-beat-head">
                    <code className="script-cut-id">{beat.id}</code>
                    <p className="script-purpose">{beat.purpose}</p>
                  </div>
                  {(beat.goals ?? []).length > 0 && (
                    <ul className="script-goals">
                      {(beat.goals ?? []).map((goal) => (
                        <li key={`${goal.characterId}-${goal.goal}`}>
                          <b>{names.get(goal.characterId) ?? goal.characterId}</b> wants {goal.goal}
                        </li>
                      ))}
                    </ul>
                  )}
                  {beat.cuts.map((cut) => (
                    <Cut key={cut.id} cut={cut} names={names} />
                  ))}
                </section>
              ))}
            </div>
          )}
        </section>

        <aside className="script-aside">
          <DraftPanel
            workId={work.id}
            episodeId={episodeId}
            draft={
              draft === null
                ? null
                : {
                    scriptRevision: draft.scriptRevision,
                    briefRevision: draft.briefRevision,
                    records: {
                      cuts: draft.bundle.cuts.length,
                      transitions: draft.bundle.transitions.length,
                      overlays: draft.bundle.lettering.length,
                    },
                    defaults: draft.defaults,
                    continuity: draft.continuity ?? null,
                  }
            }
            draftIssues={
              draftView.draft !== null && !draftView.draft.absent && draftView.draft.draft === null
                ? draftView.draft.validation.issues.map((i) => `${i.path}: ${i.message}`)
                : []
            }
            unreadable={draftView.unreadable}
            diff={draftView.diff}
            conflicts={draftView.conflicts}
            fingerprint={draftView.fingerprint}
          />
          {scriptView.brief && !scriptView.brief.absent && (
            <section className="card" data-testid="script-brief-note">
              <h2 className="card-title">Brief</h2>
              {scriptView.brief.brief ? (
                <p className="script-scene">{scriptView.brief.brief.intent}</p>
              ) : (
                <p className="notice notice-danger">The brief does not validate.</p>
              )}
              <Link href={base} className="inspector-back">
                Full brief on the dashboard →
              </Link>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
