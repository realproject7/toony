"use client";

// Export panel: a list of outputs on the left; for the chosen one, a few
// options, a layout preview of the files it will write, the Export button with
// progress, and the resulting files with downloads. The export itself runs in
// the background on the server (`POST /api/export`), and this panel follows
// the job (`GET /api/export/jobs/<id>`).

import type { LayoutBand, LayoutFile, LayoutPlan } from "@toony/export/layout";
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { StudioIcon } from "@/components/studio-icon";
import type { ExportJobView } from "@/lib/agent/protocol";
import {
  choiceForOutput,
  defaultSettings,
  exportRequest,
  formatBytes,
  OUTPUT_CHOICES,
  type OutputChoice,
  type OutputSettings,
  type PreviewItem,
  planSummary,
  previewBands,
  previewPlan,
} from "@/lib/export-view";
import type { CutArt } from "@/lib/project";
import { studioFetch } from "@/lib/studio-fetch";
import { CutArtImage } from "./cut-art-image";

/** A finished export shown when the page opens. */
export interface SavedExportView extends ExportJobView {
  outOfDate: boolean;
}

export interface ExportPanelProps {
  workId: string;
  episodeId: string;
  referenceWidth: number;
  items: PreviewItem[];
  saved: Record<string, SavedExportView>;
}

type Result = ExportJobView & { outOfDate?: boolean };

const POLL_MS = 400;
const PREVIEW_FILES_MAX = 24;

/** Problems with the typed numbers, by field. Export waits until they are fixed. */
function settingsProblems(choice: OutputChoice, settings: OutputSettings): Record<string, string> {
  const problems: Record<string, string> = {};
  const whole = (value: number, min: number, max: number) =>
    Number.isInteger(value) && value >= min && value <= max;
  if (choice === "strip") {
    if (!whole(settings.strip.width, 1, 100000)) problems.width = "Use 1 to 100000 px.";
    if (settings.strip.split && !whole(settings.strip.partHeight, 64, 100000)) {
      problems.partHeight = "Use 64 to 100000 px.";
    }
  }
  if (choice === "cuts") {
    if (!whole(settings.cuts.width, 1, 100000)) problems.width = "Use 1 to 100000 px.";
    else if (
      !whole(settings.cuts.margin, 0, 10000) ||
      settings.cuts.margin * 2 >= settings.cuts.width
    ) {
      problems.margin = `Use 0 to ${Math.max(0, Math.ceil(settings.cuts.width / 2) - 1)} px.`;
    }
  }
  return problems;
}

