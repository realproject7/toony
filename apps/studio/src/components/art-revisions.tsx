"use client";
import type { ArtRevision } from "@toony/project-io";
import type { Character } from "@toony/schema";
import { useCallback, useState } from "react";

type RequestView = Omit<ArtRevision, "context"> & { brief: string; stale: boolean };
export function ArtRevisions({
  workId,
  episodeId,
  cutId,
  sourceDigest,
  characters,
  dirty,
}: {
  workId: string;
  episodeId: string;
  cutId: string;
  sourceDigest: string | null;
  characters: readonly Character[];
  dirty: boolean;
}) {
  const [requests, setRequests] = useState<RequestView[]>([]);
  const [revision, setRevision] = useState<string | null>(null);
  const [change, setChange] = useState("");
  const [preserve, setPreserve] = useState(
    "Character identity, composition, background, lighting and human lettering.",
  );
  const [characterId, setCharacterId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false);
  const [briefId, setBriefId] = useState<string | null>(null);
  const fields = { workId, episodeId, cutId };
  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch(
        `/api/art-revisions?${new URLSearchParams({ workId, episodeId, cutId })}`,
      );
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Could not load revisions.");
      setRequests(data.requests);
      if (data.sourceDigest !== sourceDigest) {
        setRevision(null);
        setMessage(
          "Artwork changed. Save lettering and reload this cut before requesting a change.",
        );
      } else setRevision(data.contextRevision);
    } catch (e) {
      setRevision(null);
      setMessage(e instanceof Error ? e.message : "Could not load revisions.");
    } finally {
      setBusy(false);
    }
  }, [workId, episodeId, cutId, sourceDigest]);
  const send = async (payload: object) => {
    const response = await fetch("/api/art-revisions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...fields, ...payload }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error ?? "Could not save the revision.");
    return data;
  };
  const create = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = await send({
        action: "create",
        contextRevision: revision,
        change,
        preserve,
        ...(characterId ? { characterId } : {}),
      });
      setChange("");
      setBriefId(result.id);
      await refresh();
      setMessage("Request saved. Copy the brief to your agent. No image service has been called.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save the request.");
    } finally {
      setBusy(false);
    }
  };
  const apply = async (r: RequestView) => {
    setBusy(true);
    setMessage("");
    try {
      await send({ action: "apply", id: r.id, candidateDigest: r.candidate?.sha256 });
      window.location.reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not apply the candidate.");
      setBusy(false);
    }
  };
  const src = (path: string, digest: string) =>
    `/api/asset?${new URLSearchParams({ work: workId, path, revision: digest })}`;
  return (
    <details
      className="art-revisions"
      data-testid="art-revisions"
      onToggle={(e) => {
        if (e.currentTarget.open && !opened) {
          setOpened(true);
          void refresh();
        }
      }}
    >
      <summary>Request an art change</summary>
      <div className="art-revisions-body">
        <p className="field-hint">
          Describe a change for this cut. Your agent receives the original image, character and
          scene context, and what must stay the same. You compare the candidate before applying it.
        </p>
        <label className="field">
          <span>Target</span>
          <select value={characterId} onChange={(e) => setCharacterId(e.target.value)}>
            <option value="">Whole cut</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>What should change?</span>
          <textarea
            rows={3}
            maxLength={8000}
            value={change}
            onChange={(e) => setChange(e.target.value)}
            placeholder="Make the character smile more warmly, with relaxed eyes."
          />
        </label>
        <label className="field">
          <span>What should stay the same?</span>
          <textarea
            rows={2}
            maxLength={8000}
            value={preserve}
            onChange={(e) => setPreserve(e.target.value)}
          />
        </label>
        <div className="editor-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || dirty || !revision || !change.trim() || !preserve.trim()}
            onClick={() => void create()}
          >
            Save revision request
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void refresh()}>
            Refresh candidates
          </button>
        </div>
        {dirty && (
          <p className="field-hint">
            Save lettering changes before requesting or applying artwork.
          </p>
        )}
        <p className="field-hint">
          Requests stay in this work. Saving does not send a message or start image generation. The
          agent must use a tool that can edit the source image.
        </p>
        {message && <p role="status">{message}</p>}
        {opened && !busy && !requests.length && (
          <p className="field-hint">No revision requests for this cut yet.</p>
        )}
        {requests.map((r) => (
          <article className="art-revision-card" key={r.id}>
            <strong>{r.change}</strong>
            <p className="field-hint">
              {r.state === "applied"
                ? "Applied as draft"
                : r.stale
                  ? "Context changed · create a new request"
                  : r.state === "candidate"
                    ? "Candidate ready for comparison"
                    : "Waiting for an agent candidate"}
            </p>
            <p>Keep: {r.preserve}</p>
            <div className="editor-actions">
              <button
                type="button"
                className="btn btn-chip"
                onClick={() => setBriefId(briefId === r.id ? null : r.id)}
              >
                Agent brief
              </button>
              <button
                type="button"
                className="btn btn-chip"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(r.brief);
                    setMessage("Agent brief copied.");
                  } catch {
                    setBriefId(r.id);
                    setMessage("Select and copy the brief below.");
                  }
                }}
              >
                Copy brief
              </button>
            </div>
            {briefId === r.id && (
              <label className="field">
                <span>Brief for your agent</span>
                <textarea rows={8} readOnly value={r.brief} onFocus={(e) => e.target.select()} />
              </label>
            )}
            {r.candidate && (
              <>
                <div className="art-revision-comparison">
                  <figure>
                    <a
                      href={src(r.source.snapshotPath, r.source.sha256)}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Open original artwork at full size"
                    >
                      {/* biome-ignore lint/performance/noImgElement: local digest-bound artwork must display without optimization. */}
                      <img
                        src={src(r.source.snapshotPath, r.source.sha256)}
                        alt="Preserved original artwork"
                      />
                    </a>
                    <figcaption>Original</figcaption>
                  </figure>
                  <figure>
                    <a
                      href={src(r.candidate.assetPath, r.candidate.sha256)}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Open candidate artwork at full size"
                    >
                      {/* biome-ignore lint/performance/noImgElement: local digest-bound artwork must display without optimization. */}
                      <img
                        src={src(r.candidate.assetPath, r.candidate.sha256)}
                        alt="Proposed revision candidate"
                      />
                    </a>
                    <figcaption>Candidate</figcaption>
                  </figure>
                </div>
                <p>{r.candidate.note}</p>
                {r.state !== "applied" && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || dirty || r.stale || !revision}
                    onClick={() => void apply(r)}
                  >
                    Use candidate · mark as draft
                  </button>
                )}
              </>
            )}
          </article>
        ))}
      </div>
    </details>
  );
}
