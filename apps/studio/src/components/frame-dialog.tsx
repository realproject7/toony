"use client";

// Frame a cut (CMP-02): pick the part of a picture the cut shows by dragging a
// frame over the whole picture, or show part of another cut's picture, so one
// tall drawing can run across cuts with a transition between them. The picture
// itself is never changed. The frame stops at the picture's edges; for more
// above or below, the person asks their agent to draw it.

import type { ImageView } from "@toony/schema";
import { type PointerEvent, useEffect, useRef, useState } from "react";
import { openAgentPanel } from "@/lib/agent/focus-store";
import {
  dragFrame,
  FRAME_PRESETS,
  type FrameHandle,
  frameEdges,
  isWholeFrame,
  WHOLE_FRAME,
} from "@/lib/frame-math";
import type { CutArt } from "@/lib/project";
import { studioFetch } from "@/lib/studio-fetch";

export interface FramePicture {
  cutId: string;
  number: number;
  art: CutArt;
}

/** The whole source of a cut's art and the frame it shows now, in fractions. */
function sourceOf(art: CutArt): { width: number; height: number; frame: ImageView } {
  const view = art.view;
  if (!view) return { width: art.width, height: art.height, frame: WHOLE_FRAME };
  return {
    width: view.sourceWidth,
    height: view.sourceHeight,
    frame: {
      x: view.x / view.sourceWidth,
      y: view.y / view.sourceHeight,
      width: view.width / view.sourceWidth,
      height: view.height / view.sourceHeight,
    },
  };
}

const HANDLES: FrameHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export function FrameDialog({
  open,
  workId,
  episodeId,
  cutId,
  cutNumber,
  art,
  pictures,
  onClose,
  onSaved,
}: {
  open: boolean;
  workId: string;
  episodeId: string;
  cutId: string;
  cutNumber: number;
  art: CutArt;
  /** Other cuts of the episode that have a picture. */
  pictures: readonly FramePicture[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const ownPicture = art.src !== null;
  const firstOther = pictures[0]?.cutId ?? null;
  const [fromCutId, setFromCutId] = useState<string | null>(ownPicture ? null : firstOther);
  const picture =
    fromCutId === null ? art : (pictures.find((p) => p.cutId === fromCutId)?.art ?? art);
  const source = sourceOf(picture);
  const [frame, setFrame] = useState<ImageView>(sourceOf(art).frame);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ handle: FrameHandle; x: number; y: number; start: ImageView } | null>(null);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setFromCutId(ownPicture ? null : firstOther);
      setFrame(ownPicture ? sourceOf(art).frame : WHOLE_FRAME);
      setError(null);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open, art, ownPicture, firstOther]);

  const begin = (handle: FrameHandle) => (event: PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    drag.current = { handle, x: event.clientX, y: event.clientY, start: frame };
  };
  const move = (event: PointerEvent) => {
    const current = drag.current;
    const box = stage.current?.getBoundingClientRect();
    if (!current || !box || box.width === 0 || box.height === 0) return;
    setFrame(
      dragFrame(
        current.start,
        current.handle,
        (event.clientX - current.x) / box.width,
        (event.clientY - current.y) / box.height,
      ),
    );
  };
  const end = () => {
    drag.current = null;
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await studioFetch("/api/cut-view", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workId,
          episodeId,
          cutId,
          view: isWholeFrame(frame) ? null : frame,
          ...(fromCutId === null ? {} : { fromCutId }),
        }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        setError(data.error ?? "Toony could not frame this cut.");
        return;
      }
      onSaved();
      onClose();
    } catch {
      setError("Toony could not frame this cut.");
    } finally {
      setBusy(false);
    }
  };

  const edges = frameEdges(frame);
  const shown = {
    width: Math.round(frame.width * source.width),
    height: Math.round(frame.height * source.height),
  };
  const askForMore = (where: "above" | "below") => {
    onClose();
    openAgentPanel({
      view: "chat",
      prefill: `Cut ${cutNumber} needs more of the scene ${where} what its picture shows. Draw `,
    });
  };

  return (
    <dialog
      ref={ref}
      className="frame-dialog"
      aria-labelledby="frame-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 id="frame-dialog-title">Frame Cut {cutNumber}</h2>
      <p className="empty-note">
        Drag the frame to choose what this cut shows. The picture itself does not change.
      </p>
      <div className="frame-layout">
        <div
          ref={stage}
          className="frame-stage"
          style={{ aspectRatio: `${source.width} / ${source.height}` }}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          data-testid="frame-stage"
        >
          {picture.src && (
            // biome-ignore lint/performance/noImgElement: local picture served by /api/asset.
            <img src={picture.src} alt={`Source for Cut ${cutNumber}`} draggable={false} />
          )}
          <div
            className="frame-box"
            role="presentation"
            style={{
              left: `${frame.x * 100}%`,
              top: `${frame.y * 100}%`,
              width: `${frame.width * 100}%`,
              height: `${frame.height * 100}%`,
            }}
            onPointerDown={begin("move")}
            data-testid="frame-box"
          >
            {HANDLES.map((handle) => (
              <span
                key={handle}
                className={`frame-handle is-${handle}`}
                onPointerDown={begin(handle)}
              />
            ))}
          </div>
        </div>
        <div className="frame-side">
          <fieldset className="frame-presets">
            <legend>Quick frames</legend>
            {FRAME_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="btn"
                onClick={() => setFrame(preset.view)}
              >
                {preset.label}
              </button>
            ))}
          </fieldset>
          {pictures.length > 0 && (
            <label className="frame-source">
              Picture
              <select
                value={fromCutId ?? ""}
                onChange={(event) => {
                  const next = event.target.value || null;
                  setFromCutId(next);
                  setFrame(
                    next === null ? sourceOf(art).frame : (FRAME_PRESETS[2]?.view ?? WHOLE_FRAME),
                  );
                }}
                data-testid="frame-source"
              >
                {ownPicture && <option value="">This cut's picture</option>}
                {pictures.map((p) => (
                  <option key={p.cutId} value={p.cutId}>
                    Cut {p.number}'s picture (a copy)
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="frame-size" data-testid="frame-size">
            Shows {shown.width} x {shown.height} px
            {isWholeFrame(frame) ? " (the whole picture)" : ""}
          </p>
          {(edges.top || edges.bottom) && !isWholeFrame(frame) && (
            <div className="frame-edge-note">
              <p>
                The picture ends at the frame's{" "}
                {edges.top && edges.bottom ? "top and bottom" : edges.top ? "top" : "bottom"}. For
                more of the scene, ask your agent to draw it.
              </p>
              {edges.top && (
                <button type="button" className="btn btn-quiet" onClick={() => askForMore("above")}>
                  Ask for more above
                </button>
              )}
              {edges.bottom && (
                <button type="button" className="btn btn-quiet" onClick={() => askForMore("below")}>
                  Ask for more below
                </button>
              )}
            </div>
          )}
          {fromCutId !== null && (
            <p className="empty-note">
              Saving copies that picture into this cut and replaces its current one. You can undo
              it.
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
      <div className="form-actions">
        <button type="button" className="btn" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => void save()}
          data-testid="frame-save"
        >
          {busy ? "Saving…" : "Save frame"}
        </button>
      </div>
    </dialog>
  );
}