export function ExportPanel({ workId, episodeId, referenceWidth, items, saved }: ExportPanelProps) {
  const [choice, setChoice] = useState<OutputChoice>(() => {
    const first = Object.keys(saved)
      .map(choiceForOutput)
      .find((value): value is OutputChoice => value !== null);
    return first ?? "strip";
  });
  const [settings, setSettings] = useState<OutputSettings>(() => {
    const initial = defaultSettings(referenceWidth);
    if (saved["instagram-square"] && !saved.instagram) initial.instagram.shape = "square";
    return initial;
  });
  const [results, setResults] = useState<Record<string, Result>>(saved);
  const [job, setJob] = useState<ExportJobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bands = useMemo(() => previewBands(items, referenceWidth), [items, referenceWidth]);
  const request = useMemo(() => exportRequest(choice, settings), [choice, settings]);
  const plan = useMemo(
    () => previewPlan(bands, request, referenceWidth),
    [bands, request, referenceWidth],
  );
  const problems = settingsProblems(choice, settings);
  const running = job !== null && (job.state === "queued" || job.state === "running");
  const result = results[request.output];

  useEffect(
    () => () => {
      if (poll.current) clearTimeout(poll.current);
    },
    [],
  );

  const follow = useCallback((id: string) => {
    const tick = async () => {
      try {
        const response = await fetch(`/api/export/jobs/${encodeURIComponent(id)}`, {
          cache: "no-store",
        });
        const data = (await response.json()) as {
          ok: boolean;
          job?: ExportJobView;
          error?: string;
        };
        if (!response.ok || !data.job) {
          setJob(null);
          setError(data.error ?? "Lost track of the export. Try again.");
          return;
        }
        const next = data.job;
        setJob(next);
        if (next.state === "completed") {
          setResults((current) => ({ ...current, [next.output]: { ...next, outOfDate: false } }));
          setJob(null);
          return;
        }
        if (next.state === "failed") {
          setError(next.message ?? "The export failed.");
          setJob(null);
          return;
        }
      } catch {
        // A missed poll is retried; the job keeps running on the server.
      }
      poll.current = setTimeout(tick, POLL_MS);
    };
    poll.current = setTimeout(tick, POLL_MS);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const response = await studioFetch("/api/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workId, episodeId, ...request }),
      });
      const data = (await response.json()) as { ok: boolean; job?: ExportJobView; error?: string };
      if (!response.ok || !data.job) {
        setError(data.error ?? "Could not start the export.");
        return;
      }
      setJob(data.job);
      follow(data.job.id);
    } catch {
      setError("Could not reach Toony. Check that it is still running.");
    }
  }, [workId, episodeId, request, follow]);

  const update = <K extends keyof OutputSettings>(key: K, patch: Partial<OutputSettings[K]>) =>
    setSettings((current) => ({ ...current, [key]: { ...current[key], ...patch } }));

  const info = OUTPUT_CHOICES.find((entry) => entry.id === choice) ?? OUTPUT_CHOICES[0];

  return (
    <div className="export-layout" data-testid="export-panel">
      <fieldset className="export-outputs" disabled={running}>
        <legend className="card-title">Outputs</legend>
        {OUTPUT_CHOICES.map((entry) => {
          const has =
            entry.id === "instagram"
              ? (results.instagram ?? results["instagram-square"])
              : results[entry.id];
          return (
            <label
              key={entry.id}
              className="export-output"
              data-selected={entry.id === choice}
              data-testid={`output-${entry.id}`}
            >
              <input
                type="radio"
                name="export-output"
                value={entry.id}
                checked={entry.id === choice}
                onChange={() => {
                  setChoice(entry.id);
                  setError(null);
                }}
              />
              <span className="export-output-text">
                <span className="export-output-title">
                  {entry.title}
                  {has ? (
                    <span className="export-output-done" title="Exported">
                      <StudioIcon name="check" />
                    </span>
                  ) : null}
                </span>
                <span className="export-output-description">{entry.description}</span>
              </span>
            </label>
          );
        })}
      </fieldset>

      <div className="export-main">
        <section className="card export-setup" aria-labelledby="export-setup-title">
          <div className="export-setup-head">
            <h2 className="section-title" id="export-setup-title">
              {info?.title}
            </h2>
            <span className="export-summary" data-testid="export-plan-summary">
              {planSummary(plan)}
            </span>
          </div>

          <OutputOptions
            choice={choice}
            settings={settings}
            problems={problems}
            disabled={running}
            update={update}
          />

          <LayoutPreview plan={plan} bands={bands} items={items} />

          <Notes plan={plan} />

          <div className="export-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={start}
              disabled={running || Object.keys(problems).length > 0 || plan.files.length === 0}
              data-testid="run-export"
            >
              <StudioIcon name="export" />
              {running ? "Exporting…" : result ? "Export again" : "Export"}
            </button>
            {running && job ? <Progress job={job} /> : null}
            {error ? (
              <p className="export-error" role="alert" data-testid="export-error">
                {error}
              </p>
            ) : null}
          </div>
        </section>

        {result ? (
          <Results
            result={result}
            running={running}
            shownNotes={new Set(plan.warnings.map((warning) => warning.message))}
          />
        ) : null}
      </div>
    </div>
  );
}

