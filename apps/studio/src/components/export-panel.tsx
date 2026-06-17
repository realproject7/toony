"use client";

// Export panel for the export screen (issue #53).
//
// Drives the existing headless export engine through `/api/export`: the operator
// picks a target (platform / stitched / PlotLink-ready), sets width / format /
// quality where the target supports them, and runs it. The panel then renders the
// engine's OWN manifest (files, dimensions, byte sizes, checksums) and the
// constraint/pre-flight results the route derives from that manifest — it does
// not recompute any constraint. A re-export button re-runs the current target,
// and the engine's actionable errors (e.g. PlotLink markdown too short) are shown
// verbatim. No state is persisted here; the engine writes the real output on disk.

import type { ExportManifest, ManifestFile } from "@toony/export";
import { useCallback, useMemo, useState } from "react";
import { type ConstraintCheck, formatBytes } from "@/lib/export-view";

type TargetKind = "platform" | "stitched" | "plotlink";

interface TargetSpec {
  kind: TargetKind;
  title: string;
  blurb: string;
  /** Whether the PNG/JPEG format selector applies to this target. */
  supportsFormat: boolean;
  /**
   * Whether a quality value is sent to (and honored by) the engine for this
   * target. Platform/stitched honor it only for JPEG; PlotLink always encodes
   * WebP and honors quality as the encode's starting quality. PNG ignores it.
   */
  supportsQuality: boolean;
  defaultWidth: number;
}

// Defaults mirror the engine's per-target defaults so the controls open at the
// values the engine would otherwise apply.
const TARGETS = [
  {
    kind: "platform",
    title: "Platform sequence",
    blurb: "One image per cut, in reading order.",
    supportsFormat: true,
    supportsQuality: true,
    defaultWidth: 1200,
  },
  {
    kind: "stitched",
    title: "Stitched strip",
    blurb: "A single tall image: cuts, gutters, transitions, lettering.",
    supportsFormat: true,
    supportsQuality: true,
    defaultWidth: 1200,
  },
  {
    kind: "plotlink",
    title: "PlotLink-ready",
    blurb: "WebP package (≤20 images, ≤1 MB each) plus generated markdown.",
    supportsFormat: false,
    supportsQuality: true,
    defaultWidth: 800,
  },
] as const satisfies readonly TargetSpec[];

interface SuccessResult {
  manifest: ExportManifest;
  checks: ConstraintCheck[];
  outDir: string;
}

interface ApiResponse {
  ok: boolean;
  error?: string;
  code?: string;
  manifest?: ExportManifest;
  checks?: ConstraintCheck[];
  outDir?: string;
}

export interface ExportPanelProps {
  workId: string;
  episodeId: string;
}

