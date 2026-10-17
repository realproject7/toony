// The export preset registry: which engine `toony export <id>` runs, and the
// render options it starts from.
//
// The three engines in `./targets.ts` are the closed set — a preset selects one,
// it can never add one. What a preset opens up is NAMING a set of option
// defaults: "webtoon-tall" can mean the platform engine at 1600px JPEG q88
// without that width living in core source.
//
// The three built-in presets carry EMPTY options, so `toony export platform`
// resolves to the platform engine with no option pinned and each engine applies
// its own defaults exactly as before. With no packs installed the registry holds
// only those three and export behaves precisely as it did without the seam.

import { EXPORT_TARGET_KINDS, type ExportTargetKind } from "@toony/schema";
import type { ExportOptions } from "./targets.js";

/** A named export configuration: one built-in engine plus pinned options. */
export interface ExportPreset {
  /** The id `toony export <id>` selects. */
  id: string;
  /** Which built-in export engine runs. */
  target: ExportTargetKind;
  /**
   * Options the preset pins. An omitted option keeps the engine's own default;
   * an explicit caller option (a CLI flag) overrides the preset.
   */
  options: ExportOptions;
}

/**
 * The presets the core always provides: one per export engine, named after it,
 * with nothing pinned. These always win over a contributed preset with the same
 * id, so a pack can never change what `toony export platform` does.
 */
export const BUILTIN_EXPORT_PRESETS: readonly ExportPreset[] = EXPORT_TARGET_KINDS.map((kind) => ({
  id: kind,
  target: kind,
  options: {},
}));

function mergedPresets(contributed: readonly ExportPreset[]): ExportPreset[] {
  const builtinIds = new Set(BUILTIN_EXPORT_PRESETS.map((preset) => preset.id));
  const seen = new Set(builtinIds);
  const merged = [...BUILTIN_EXPORT_PRESETS];
  for (const preset of contributed) {
    if (seen.has(preset.id)) continue;
    seen.add(preset.id);
    merged.push(preset);
  }
  return merged;
}

/**
 * Every export preset id, built-ins first then contributed ones.
 *
 * Async because this is a registry lookup: the seam is a Promise from day one so
 * a later resolution strategy does not force a refactor of every consumer.
 */
export async function listExportPresetIds(
  contributed: readonly ExportPreset[] = [],
): Promise<string[]> {
  return mergedPresets(contributed).map((preset) => preset.id);
}

/** Resolve an export preset id, or `undefined` when nothing claims it. */
export async function resolveExportPreset(
  id: string,
  contributed: readonly ExportPreset[] = [],
): Promise<ExportPreset | undefined> {
  return mergedPresets(contributed).find((preset) => preset.id === id);
}
