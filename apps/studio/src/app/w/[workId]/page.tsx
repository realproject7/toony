// The story page: the webtoon's home. Its title (renamed in place), the story
// in a calm read view, the cast, and the episodes. The agent writes the story;
// this page shows it. "Needs attention" appears only when something is wrong.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EpisodeRows } from "@/components/episode-rows";
import { LiveRefresh } from "@/components/live-refresh";
import { LoadError } from "@/components/load-error";
import { WorkTitle } from "@/components/work-title";
import { workPageData, workTitle } from "@/lib/page-data";
import { plainIssues } from "@/lib/plain-issues";
import { loadBriefView } from "@/lib/script-view";
import { castMembers, storyEpisodes } from "@/lib/story-view";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ workId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { workId } = await params;
  return { title: `Story · ${await workTitle(workId)}` };
}

export default async function StoryPage({ params }: Params) {
  const { workId } = await params;
  const data = await workPageData(workId);
  if (data.kind === "missing") notFound();
  if (data.kind === "error") return <LoadError reason={data.reason} />;
  const { work, loaded } = data;
  const { webtoon } = loaded.project;
  const base = `/w/${encodeURIComponent(work.id)}`;
  const [episodes, briefView] = await Promise.all([
    storyEpisodes(work.root, loaded),
    loadBriefView(work.root),
  ]);
  const brief = briefView.brief?.brief ?? null;
  const cast = castMembers(work.id, work.root, loaded);
  const issues = loaded.validation.valid
    ? []
    : plainIssues(loaded.validation.issues, loaded.project, base);
  const story: Array<{ label: string; value: string | string[] }> = [];
  if (webtoon.synopsis) story.push({ label: "Synopsis", value: webtoon.synopsis });
  if (brief?.world) story.push({ label: "World", value: brief.world });
  if (brief?.audience) story.push({ label: "Audience", value: brief.audience });
  if (brief?.storyGoals?.length) story.push({ label: "Goals", value: brief.storyGoals });
  // The one-line story: the logline, or the brief's intent when no logline exists.
  const lede = webtoon.logline?.trim() || brief?.intent?.trim() || "";
  const hasStory = lede !== "" || story.length > 0;

  return (
    <div className="page story-page" data-testid="studio-dashboard">
      <LiveRefresh workId={work.id} />
      <header className="story-head">
        <WorkTitle workId={work.id} title={webtoon.title} />
        {lede && <p className="story-logline">{lede}</p>}
      </header>

      {issues.length > 0 && (
        <section
          className="attention"
          aria-labelledby="attention-title"
          data-testid="validation-status"
        >
          <h2 id="attention-title">Needs attention</h2>
          <ul>
            {issues.slice(0, 8).map((issue) => (
              <li key={issue.key}>
                {issue.href ? <Link href={issue.href}>{issue.where}</Link> : <b>{issue.where}</b>}
                <span>{issue.text}</span>
              </li>
            ))}
          </ul>
          {issues.length > 8 && <p className="page-meta">And {issues.length - 8} more.</p>}
          <p className="page-meta">You can also ask the agent to check and fix these.</p>
        </section>
      )}

      <section className="story-section" aria-labelledby="story-title" data-testid="brief-section">
        <h2 className="section-title" id="story-title">
          Story
        </h2>
        {story.length > 0 ? (
          <dl className="story-fields" data-testid="brief-fields">
            {story.map((field) => (
              <div key={field.label}>
                <dt>{field.label}</dt>
                <dd>
                  {Array.isArray(field.value) ? (
                    <ul>
                      {field.value.map((goal) => (
                        <li key={goal}>{goal}</li>
                      ))}
                    </ul>
                  ) : (
                    field.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="empty-note" data-testid="brief-empty">
            {hasStory
              ? "The rest of the story is not written yet."
              : "No story yet. Tell the agent your idea in the chat, and it will write the story here."}{" "}
            {briefView.unreadable &&
              "The story notes file could not be read; ask the agent to repair it."}
          </p>
        )}
      </section>

      <section className="story-section" aria-labelledby="cast-title">
        <div className="section-head">
          <h2 className="section-title" id="cast-title">
            Cast
          </h2>
          <Link href={`${base}/characters`} className="btn btn-ghost" data-testid="character-count">
            {cast.length === 0 ? "Add characters" : "All characters"}
          </Link>
        </div>
        {cast.length === 0 ? (
          <p className="empty-note">No characters yet. Ask the agent to create the cast.</p>
        ) : (
          <ul className="cast-strip">
            {cast.map((member) => (
              <li key={member.id}>
                <Link
                  href={`${base}/characters#${encodeURIComponent(member.id)}`}
                  className="cast-chip"
                >
                  <span className="avatar" aria-hidden="true">
                    {member.portrait ? (
                      // biome-ignore lint/performance/noImgElement: local reference sheet thumbnail.
                      <img src={member.portrait} alt="" />
                    ) : (
                      (Array.from(member.name.trim())[0] ?? "?").toUpperCase()
                    )}
                  </span>
                  <span className="cast-chip-text">
                    <b className="cast-chip-name">{member.name}</b>
                    {member.role && <small className="cast-chip-role">{member.role}</small>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <EpisodeRows workId={work.id} episodes={episodes} />
    </div>
  );
}
