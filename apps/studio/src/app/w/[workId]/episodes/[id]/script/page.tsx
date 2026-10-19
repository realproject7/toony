// The episode's script (advanced): the plan the agent wrote before any art,
// read as a screenplay, plus the proposed changes compiled from it with one
// Apply. Reached from the episode menu as "Script (advanced)". Ids, revisions
// and the record-level diff stay behind "Details".

import type { ScriptCut } from "@toony/schema";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DraftPanel } from "@/components/draft-panel";
import { LoadError } from "@/components/load-error";
import { StudioIcon } from "@/components/studio-icon";
import { transitionLabel } from "@/lib/episode-editing";
import { routeParam, workPageData } from "@/lib/page-data";
import { findEpisodeBundle } from "@/lib/project";
import { loadDraftView, loadScriptView } from "@/lib/script-view";

export const dynamic = "force-dynamic";

const SHOT_LABELS: Record<string, string> = {
  establishing_wide: "Wide shot",
  medium: "Medium shot",
  close_up: "Close-up",
  impact_splash: "Splash",
  small_centered: "Small inset",
};

type Params = { params: Promise<{ workId: string; id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { workId, id } = await params;
  const data = await workPageData(workId);
  if (data.kind !== "ok") return { title: "Script" };
  const bundle = findEpisodeBundle(data.loaded, routeParam(id));
  return {
    title: `Script · ${bundle?.episode.title ?? "Episode"} · ${data.loaded.project.webtoon.title}`,
  };
}

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
  const label = speaker === null ? "Narration" : (names.get(speaker) ?? speaker);
  return (
    <p className="script-line">
      <span
        className={speaker === null ? "script-speaker script-speaker-narration" : "script-speaker"}
      >
        {label}
        {kind && kind !== "speech" && kind !== "narration" ? ` (${kind})` : ""}
      </span>
      <span className="script-text">{text}</span>
    </p>
  );
}

function Cut({
  cut,
  number,
  names,
}: {
  cut: ScriptCut;
  number: number;
  names: Map<string, string>;
}) {
  return (
    <article className="script-cut" data-testid={`script-cut-${cut.id}`}>
      <div className="script-cut-head">
        <b className="script-cut-number">Cut {number}</b>
        {cut.shotType && <span className="chip">{SHOT_LABELS[cut.shotType] ?? cut.shotType}</span>}
        {cut.palette && /^#[0-9a-f]{3,8}$/i.test(cut.palette) && (
          <span className="script-swatch" style={{ background: cut.palette }} title="Color" />
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
          Then: {transitionLabel(cut.transitionAfter.type)}
          {cut.transitionAfter.text ? `, “${cut.transitionAfter.text}”` : ""}
        </p>
      )}
    </article>
  );
}

export default async function EpisodeScriptPage({ params }: Params) {
  const { workId, id } = await params;
  const data = await workPageData(workId);
  if (data.kind === "missing") notFound();
  if (data.kind === "error") return <LoadError reason={data.reason} />;
  const { work, loaded } = data;
  const episodeId = routeParam(id);
  const base = `/w/${encodeURIComponent(work.id)}`;
  const episodeHref = `${base}/episodes/${encodeURIComponent(episodeId)}`;

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

  const episodeTitles = new Map(
    loaded.project.episodes.map((b) => [b.episode.id, b.episode.title]),
  );
  let cutNumber = 0;

  return (
    <div className="page" data-testid="studio-episode-script">
      <header className="page-head">
        <div>
          <h1 className="page-title">
            {bundle?.episode.title ?? scriptBody?.title ?? "New episode"}
          </h1>
          <p className="page-lede">
            Script
            {scriptBody
              ? ` · ${beats.length} ${beats.length === 1 ? "scene" : "scenes"}, ${cutCount} ${cutCount === 1 ? "cut" : "cuts"}`
              : ""}
            {bundle === null && " · not in your story yet"}
          </p>
        </div>
        <Link
          href={bundle !== null ? episodeHref : base}
          className="btn btn-ghost"
          data-testid="back-to-edit-link"
        >
          <StudioIcon name="arrow" rotate={180} /> {bundle !== null ? "Back to editor" : "Story"}
        </Link>
      </header>

      <div className="script-layout">
        <section className="script-column" data-testid="script-view">
          {scriptView.unreadable.includes("script") && (
            <p className="form-error">
              The script file could not be read. Ask the agent to repair it.
            </p>
          )}
          {script?.absent && (
            <p className="empty-note" data-testid="script-empty">
              No script for this episode yet. Ask the agent to write one; it appears here.
            </p>
          )}
          {script && !script.absent && !script.validation.valid && (
            <div data-testid="script-invalid">
              <p className="form-error">The script has problems. Ask the agent to fix them.</p>
              <details className="disclosure">
                <summary>Details</summary>
                <ul className="plain-list">
                  {script.validation.issues.map((issue) => (
                    <li key={`${issue.path}-${issue.code}`}>{issue.message}</li>
                  ))}
                </ul>
              </details>
            </div>
          )}
          {script && script.warnings.length > 0 && (
            <ul className="script-warnings" data-testid="script-warnings">
              {script.warnings.map((warning) => (
                <li key={`${warning.path}-${warning.code}`}>{warning.message}</li>
              ))}
            </ul>
          )}
          {scriptBody?.continuity && (
            <p className="script-continuity" data-testid="script-continuity">
              Continues from{" "}
              {episodeTitles.get(scriptBody.continuity.previousEpisodeId) ?? "the previous episode"}
              : “{scriptBody.continuity.startsFrom}”
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
                  <h2 className="script-purpose">{beat.purpose}</h2>
                  {(beat.goals ?? []).length > 0 && (
                    <ul className="script-goals">
                      {(beat.goals ?? []).map((goal) => (
                        <li key={`${goal.characterId}-${goal.goal}`}>
                          <b>{names.get(goal.characterId) ?? goal.characterId}</b> wants {goal.goal}
                        </li>
                      ))}
                    </ul>
                  )}
                  {beat.cuts.map((cut) => {
                    cutNumber += 1;
                    return <Cut key={cut.id} cut={cut} number={cutNumber} names={names} />;
                  })}
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
                ? draftView.draft.validation.issues.map((i) => i.message)
                : []
            }
            unreadable={draftView.unreadable}
            diff={draftView.diff}
            conflicts={draftView.conflicts}
            fingerprint={draftView.fingerprint}
          />
        </aside>
      </div>
    </div>
  );
}
