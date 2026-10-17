// Server-rendered planned geometry report (#242). It deliberately uses a GET
// form: selecting a band is view state, not project metadata, so no band name
// is guessed from a genre or persisted into the project's schema.

import type { PlanBandReport, PlanMeasurement } from "@toony/export";
import { rangeMiss, transitionVocabularyDetails } from "@/lib/planned-geometry";

interface BandOption {
  id: string;
  title: string;
}

interface PlannedGeometryReportProps {
  bands: readonly BandOption[];
  selectedBandId: string;
  measurement: PlanMeasurement | null;
  report: PlanBandReport | null;
  error: string | null;
}

const METRICS = [
  ["gutterRatio", "Gutter ratio", "ratio"],
  ["gutterMedian", "Median gutter", "column widths"],
  ["panelHeightMedian", "Median panel height", "column widths"],
  ["panelHeightSpread", "Panel height spread", "column widths"],
  ["panelsPerScreen", "Panels per screen", "panels"],
] as const;

function number(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function range(min: number | null, max: number | null): string {
  if (min !== null && max !== null) return `${number(min)} to ${number(max)}`;
  if (min !== null) return `${number(min)} or more`;
  if (max !== null) return `${number(max)} or less`;
  return "Recorded only";
}

export function PlannedGeometryReport({
  bands,
  selectedBandId,
  measurement,
  report,
  error,
}: PlannedGeometryReportProps) {
  const selected = selectedBandId !== "";
  const ungraded = report !== null && "graded" in report && report.graded === false;
  const gradedReport = report !== null && !("graded" in report) ? report : null;

  return (
    <section className="planned-geometry" data-testid="planned-geometry">
      <div className="planned-geometry-head">
        <div>
          <h2 className="card-title">Planned geometry</h2>
          <p className="planned-geometry-summary">
            Declared cuts and transitions only. It does not render or inspect artwork.
          </p>
        </div>
        {gradedReport && (
          <span className={gradedReport.checkedInBand ? "chip chip-ok" : "chip chip-danger"}>
            {gradedReport.checkedInBand
              ? "Checked plan measures in band"
              : "Checked plan measures out of band"}
          </span>
        )}
        {ungraded && <span className="chip chip-warn">Not graded</span>}
      </div>

      <form className="planned-geometry-picker" method="get" data-testid="planned-geometry-picker">
        <label htmlFor="craft-band">Craft band</label>
        <select id="craft-band" name="band" defaultValue={selectedBandId}>
          <option value="">No band, record geometry only</option>
          {bands.map((band) => (
            <option key={band.id} value={band.id}>
              {band.title}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-ghost">
          Update
        </button>
      </form>
      {selected && !bands.some((band) => band.id === selectedBandId) && (
        <p className="planned-geometry-error">The selected craft band is no longer available.</p>
      )}
      {error && <p className="planned-geometry-error">{error}</p>}

      {measurement === null ? (
        <p className="planned-geometry-error">{error ?? "Planned geometry is unavailable."}</p>
      ) : (
        <>
          <p className="planned-geometry-meta">
            {measurement.cuts} cuts at {measurement.width}px, {measurement.height}px planned height.
            {measurement.cutsWithoutDeclaredShape > 0 && (
              <>
                {" "}
                {measurement.cutsWithoutDeclaredShape} use the {number(measurement.fallbackAspect)}{" "}
                fallback aspect.
              </>
            )}
          </p>
          <div className="planned-geometry-table-wrap">
            <table className="planned-geometry-table">
              <thead>
                <tr>
                  <th scope="col">Metric</th>
                  <th scope="col">Planned</th>
                  <th scope="col">Band</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {METRICS.map(([metric, label, unit]) => {
                  const value = measurement.metrics[metric];
                  const graded = report?.metrics.find((entry) => entry.metric === metric);
                  const recorded = report?.recorded.find((entry) => entry.metric === metric);
                  const miss = graded ? rangeMiss(value, graded.min, graded.max) : 0;
                  return (
                    <tr key={metric}>
                      <th scope="row">{label}</th>
                      <td>
                        {number(value)} {unit}
                      </td>
                      <td>
                        {graded
                          ? range(graded.min, graded.max)
                          : recorded
                            ? `Recorded: ${range(recorded.min, recorded.max)}`
                            : "Not in this band"}
                      </td>
                      <td>
                        {graded ? (
                          graded.inBand ? (
                            <span className="chip chip-ok">In band</span>
                          ) : (
                            <span className="chip chip-danger">Misses by {number(miss)}</span>
                          )
                        ) : recorded ? (
                          "Recorded, not graded"
                        ) : (
                          "Not graded"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {report && transitionVocabularyDetails(report).length > 0 && (
            <section
              className="planned-geometry-transitions"
              aria-labelledby="planned-transition-vocabulary"
              data-testid="planned-transition-vocabulary"
            >
              <h3 id="planned-transition-vocabulary">Declared transition vocabulary</h3>
              <p className="planned-geometry-summary">
                These share and height checks are included in the checked plan result above.
              </p>
              <div className="planned-geometry-table-wrap">
                <table className="planned-geometry-table">
                  <thead>
                    <tr>
                      <th scope="col">Declared kinds</th>
                      <th scope="col">Drawn gaps</th>
                      <th scope="col">Share</th>
                      <th scope="col">Median height</th>
                      <th scope="col">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transitionVocabularyDetails(report).map((entry) => {
                      const height = entry.height;
                      const gradedHeight = height !== null && "inBand" in height ? height : null;
                      return (
                        <tr key={entry.kinds.join(",")}>
                          <th scope="row">{entry.kinds.join(", ")}</th>
                          <td>{entry.count}</td>
                          <td>
                            {number(entry.share.value)} of all drawn gaps
                            <br />
                            <span className="planned-geometry-detail">
                              Band: {range(entry.share.min, entry.share.max)}
                            </span>
                          </td>
                          <td>
                            {height === null ? (
                              "Not declared"
                            ) : gradedHeight ? (
                              <>
                                {number(gradedHeight.value)} column widths
                                <br />
                                <span className="planned-geometry-detail">
                                  Band: {range(gradedHeight.min, gradedHeight.max)}
                                </span>
                              </>
                            ) : (
                              <>
                                No matching drawn gaps
                                <br />
                                <span className="planned-geometry-detail">
                                  Height not graded; band: {range(height.min, height.max)}
                                </span>
                              </>
                            )}
                          </td>
                          <td className="planned-geometry-transition-results">
                            <span
                              className={entry.share.inBand ? "chip chip-ok" : "chip chip-danger"}
                            >
                              {entry.share.inBand
                                ? "Share in band"
                                : `Share misses by ${number(entry.share.miss)}`}
                            </span>
                            {gradedHeight && (
                              <span
                                className={
                                  gradedHeight.inBand ? "chip chip-ok" : "chip chip-danger"
                                }
                              >
                                {gradedHeight.inBand
                                  ? "Height in band"
                                  : `Height misses by ${number(gradedHeight.miss)}`}
                              </span>
                            )}
                            {!gradedHeight && height !== null && (
                              <span className="planned-geometry-detail">Height not graded</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {report && report.unchecked.length > 0 && (
            <p className="planned-geometry-summary">
              This band also grades metrics unavailable from a plan:{" "}
              {report.unchecked.map((entry) => entry.metric).join(", ")}.
            </p>
          )}
          <details className="planned-geometry-limitations">
            <summary>Unavailable without rendered artwork</summary>
            <ul>
              {measurement.unchecked.map((entry) => (
                <li key={entry.metric}>
                  <b>{entry.metric}</b>: {entry.reason}
                </li>
              ))}
            </ul>
          </details>
          {ungraded && (
            <p className="planned-geometry-summary">
              This band has no metric a plan can grade. It is not an overall pass or fail.
            </p>
          )}
        </>
      )}
    </section>
  );
}