function OutputOptions({
  choice,
  settings,
  problems,
  disabled,
  update,
}: {
  choice: OutputChoice;
  settings: OutputSettings;
  problems: Record<string, string>;
  disabled: boolean;
  update: <K extends keyof OutputSettings>(key: K, patch: Partial<OutputSettings[K]>) => void;
}) {
  const ids = useId();
  const number = (value: string) => (value.trim() === "" ? Number.NaN : Number(value));
  const field = (label: string, key: string, control: ReactNode, hint?: string) => (
    <div className="field export-field">
      <label htmlFor={`${ids}-${key}`}>{label}</label>
      {control}
      {problems[key] ? (
        <small className="export-field-problem">{problems[key]}</small>
      ) : hint ? (
        <small className="field-hint">{hint}</small>
      ) : null}
    </div>
  );
  const tall = (value: "split" | "fit", onChange: (next: "split" | "fit") => void) => (
    <Segmented
      label="Tall cuts"
      value={value}
      disabled={disabled}
      options={[
        { value: "split", label: "Split into rows" },
        { value: "fit", label: "Fit whole" },
      ]}
      onChange={onChange}
      hint={value === "fit" ? "Shrinks a tall cut to fit when its text stays readable." : undefined}
    />
  );

  if (choice === "strip") {
    return (
      <div className="export-options" data-testid="export-options">
        {field(
          "Width (px)",
          "width",
          <input
            id={`${ids}-width`}
            type="number"
            min={1}
            max={100000}
            step={10}
            value={Number.isNaN(settings.strip.width) ? "" : settings.strip.width}
            disabled={disabled}
            aria-invalid={Boolean(problems.width)}
            onChange={(e) => update("strip", { width: number(e.target.value) })}
            data-testid="export-width"
          />,
        )}
        <div className="field export-field">
          <label className="export-check">
            <input
              type="checkbox"
              checked={settings.strip.split}
              disabled={disabled}
              onChange={(e) => update("strip", { split: e.target.checked })}
              data-testid="export-split"
            />
            <span>Split into parts</span>
          </label>
          <input
            type="number"
            min={64}
            max={100000}
            step={10}
            aria-label="Part height (px)"
            value={Number.isNaN(settings.strip.partHeight) ? "" : settings.strip.partHeight}
            disabled={disabled || !settings.strip.split}
            aria-invalid={Boolean(problems.partHeight)}
            onChange={(e) => update("strip", { partHeight: number(e.target.value) })}
            data-testid="export-part-height"
          />
          {problems.partHeight ? (
            <small className="export-field-problem">{problems.partHeight}</small>
          ) : (
            <small className="field-hint">Part height in px. Parts break between cuts.</small>
          )}
        </div>
      </div>
    );
  }
  if (choice === "cuts") {
    return (
      <div className="export-options" data-testid="export-options">
        {field(
          "Width (px)",
          "width",
          <input
            id={`${ids}-width`}
            type="number"
            min={1}
            max={100000}
            step={10}
            value={Number.isNaN(settings.cuts.width) ? "" : settings.cuts.width}
            disabled={disabled}
            aria-invalid={Boolean(problems.width)}
            onChange={(e) => update("cuts", { width: number(e.target.value) })}
            data-testid="export-width"
          />,
        )}
        {field(
          "Margin (px)",
          "margin",
          <input
            id={`${ids}-margin`}
            type="number"
            min={0}
            max={10000}
            step={2}
            value={Number.isNaN(settings.cuts.margin) ? "" : settings.cuts.margin}
            disabled={disabled}
            aria-invalid={Boolean(problems.margin)}
            onChange={(e) => update("cuts", { margin: number(e.target.value) })}
            data-testid="export-margin"
          />,
          "White space around each cut.",
        )}
        <div className="field export-field">
          <span>Text cards</span>
          <label className="export-check">
            <input
              type="checkbox"
              checked={settings.cuts.textCards}
              disabled={disabled}
              onChange={(e) => update("cuts", { textCards: e.target.checked })}
              data-testid="export-text-cards"
            />
            <span>Include as their own images</span>
          </label>
        </div>
      </div>
    );
  }
  if (choice === "instagram") {
    return (
      <div className="export-options" data-testid="export-options">
        <Segmented
          label="Shape"
          value={settings.instagram.shape}
          disabled={disabled}
          options={[
            { value: "portrait", label: "Portrait 4:5" },
            { value: "square", label: "Square 1:1" },
          ]}
          onChange={(shape) => update("instagram", { shape })}
        />
        {tall(settings.instagram.tallCuts, (tallCuts) => update("instagram", { tallCuts }))}
      </div>
    );
  }
  if (choice === "x") {
    return (
      <div className="export-options" data-testid="export-options">
        {tall(settings.x.tallCuts, (tallCuts) => update("x", { tallCuts }))}
      </div>
    );
  }
  return (
    <p className="field-hint export-fixed" data-testid="export-options">
      800 px wide, cut into parts of up to 1280 px between cuts. JPEG, quality 90.
    </p>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  disabled: boolean;
  onChange: (value: T) => void;
  hint?: string;
}) {
  return (
    <fieldset className="field export-field export-segmented" disabled={disabled}>
      <legend>{label}</legend>
      <div className="export-segments">
        {options.map((option) => (
          <label key={option.value} data-selected={option.value === value}>
            <input
              type="radio"
              name={`export-${label}`}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {hint ? <small className="field-hint">{hint}</small> : null}
    </fieldset>
  );
}

const THUMB_WIDTH = 92;
const THUMB_WIDE = 148;
const THUMB_HEIGHT_MAX = 300;

/** A small drawing of each file the export will write: art, panels and cards in place. */
function LayoutPreview({
  plan,
  bands,
  items,
}: {
  plan: LayoutPlan;
  bands: readonly LayoutBand[];
  items: readonly PreviewItem[];
}) {
  const art = useMemo(
    () =>
      new Map(
        items.flatMap((item) =>
          item.type === "cut" && item.art?.src ? [[item.id, item.art] as const] : [],
        ),
      ),
    [items],
  );
  const shown = plan.files.slice(0, PREVIEW_FILES_MAX);
  // One scale for every file of the plan, so parts and frames compare at a glance.
  const wide = plan.files.length > 0 && plan.files.every((file) => file.width > file.height);
  const widest = Math.max(1, ...plan.files.map((file) => file.width));
  const scale = (wide ? THUMB_WIDE : THUMB_WIDTH) / widest;
  return (
    <figure className="export-preview" data-testid="export-preview">
      <figcaption className="field-hint">
        Layout preview. Lettering appears in the files.
      </figcaption>
      {plan.files.length === 0 ? (
        <p className="empty">This episode has no cuts to export yet.</p>
      ) : (
        <div className="export-preview-strip">
          {shown.map((file, index) => (
            <PreviewFile
              // Each file starts at a different band row, which names it.
              key={`${file.pieces[0]?.band ?? "none"}:${file.pieces[0]?.top ?? 0}`}
              file={file}
              scale={scale}
              bands={bands}
              art={art}
              index={index}
              posts={plan.files.at(-1)?.post ?? 1}
            />
          ))}
          {plan.files.length > shown.length ? (
            <span className="export-preview-more">+{plan.files.length - shown.length} more</span>
          ) : null}
        </div>
      )}
    </figure>
  );
}

function PreviewFile({
  file,
  scale,
  bands,
  art,
  index,
  posts,
}: {
  file: LayoutFile;
  /** Preview px per output px. */
  scale: number;
  bands: readonly LayoutBand[];
  art: ReadonlyMap<string, CutArt>;
  index: number;
  /** How many posts the whole plan needs. */
  posts: number;
}) {
  const width = Math.max(4, Math.round(file.width * scale));
  const height = Math.max(4, Math.round(file.height * scale));
  const clipped = height > THUMB_HEIGHT_MAX;
  return (
    <div className="export-thumb-wrap">
      <div
        className="export-thumb"
        data-clipped={clipped}
        style={{ width, height: Math.min(height, THUMB_HEIGHT_MAX) }}
      >
        {file.pieces.map((piece, i) => {
          const band = bands[piece.band];
          if (!band || band.role === "spacer") return null;
          const src = band.type === "cut" ? art.get(band.id) : undefined;
          const top = piece.y * scale;
          if (top > THUMB_HEIGHT_MAX) return null;
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: pieces are positional.
              key={i}
              className="export-thumb-piece"
              data-role={band.role}
              data-art={src ? "yes" : "no"}
              style={{
                left: piece.x * scale,
                top,
                width: piece.width * scale,
                height: Math.max(1, piece.height * scale),
              }}
            >
              {src ? (
                <CutArtImage
                  art={src}
                  alt=""
                  loading="lazy"
                  style={{
                    top: -piece.top * scale,
                    width: piece.width * scale,
                    height: band.heightAt(piece.width) * scale,
                  }}
                />
              ) : band.type === "cut" && piece.height * scale >= 14 ? (
                <span>Cut {band.cutNumber}</span>
              ) : null}
            </div>
          );
        })}
      </div>
      <span className="export-thumb-label">
        {file.post !== undefined && posts > 1 ? `Post ${file.post} · ` : ""}
        {index + 1}
      </span>
    </div>
  );
}

function Notes({ plan }: { plan: LayoutPlan }) {
  if (plan.warnings.length === 0) return null;
  return (
    <ul className="export-notes" data-testid="export-notes">
      {plan.warnings.map((warning) => (
        <li key={warning.code} data-tone={warning.code === "artless-cuts" ? "warning" : "info"}>
          {warning.message}
        </li>
      ))}
    </ul>
  );
}

function Progress({ job }: { job: ExportJobView }) {
  const { done, total } = job.progress;
  return (
    <div className="export-progress" role="status" data-testid="export-progress">
      <progress max={Math.max(1, total)} value={done} />
      <span>
        {job.state === "queued" && job.message
          ? job.message
          : total > 0
            ? `Rendering ${done} of ${total} steps`
            : "Starting…"}
      </span>
    </div>
  );
}

const EXPORTED_AT = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

function Results({
  result,
  running,
  shownNotes,
}: {
  result: Result;
  running: boolean;
  /** Notes the setup card already shows; the results do not repeat them. */
  shownNotes: ReadonlySet<string>;
}) {
  const files = result.files ?? [];
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  const posts = new Map<number, typeof files>();
  for (const file of files) {
    const post = file.post ?? 0;
    posts.set(post, [...(posts.get(post) ?? []), file]);
  }
  const when = result.finishedAt ? EXPORTED_AT.format(new Date(result.finishedAt)) : null;
  const notes = (result.warnings ?? []).filter((warning) => !shownNotes.has(warning.message));
  return (
    <section
      className="card export-results"
      data-testid="export-result"
      aria-labelledby="export-results-title"
    >
      <div className="export-results-head">
        <div>
          <h2 className="section-title" id="export-results-title">
            Files
          </h2>
          <p className="field-hint" suppressHydrationWarning>
            {files.length} {files.length === 1 ? "image" : "images"}, {formatBytes(total)}
            {when ? ` · exported ${when}` : ""}
          </p>
        </div>
        <div className="export-results-actions">
          {result.outOfDate ? (
            <span className="chip chip-warn" title="The episode changed after this export.">
              Out of date
            </span>
          ) : null}
          {result.zipHref ? (
            <a
              className={`btn ${running ? "export-link-disabled" : ""}`}
              href={result.zipHref}
              download
              data-testid="download-all"
            >
              <StudioIcon name="download" />
              Download all (ZIP)
            </a>
          ) : null}
        </div>
      </div>

      {notes.length > 0 ? (
        <ul className="export-notes">
          {notes.map((warning) => (
            <li key={warning.code} data-tone={warning.code === "artless-cuts" ? "warning" : "info"}>
              {warning.message}
            </li>
          ))}
        </ul>
      ) : null}

      {[...posts.entries()].map(([post, group]) => (
        <div key={post} className="export-post">
          {post > 0 ? <h3 className="export-post-title">Post {post}</h3> : null}
          <ul className="export-files" data-testid="export-files">
            {group.map((file) => (
              <li key={file.name} className="export-file">
                <a
                  className="export-file-image"
                  href={file.href}
                  download
                  data-tall={file.height > file.width * 3}
                  aria-label={`Download ${file.name}`}
                >
                  {/* biome-ignore lint/performance/noImgElement: exported file served by the local download route. */}
                  <img src={file.href} alt="" loading="lazy" />
                </a>
                <div className="export-file-meta">
                  <b>{file.name}</b>
                  <span>
                    {file.width} × {file.height} · {formatBytes(file.bytes)}
                  </span>
                </div>
                <a className="export-file-download" href={file.href} download>
                  <StudioIcon name="download" />
                  Download
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <details className="export-details" data-testid="export-details">
        <summary>Details</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">File</th>
              <th scope="col">Size</th>
              <th scope="col">Bytes</th>
              <th scope="col">SHA-256</th>
            </tr>
          </thead>
          <tbody>
            {files.map((file) => (
              <tr key={file.name}>
                <td>{file.name}</td>
                <td>
                  {file.width} × {file.height}
                </td>
                <td>{file.bytes.toLocaleString()}</td>
                <td>
                  <code>{file.sha256}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="field-hint">
          {result.manifestHref ? (
            <a href={result.manifestHref} download>
              manifest.json
            </a>
          ) : null}
          {result.inputsHash ? (
            <>
              {" "}
              · Inputs <code>{result.inputsHash.slice(0, 16)}</code>
            </>
          ) : null}
        </p>
      </details>
    </section>
  );
}
