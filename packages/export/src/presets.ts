// The export preset registry: which engine `toony export --output <id>` runs,
// and the options it starts from.
//
// The three engines (strip, cuts, social) are the closed set: a preset selects
// one, it can never add one. A preset NAMES a set of option defaults, so
// "webtoon" can mean the strip engine at 800 px, cut into 1280 px JPEG parts,
// without that combination living in caller code. The built-in outputs are
// presets too; packs may contribute more. `stitched` and `platform` are kept as
// aliases of `strip` and `cuts`.

import { type ExportTargetKind, type ExportTargetName, resolveExportKind } from "@toony/schema";
import { BUILTIN_OUTPUTS, OUTPUT_ALIASES } from "./defaults.js";
import type { ExportOptions } from "./outputs.js";

/** A named export configuration: one built-in engine plus pinned options. */
export interface ExportPreset {
  /** The id `toony export --output <id>` selects; also the output folder name. */
  id: string;
  /** Which built-in export engine runs. */
  target: ExportTargetKind;
  /**
   * Options the preset pins. An omitted option keeps the engine's own default;
   * an explicit caller option (a CLI flag) overrides the preset.
   */
  options: ExportOptions;
}

/** A preset as a pack contributes it: the engine may use an accepted alias. */
export interface ContributedExportPreset {
  id: string;
  target: ExportTargetName;
  options: ExportOptions;
}

/**
 * The presets the core always provides. These always win over a contributed
 * preset with the same id (or an alias), so a pack can never change what a
 * built-in output does.
 */
export const BUILTIN_EXPORT_PRESETS: readonly ExportPreset[] = BUILTIN_OUTPUTS.map((output) => ({
  id: output.id,
  target: output.kind,
  options: { ...output.options },
}));

function mergedPresets(contributed: readonly ContributedExportPreset[]): ExportPreset[] {
  const reserved = new Set([
    ...BUILTIN_EXPORT_PRESETS.map((preset) => preset.id),
    ...Object.keys(OUTPUT_ALIASES),
  ]);
  const merged = [...BUILTIN_EXPORT_PRESETS];
  for (const preset of contributed) {
    const target = resolveExportKind(preset.target);
    if (target === null || reserved.has(preset.id)) continue;
    reserved.add(preset.id);
    merged.push({ id: preset.id, target, options: { ...preset.options } });
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
  contributed: readonly ContributedExportPreset[] = [],
): Promise<string[]> {
  return mergedPresets(contributed).map((preset) => preset.id);
}

/**
 * Resolve an export preset id (or the alias `stitched` / `platform`), or
 * `undefined` when nothing claims it.
 */
export async function resolveExportPreset(
  id: string,
  contributed: readonly ContributedExportPreset[] = [],
): Promise<ExportPreset | undefined> {
  const canonical = Object.hasOwn(OUTPUT_ALIASES, id) ? (OUTPUT_ALIASES[id] as string) : id;
  return mergedPresets(contributed).find((preset) => preset.id === canonical);
}
