// The production brief, read-only, on the work dashboard (#331). Rendered on the
// server from the shipped reader; an absent brief is a normal state, a malformed
// one shows its issues, and an unparsable one says so without a path.

import type { LoadedBrief } from "@toony/project-io";
import type { Character } from "@toony/schema";

export function BriefCard({
  brief,
  unreadable,
  characters,
}: {
  brief: LoadedBrief | null;
  unreadable: boolean;
  characters: readonly Character[];
}) {
  const names = new Map(characters.map((c) => [c.id, c.name]));
  return (
    <article className="card brief-card" data-testid="brief-card">
      <h2 className="card-title">Story brief</h2>
      {unreadable && (
        <p className="notice notice-danger">
          The brief file exists but is not valid JSON. Fix <code>script/brief.json</code>.
        </p>
      )}
      {brief?.absent && (
        <p className="empty" data-testid="brief-empty">
          No story brief yet. Develop the premise, audience and characters with your agent.
          Connected chat discusses proposals; saving them to the project is not available yet.
        </p>
      )}
      {brief && !brief.absent && brief.brief === null && (
        <div className="notice notice-danger" data-testid="brief-invalid">
          <p>The brief does not validate:</p>
          <ul>
            {brief.validation.issues.map((issue) => (
              <li key={`${issue.path}-${issue.code}`}>
                <code>{issue.path}</code> {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {brief?.brief && (
        <dl className="brief-fields" data-testid="brief-fields">
          <dt>Intent</dt>
          <dd>{brief.brief.intent}</dd>
          <dt>Audience</dt>
          <dd>{brief.brief.audience}</dd>
          <dt>World</dt>
          <dd>{brief.brief.world}</dd>
          <dt>Story goals</dt>
          <dd>
            <ol>
              {brief.brief.storyGoals.map((goal) => (
                <li key={goal}>{goal}</li>
              ))}
            </ol>
          </dd>
          {brief.brief.contentConstraints && brief.brief.contentConstraints.length > 0 && (
            <>
              <dt>Constraints</dt>
              <dd>
                <ul>
                  {brief.brief.contentConstraints.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </dd>
            </>
          )}
          {brief.brief.cast && brief.brief.cast.length > 0 && (
            <>
              <dt>Cast</dt>
              <dd>
                <ul>
                  {brief.brief.cast.map((note) => (
                    <li key={note.characterId}>
                      <b>{names.get(note.characterId) ?? note.characterId}</b>
                      {!names.has(note.characterId) && (
                        <span className="chip chip-warn">not in registry</span>
                      )}{" "}
                      {note.role}
                      {note.continuity ? ` · ${note.continuity}` : ""}
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          )}
          {brief.brief.revisionPolicy && (
            <>
              <dt>Revision policy</dt>
              <dd>{brief.brief.revisionPolicy}</dd>
            </>
          )}
          {brief.brief.planningProfile && (
            <>
              <dt>Planning profile</dt>
              <dd>
                {brief.brief.planningProfile.geometry && (
                  <p>Geometry: {brief.brief.planningProfile.geometry}</p>
                )}
                {brief.brief.planningProfile.transitions && (
                  <p>Transitions: {brief.brief.planningProfile.transitions}</p>
                )}
                {brief.brief.planningProfile.lettering && (
                  <p>Lettering: {brief.brief.planningProfile.lettering}</p>
                )}
              </dd>
            </>
          )}
        </dl>
      )}
    </article>
  );
}
