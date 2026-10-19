"use client";

// The story page's episode list, in reading order: number, title, progress and
// last change, with Preview and a small menu (Rename, Script, Export, Delete).
// Delete asks first and offers Undo. "New episode" creates a blank episode and
// opens it.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { progressLine } from "@/lib/episode-progress";
import { editedLabel } from "@/lib/relative-time";
import type { StoryEpisode } from "@/lib/story-view";
import { studioFetch } from "@/lib/studio-fetch";
import { ActionMenu } from "./action-menu";
import { ConfirmDialog } from "./confirm-dialog";
import { StudioIcon } from "./studio-icon";
import { useUndoToast } from "./undo-toast";

async function post(body: Record<string, unknown>) {
  const response = await studioFetch("/api/episodes", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as {
    ok?: boolean;
    error?: string;
    episodeId?: string;
    changeId?: string | null;
  };
  if (!response.ok || !data.ok)
    throw new Error(data.error ?? "Toony could not change the episode.");
  return data;
}

export function EpisodeRows({ workId, episodes }: { workId: string; episodes: StoryEpisode[] }) {
  const router = useRouter();
  const toast = useUndoToast(workId);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState<StoryEpisode | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/w/${encodeURIComponent(workId)}`;
  const now = new Date();

  const create = async () => {
    setCreating(true);
    try {
      const data = await post({ action: "create", workId, cuts: 1 });
      if (data.episodeId) router.push(`${base}/episodes/${encodeURIComponent(data.episodeId)}`);
    } catch (error) {
      toast.show({ text: (error as Error).message, tone: "error" });
      setCreating(false);
    }
  };

  const rename = async () => {
    if (!renaming) return;
    const current = episodes.find((episode) => episode.id === renaming.id);
    const title = renaming.title.trim();
    if (!current || title === "" || title === current.title) {
      setRenaming(null);
      return;
    }
    setBusy(true);
    try {
      const data = await post({ action: "rename", workId, episodeId: renaming.id, title });
      toast.show({ text: `Renamed to “${title}”.`, changeId: data.changeId ?? null });
      setRenaming(null);
      router.refresh();
    } catch (error) {
      toast.show({ text: (error as Error).message, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      const data = await post({ action: "delete", workId, episodeId: deleting.id });
      toast.show({ text: `Deleted “${deleting.title}”.`, changeId: data.changeId ?? null });
      setDeleting(null);
      router.refresh();
    } catch (error) {
      toast.show({ text: (error as Error).message, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="story-section" id="episodes" aria-labelledby="episodes-title">
      <div className="section-head">
        <h2 className="section-title" id="episodes-title">
          Episodes
        </h2>
        <button
          type="button"
          className="btn"
          onClick={() => void create()}
          disabled={creating}
          data-testid="new-episode"
        >
          <StudioIcon name="plus" /> {creating ? "Creating…" : "New episode"}
        </button>
      </div>
      {episodes.length === 0 ? (
        <p className="empty-note" data-testid="episodes-empty">
          No episodes yet. Ask the agent to write the first one, or start a blank episode.
        </p>
      ) : (
        <ol className="episode-rows" data-testid="episode-list">
          {episodes.map((episode) => {
            const href = `${base}/episodes/${encodeURIComponent(episode.id)}`;
            const edited = editedLabel(episode.updatedAt, now);
            return (
              <li key={episode.id} className="episode-row" data-testid={`episode-${episode.id}`}>
                <span className="episode-number" aria-hidden="true">
                  {episode.number}
                </span>
                {renaming?.id === episode.id ? (
                  <form
                    className="episode-rename"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void rename();
                    }}
                  >
                    <label className="sr-only" htmlFor={`rename-${episode.id}`}>
                      Episode title
                    </label>
                    <input
                      id={`rename-${episode.id}`}
                      className="text-input"
                      value={renaming.title}
                      maxLength={200}
                      disabled={busy}
                      // biome-ignore lint/a11y/noAutofocus: the person just asked to rename this row.
                      autoFocus
                      onChange={(event) =>
                        setRenaming({ id: episode.id, title: event.target.value })
                      }
                      onKeyDown={(event) => {
                        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
                          if (event.key === "Enter") event.preventDefault();
                          return;
                        }
                        if (event.key === "Escape") setRenaming(null);
                      }}
                    />
                    <button type="submit" className="btn btn-primary" disabled={busy}>
                      Save
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setRenaming(null)}
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <Link href={href} className="episode-row-link">
                    <span className="episode-row-title">{episode.title}</span>
                    <span className="episode-row-meta">
                      {progressLine(episode.progress)}
                      {edited && ` · ${edited}`}
                    </span>
                  </Link>
                )}
                <div className="episode-row-actions">
                  <Link
                    href={`${href}/read`}
                    className="btn btn-ghost"
                    data-testid={`episode-read-${episode.id}`}
                  >
                    <StudioIcon name="eye" /> Preview
                  </Link>
                  <ActionMenu
                    label={`More actions for ${episode.title}`}
                    actions={[
                      {
                        label: "Rename",
                        onSelect: () => setRenaming({ id: episode.id, title: episode.title }),
                      },
                      { label: "Export", href: `${href}/export` },
                      { label: "Script (advanced)", href: `${href}/script` },
                      {
                        label: "Delete",
                        danger: true,
                        onSelect: () => setDeleting(episode),
                        testId: `episode-delete-${episode.id}`,
                      },
                    ]}
                  />
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete “${deleting?.title ?? ""}”?`}
        confirmLabel={busy ? "Deleting…" : "Delete episode"}
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(null)}
      >
        <p>Its cuts, artwork links and lettering go with it. You can undo right after.</p>
      </ConfirmDialog>
      {toast.element}
    </section>
  );
}
