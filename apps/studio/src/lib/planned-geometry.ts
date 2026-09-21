// No raster work: the Studio report calls the exact plan/grade functions used
// by CLI plan. Pack paths are resolved server-side, never accepted from a URL.
import { readFile } from "node:fs/promises";
import {
  asCraftBand,
  comparePlanToCraftBand,
  ExportError,
  measureEpisodePlan,
  type PlanBandReport,
  type PlanMeasurement,
  type TransitionVocabularyVerdict,
  validateCraftBandValue,
} from "@toony/export";
import type { PackContent } from "@toony/packs";
import { ProjectIoError } from "@toony/project-io";

export interface PlannedGeometry {
  measurement: PlanMeasurement | null;
  report: PlanBandReport | null;
  error: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function loadPlannedGeometry(
  root: string,
  episodeId: string,
  bandId: string,
  packs: PackContent,
): Promise<PlannedGeometry> {
  let band = null;
  let error: string | null = null;
  if (bandId) {
    const file = packs.craftBands.get(bandId);
    if (!file) {
      error = `Craft band "${bandId}" is no longer available. Choose another band or no band.`;
    } else {
      try {
        const value: unknown = JSON.parse(await readFile(file, "utf8"));
        const validation = validateCraftBandValue(value);
        if (!validation.valid || !isRecord(value)) {
          error = `Craft band "${bandId}" is invalid: ${validation.issues.map((issue) => issue.message).join(" ")}`;
        } else {
          band = asCraftBand(value);
        }
      } catch {
        error = `Craft band "${bandId}" could not be read. Check its pack file or choose no band.`;
      }
    }
  }
  try {
    // A selected band's screen aspect is also CLI plan's default. Width remains
    // the shared plan default, and the actual resolved width is shown in the UI.
    const measurement = await measureEpisodePlan(root, episodeId, {
      ...(band ? { screenAspect: band.screenAspect } : {}),
    });
    return {
      measurement,
      report: band ? comparePlanToCraftBand(measurement, band) : null,
      error,
    };
  } catch (cause) {
    return {
      measurement: null,
      report: null,
      error:
        cause instanceof ExportError
          ? `Planned geometry unavailable: ${cause.message}`
          : cause instanceof ProjectIoError
            ? "Planned geometry is unavailable because the project files could not be read."
            : "Planned geometry could not be read. Check the project files and try again.",
    };
  }
}

/** Distance outside a range, in the same units as the displayed metric. */
export function rangeMiss(value: number, min: number | null, max: number | null): number {
  return min !== null && value < min ? min - value : max !== null && value > max ? value - max : 0;
}

/**
 * Presentation-ready transition-vocabulary measurements. `checkedInBand` includes
 * these verdicts, so the Studio report must expose each contributing share and
 * height result instead of leaving an aggregate failure unexplained.
 */
export interface PlannedTransitionRangeDetail {
  value: number;
  min: number | null;
  max: number | null;
  inBand: boolean;
  miss: number;
}

export interface PlannedTransitionRangeUngradedDetail {
  value: null;
  min: number | null;
  max: number | null;
  graded: false;
}

export interface PlannedTransitionVocabularyDetail {
  kinds: TransitionVocabularyVerdict["kinds"];
  count: number;
  share: PlannedTransitionRangeDetail;
  height: PlannedTransitionRangeDetail | PlannedTransitionRangeUngradedDetail | null;
  inBand: boolean;
}

export function transitionVocabularyDetails(
  report: Pick<PlanBandReport, "transitions">,
): PlannedTransitionVocabularyDetail[] {
  return report.transitions.map((entry) => ({
    kinds: entry.kinds,
    count: entry.count,
    share: {
      ...entry.share,
      miss: rangeMiss(entry.share.value, entry.share.min, entry.share.max),
    },
    height:
      entry.height !== null && "inBand" in entry.height
        ? {
            ...entry.height,
            miss: rangeMiss(entry.height.value, entry.height.min, entry.height.max),
          }
        : entry.height,
    inBand: entry.inBand,
  }));
}
