// The pack manifest contract: what a pack directory may declare.
//
// A pack is DATA, never an executable plugin. Toony is local-first and a ComfyUI
// workflow is already an executable graph the operator chose to run; letting a
// pack ALSO ship JavaScript would add a second, much broader supply-chain
// surface for content people download. So the manifest below has no field that
// names a module, script, command, or hook — and `validatePackManifest` rejects
// every key it does not know, so a field like `"main"` or `"require"` cannot be
// smuggled in and silently ignored (the same allowlisting `@toony/schema` uses
// to keep provider records provider-neutral).
//
// Everything a pack contributes is therefore either a value in this manifest or
// a JSON data file the manifest points at, by a project-relative path inside the
// pack directory. Resolution reads local files only; nothing here can name a URL.

import type { ExportTargetKind } from "@toony/schema";

/** The manifest format version a pack must declare. */
export const PACK_FORMAT_VERSION = 1;

/** The manifest filename inside a pack directory. */
export const PACK_MANIFEST_FILE = "toony-pack.json";

/** Environment variable naming extra pack-root directories (path-separated). */
export const PACKS_ENV_VAR = "TOONY_PACKS";

/** Pack root inside a project/workspace folder, relative to its root. */
export const PROJECT_PACKS_DIR = ".toony/packs";

/** Output formats a pack export preset may pin. Matches `ExportOptions.format`. */
export const PACK_PRESET_FORMATS = ["png", "jpeg"] as const;
export type PackPresetFormat = (typeof PACK_PRESET_FORMATS)[number];

/** A named ComfyUI workflow graph shipped as a JSON file inside the pack. */
export interface PackWorkflowRef {
  /** The name `toony generate --workflow <name>` selects. */
  name: string;
  /** Pack-relative path to the workflow-graph JSON file. */
  file: string;
}

/** A genre scaffold: an episode bundle seeded by `toony init --genre <id>`. */
export interface PackGenreRef {
  /** The id `toony init --genre <id>` selects. */
  id: string;
  /** Human-readable label for the genre. */
  title: string;
  /** Pack-relative path to the episode-bundle JSON file. */
  file: string;
}

/** Render options a preset pins. Structurally `ExportOptions` in `@toony/export`. */
export interface PackExportOptions {
  width?: number;
  format?: PackPresetFormat;
  quality?: number;
}

/**
 * An export preset: a named set of option defaults over one built-in export
 * engine. A preset cannot add a new engine — it selects one of the three the
 * core ships and pins its render options. An option the preset omits keeps the
 * engine's own default, and an explicit CLI flag overrides the preset.
 */
export interface PackExportPreset {
  /** The id `toony export <id>` selects. */
  id: string;
  /** Which built-in export engine runs. */
  target: ExportTargetKind;
  options: PackExportOptions;
}

/** A validated `toony-pack.json`. Absent contribution lists normalize to empty. */
export interface PackManifest {
  packFormat: number;
  /** Stable pack id; also the directory name by convention. */
  id: string;
  name: string;
  description?: string;
  workflows: PackWorkflowRef[];
  genres: PackGenreRef[];
  exportPresets: PackExportPreset[];
}