export function ExportPanel({ workId, episodeId }: ExportPanelProps) {
  const [target, setTarget] = useState<TargetKind>("platform");
  const [width, setWidth] = useState<number>(1200);
  const [format, setFormat] = useState<"png" | "jpeg">("png");
  const [quality, setQuality] = useState<number>(82);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [result, setResult] = useState<SuccessResult | null>(null);

  const spec: TargetSpec = useMemo(
    () => TARGETS.find((t) => t.kind === target) ?? TARGETS[0],
    [target],
  );

  // Quality is meaningful (and honored by the engine) for PlotLink's WebP encode
  // and for JPEG on the platform/stitched targets. PNG ignores it, so the control
  // is hidden — and never sent — when it would have no effect.
  const qualityApplies = useMemo(
    () => spec.supportsQuality && (target === "plotlink" || format === "jpeg"),
    [spec, target, format],
  );

  const selectTarget = useCallback((next: TargetSpec) => {
    setTarget(next.kind);
    setWidth(next.defaultWidth);
    setResult(null);
    setError(null);
  }, []);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { workId, episodeId, target, width };
      if (spec.supportsFormat) body.format = format;
      // Send quality only when it actually affects the output (PlotLink WebP, or
      // JPEG on platform/stitched). For PNG the engine ignores it, so it is not
      // sent — the control matches behavior (#86).
      if (qualityApplies) body.quality = quality;
      const response = await fetch("/api/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as ApiResponse;
      if (!response.ok || !data.ok || !data.manifest || !data.checks || data.outDir === undefined) {
        setResult(null);
        setError({ message: data.error ?? "Export failed.", code: data.code });
        return;
      }
      setResult({ manifest: data.manifest, checks: data.checks, outDir: data.outDir });
    } catch (cause) {
      setResult(null);
      setError({ message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setBusy(false);
    }
  }, [workId, episodeId, target, width, format, quality, spec, qualityApplies]);

  return (
    <section className="export-panel" data-testid="export-panel">
      <div className="card export-card">
        <h2 className="card-title">Format &amp; target</h2>
        <div className="export-targets" role="radiogroup" aria-label="Export target">
          {TARGETS.map((t) => (
            <button
              type="button"
              key={t.kind}
              className={`export-target ${t.kind === target ? "export-target-active" : ""}`}
              aria-pressed={t.kind === target}
              onClick={() => selectTarget(t)}
              disabled={busy}
              data-testid={`target-${t.kind}`}
            >
              <span className="export-target-title">{t.title}</span>
              <span className="export-target-blurb">{t.blurb}</span>
            </button>
          ))}
        </div>

        <div className="export-options">
          <label className="field">
            <span>Width (px)</span>
            <input
              type="number"
              min={1}
              max={100000}
              step={50}
              value={width}
              disabled={busy}
              onChange={(e) => setWidth(Number(e.target.value))}
              data-testid="export-width"
            />
          </label>

          {spec.supportsFormat ? (
            <label className="field">
              <span>Format</span>
              <select
                value={format}
                disabled={busy}
                onChange={(e) => setFormat(e.target.value === "jpeg" ? "jpeg" : "png")}
                data-testid="export-format"
              >
                <option value="png">PNG (lossless)</option>
                <option value="jpeg">JPEG</option>
              </select>
            </label>
          ) : (
            <label className="field">
              <span>Format</span>
              <input
                type="text"
                value="WebP (fixed)"
                disabled
                readOnly
                data-testid="export-format-fixed"
              />
            </label>
          )}

          {qualityApplies ? (
            <label className="field">
              <span>Quality (0–100)</span>
              <input
                type="number"
                min={0}
                max={100}
                value={quality}
                disabled={busy}
                onChange={(e) => setQuality(Number(e.target.value))}
                data-testid="export-quality"
              />
            </label>
          ) : null}
        </div>

        <div className="editor-actions export-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={run}
            disabled={busy}
            data-testid="run-export"
          >
            {busy ? "Exporting…" : result ? "Re-export" : "Export episode"}
          </button>
          {error && (
            <span className="new-work-error" role="alert" data-testid="export-error">
              {error.code ? `${error.code}: ` : ""}
              {error.message}
            </span>
          )}
        </div>
      </div>

      {result && <ExportResult result={result} />}
    </section>
  );
}

function ExportResult({ result }: { result: SuccessResult }) {
  const { manifest, checks, outDir } = result;
  return (
    <div className="card export-result" data-testid="export-result">
      <div className="export-result-head">
        <h2 className="card-title">Pre-flight checks</h2>
        <span className="chip chip-ok" data-testid="export-target-kind">
          {manifest.target}
        </span>
      </div>

      <ul className="export-checks" data-testid="export-checks">
        {checks.map((check) => (
          <li className="export-check" key={check.id} data-status={check.status}>
            <span className={`chip ${check.status === "pass" ? "chip-ok" : "chip-warn"}`}>
              {check.status === "pass" ? "PASS" : "REVIEW"}
            </span>
            <span className="export-check-body">
              <b>{check.label}</b>
              <span className="export-check-detail">{check.detail}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="export-output" data-testid="export-output-path">
        <span className="field-hint">Saved to</span>
        <code>{outDir}</code>
      </div>

      <h3 className="section-title">Manifest</h3>
      <div className="export-manifest-meta">
        <span>
          Project <code>{manifest.projectId}</code>
        </span>
        <span>
          Episode <code>{manifest.episodeId}</code>
        </span>
        <span>
          Width <b>{manifest.width}px</b>
        </span>
        <span>
          Schema v<b>{manifest.manifestVersion}</b>
        </span>
      </div>

      <div className="export-files" data-testid="export-files">
        {manifest.files.map((file) => (
          <ManifestFileRow key={file.path} file={file} />
        ))}
      </div>

      {manifest.markdown && (
        <div className="export-markdown" data-testid="export-markdown">
          <h3 className="section-title">Generated markdown</h3>
          <div className="export-file-row">
            <code className="export-file-path">{manifest.markdown.path}</code>
            <span className="export-file-meta">{manifest.markdown.characters} chars</span>
            <span className="export-file-sha" title={manifest.markdown.sha256}>
              {manifest.markdown.sha256.slice(0, 12)}…
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function ManifestFileRow({ file }: { file: ManifestFile }) {
  return (
    <div className="export-file-row">
      <code className="export-file-path">{file.path}</code>
      <span className="export-file-meta">
        {file.format.toUpperCase()} · {file.width}×{file.height} · {formatBytes(file.byteSize)}
        {file.quality !== null ? ` · q${file.quality}` : ""}
      </span>
      <span className="export-file-sha" title={file.sha256}>
        {file.sha256.slice(0, 12)}…
      </span>
    </div>
  );
}
