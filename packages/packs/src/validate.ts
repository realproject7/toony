// Validators for the pack format, written in `@toony/schema`'s idiom: they
// accept `unknown`, never throw, and return a `ValidationResult` whose issues
// name a path, a stable machine code, and an actionable message.
//
// Two things are validated:
//   1. `toony-pack.json` itself — a strict allowlist. Every key at every level is
//      known, or the manifest is rejected. That allowlist is the guarantee that a
//      pack cannot carry code: there is no field for a module, script, command,
//      or hook, and an unknown one is an error rather than something ignored.
//   2. A genre scaffold file — a full episode bundle, checked by the SAME
//      `@toony/schema` validators a project's own episodes go through, so a
//      scaffold that would produce an invalid project is rejected at discovery
//      with the familiar error codes.

import {
  EXPORT_LEGACY_FOLDERS,
  EXPORT_OPTION_KEYS,
  EXPORT_TARGET_ALIASES,
  EXPORT_TARGET_KINDS,
  IssueCollector,
  isArray,
  isNonEmptyString,
  isPathSafeId,
  isPlainObject,
  isProjectRelativePath,
  isString,
  joinPath,
  parseExportOptions,
  resolveExportKind,
  type ValidationResult,
  validateEpisodeBundleRecords,
  validateEpisodeValue,
  validateGutterBandWidth,
} from "@toony/schema";
import {
  PACK_FORMAT_VERSION,
  PACK_PRESET_FORMATS,
  type PackCraftBandRef,
  type PackExportPreset,
  type PackGenreRef,
  type PackLetteringThemeRef,
  type PackManifest,
  type PackStyleLexiconRef,
  type PackWorkflowRef,
} from "./manifest.js";

const PACK_MANIFEST_LABEL = "a pack manifest";

const MANIFEST_KEYS = [
  "packFormat",
  "id",
  "name",
  "description",
  "workflows",
  "genres",
  "exportPresets",
  "craftBands",
  "letteringThemes",
  "styleLexicons",
] as const;
const WORKFLOW_KEYS = ["name", "file", "reference"] as const;
const WORKFLOW_REFERENCE_KEYS = ["node", "input"] as const;
const GENRE_KEYS = [
  "id",
  "title",
  "file",
  "gutterBandWidth",
  "letteringTheme",
  "styleLexicon",
] as const;
const CRAFT_BAND_KEYS = ["id", "file"] as const;
const FILE_ENTRY_KEYS = ["id", "file"] as const;
const PRESET_KEYS = ["id", "target", "options"] as const;
const PRESET_OPTION_KEYS = EXPORT_OPTION_KEYS;

// Mirrors `@toony/schema`'s own enum helper so these validators read the same as
// the project validators they sit beside.
function isOneOf(value: unknown, allowed: readonly string[]): value is string {
  return typeof value === "string" && allowed.includes(value);
}

/**
 * Reject every key outside `allowed`. This is what makes a pack data-only: a
 * manifest that tries to declare code (`main`, `require`, `hooks`, a command…)
 * fails here instead of being silently dropped, so the rule is enforced rather
 * than merely documented.
 */
function allowlistKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  what: string,
  c: IssueCollector,
): void {
  for (const key of Object.keys(obj)) {
    if (allowed.includes(key)) continue;
    c.add(
      joinPath(path, key),
      "pack.unexpected-field",
      `${what} allows only ${allowed.map((k) => `"${k}"`).join(", ")}; remove unexpected field "${key}". A pack is data — it can never declare code, a module path, or a command.`,
    );
  }
}

/**
 * A pack-relative path to a JSON data file. Absolute paths, parent-escaping
 * paths, and anything with a URL scheme are rejected (`isProjectRelativePath`),
 * so a pack can only ever name files inside its own directory and pack
 * resolution never touches the network. The `.json` extension is required
 * because these files are read and JSON-parsed — nothing else is loadable.
 */
function validateFileRef(value: unknown, path: string, what: string, c: IssueCollector): void {
  if (!isNonEmptyString(value)) {
    c.add(path, "pack.file.required", `${what} file must be a non-empty string.`);
    return;
  }
  if (!isProjectRelativePath(value)) {
    c.add(
      path,
      "pack.file.unsafe",
      `${what} file "${value}" must be a pack-relative path (no absolute, parent-escaping, or URL paths).`,
    );
    return;
  }
  if (!value.endsWith(".json")) {
    c.add(
      path,
      "pack.file.extension",
      `${what} file "${value}" must be a .json data file; packs ship data, never loadable code.`,
    );
  }
}

/** Add an issue when `key` repeats within one contribution list. */
function checkDuplicate(
  seen: Set<string>,
  key: string,
  path: string,
  code: string,
  what: string,
  c: IssueCollector,
): void {
  if (seen.has(key)) {
    c.add(path, code, `duplicate ${what} "${key}" in this pack.`);
  }
  seen.add(key);
}

function validateWorkflows(value: unknown, path: string, c: IssueCollector): void {
  if (!isArray(value)) {
    c.add(path, "pack.workflows.type", "workflows must be an array.");
    return;
  }
  const names = new Set<string>();
  for (let i = 0; i < value.length; i++) {
    const entry = value[i];
    const entryPath = joinPath(path, i);
    if (!isPlainObject(entry)) {
      c.add(entryPath, "pack.workflow.type", "workflow entry must be an object.");
      continue;
    }
    allowlistKeys(entry, WORKFLOW_KEYS, entryPath, "a workflow entry", c);
    if (!isNonEmptyString(entry.name)) {
      c.add(
        joinPath(entryPath, "name"),
        "pack.workflow.name",
        "workflow name must be a non-empty string.",
      );
    } else {
      checkDuplicate(
        names,
        entry.name,
        joinPath(entryPath, "name"),
        "pack.workflow.duplicate",
        "workflow name",
        c,
      );
    }
    validateFileRef(entry.file, joinPath(entryPath, "file"), "workflow", c);
    if (entry.reference !== undefined) {
      const refPath = joinPath(entryPath, "reference");
      if (!isPlainObject(entry.reference)) {
        c.add(refPath, "pack.workflow.reference", "reference must be an object { node, input }.");
      } else {
        allowlistKeys(entry.reference, WORKFLOW_REFERENCE_KEYS, refPath, "a workflow reference", c);
        for (const key of WORKFLOW_REFERENCE_KEYS) {
          if (!isNonEmptyString(entry.reference[key])) {
            c.add(
              joinPath(refPath, key),
              "pack.workflow.reference",
              `reference ${key} must be a non-empty string.`,
            );
          }
        }
      }
    }
  }
}

function validateGenres(value: unknown, path: string, c: IssueCollector): void {
  if (!isArray(value)) {
    c.add(path, "pack.genres.type", "genres must be an array.");
    return;
  }
  const ids = new Set<string>();
  for (let i = 0; i < value.length; i++) {
    const entry = value[i];
    const entryPath = joinPath(path, i);
    if (!isPlainObject(entry)) {
      c.add(entryPath, "pack.genre.type", "genre entry must be an object.");
      continue;
    }
    allowlistKeys(entry, GENRE_KEYS, entryPath, "a genre entry", c);
    if (!isNonEmptyString(entry.id)) {
      c.add(joinPath(entryPath, "id"), "pack.genre.id", "genre id must be a non-empty string.");
    } else {
      checkDuplicate(
        ids,
        entry.id,
        joinPath(entryPath, "id"),
        "pack.genre.duplicate",
        "genre id",
        c,
      );
    }
    if (!isNonEmptyString(entry.title)) {
      c.add(
        joinPath(entryPath, "title"),
        "pack.genre.title",
        "genre title must be a non-empty string.",
      );
    }
    // The gutter strip this genre letters in (#215). Same bounds and wording
    // `webtoon.json` enforces, from the one shared validator, so a width a pack
    // may declare is exactly a width a project may hold — a scaffolded project
    // can never carry a number `toony validate` would then reject.
    const bandError = validateGutterBandWidth(entry.gutterBandWidth as number | undefined);
    if (bandError !== null) {
      c.add(
        joinPath(entryPath, "gutterBandWidth"),
        "pack.genre.gutter-band-width",
        `${bandError}.`,
      );
    }
    // The theme and lexicon a genre selects (#346) are ids; whether an installed
    // pack provides them is a discovery question, answered once every pack is
    // loaded, so a genre may select a theme another pack ships.
    if (entry.letteringTheme !== undefined && !isNonEmptyString(entry.letteringTheme)) {
      c.add(
        joinPath(entryPath, "letteringTheme"),
        "pack.genre.lettering-theme",
        "letteringTheme must be a non-empty string, the id of a lettering theme.",
      );
    }
    if (entry.styleLexicon !== undefined && !isNonEmptyString(entry.styleLexicon)) {
      c.add(
        joinPath(entryPath, "styleLexicon"),
        "pack.genre.style-lexicon",
        "styleLexicon must be a non-empty string, the id of a style lexicon.",
      );
    }
    validateFileRef(entry.file, joinPath(entryPath, "file"), "genre", c);
  }
}

/** An `{ id, file }` contribution list (#334, #335): unique ids, JSON files. */
function validateFileEntries(
  value: unknown,
  path: string,
  what: string,
  code: string,
  c: IssueCollector,
): void {
  if (!isArray(value)) {
    c.add(path, `${code}.type`, `${what}s must be an array.`);
    return;
  }
  const ids = new Set<string>();
  for (let i = 0; i < value.length; i++) {
    const entry = value[i];
    const entryPath = joinPath(path, i);
    if (!isPlainObject(entry)) {
      c.add(entryPath, `${code}.entry`, `${what} entry must be an object.`);
      continue;
    }
    allowlistKeys(entry, FILE_ENTRY_KEYS, entryPath, `a ${what} entry`, c);
    if (!isNonEmptyString(entry.id)) {
      c.add(joinPath(entryPath, "id"), `${code}.id`, `${what} id must be a non-empty string.`);
    } else {
      checkDuplicate(
        ids,
        entry.id,
        joinPath(entryPath, "id"),
        `${code}.duplicate`,
        `${what} id`,
        c,
      );
    }
    validateFileRef(entry.file, joinPath(entryPath, "file"), what, c);
  }
}

function validateCraftBands(value: unknown, path: string, c: IssueCollector): void {
  if (!isArray(value)) {
    c.add(path, "pack.craft-bands.type", "craftBands must be an array.");
    return;
  }
  const ids = new Set<string>();
  for (let i = 0; i < value.length; i++) {
    const entry = value[i];
    const entryPath = joinPath(path, i);
    if (!isPlainObject(entry)) {
      c.add(entryPath, "pack.craft-band.type", "craft band entry must be an object.");
      continue;
    }
    allowlistKeys(entry, CRAFT_BAND_KEYS, entryPath, "a craft band entry", c);
    if (!isNonEmptyString(entry.id)) {
      c.add(
        joinPath(entryPath, "id"),
        "pack.craft-band.id",
        "craft band id must be a non-empty string.",
      );
    } else {
      checkDuplicate(
        ids,
        entry.id,
        joinPath(entryPath, "id"),
        "pack.craft-band.duplicate",
        "craft band id",
        c,
      );
    }
    validateFileRef(entry.file, joinPath(entryPath, "file"), "craft band", c);
  }
}

function validateExportPresets(value: unknown, path: string, c: IssueCollector): void {
  if (!isArray(value)) {
    c.add(path, "pack.export-presets.type", "exportPresets must be an array.");
    return;
  }
  const ids = new Set<string>();
  for (let i = 0; i < value.length; i++) {
    const entry = value[i];
    const entryPath = joinPath(path, i);
    if (!isPlainObject(entry)) {
      c.add(entryPath, "pack.export-preset.type", "export preset entry must be an object.");
      continue;
    }
    allowlistKeys(entry, PRESET_KEYS, entryPath, "an export preset", c);
    if (!isNonEmptyString(entry.id)) {
      c.add(
        joinPath(entryPath, "id"),
        "pack.export-preset.id",
        "export preset id must be a non-empty string.",
      );
    } else {
      checkDuplicate(
        ids,
        entry.id,
        joinPath(entryPath, "id"),
        "pack.export-preset.duplicate",
        "export preset id",
        c,
      );
    }
    // A preset's id names its output folder, so it must be one safe segment.
    if (
      isNonEmptyString(entry.id) &&
      (!isPathSafeId(entry.id) || (EXPORT_LEGACY_FOLDERS as readonly string[]).includes(entry.id))
    ) {
      c.add(
        joinPath(entryPath, "id"),
        "pack.export-preset.id.unsafe",
        `export preset id "${entry.id}" must be a single folder name (letters, digits, "-" or "_") and not ${EXPORT_LEGACY_FOLDERS.join(", ")}.`,
      );
    }
    // A preset SELECTS one of the built-in export engines; it can never add one.
    if (resolveExportKind(entry.target) === null) {
      c.add(
        joinPath(entryPath, "target"),
        "pack.export-preset.target",
        `export preset target must be one of: ${EXPORT_TARGET_KINDS.join(", ")} (${Object.keys(EXPORT_TARGET_ALIASES).join(" and ")} still work).`,
      );
    }
    if (entry.options !== undefined) {
      validatePresetOptions(entry.options, joinPath(entryPath, "options"), c);
    }
  }
}

function validatePresetOptions(value: unknown, path: string, c: IssueCollector): void {
  if (!isPlainObject(value)) {
    c.add(path, "pack.export-preset.options", "export preset options must be an object.");
    return;
  }
  allowlistKeys(value, PRESET_OPTION_KEYS, path, "export preset options", c);
  // Same bounds and wording the CLI and the Studio route enforce (#87).
  // Unknown keys are reported by the allowlist above; the format is checked
  // against the exact spellings a pack may use.
  for (const problem of parseExportOptions(value).problems) {
    if (
      problem.key === "format" ||
      !(PRESET_OPTION_KEYS as readonly string[]).includes(problem.key)
    ) {
      continue;
    }
    c.add(joinPath(path, problem.key), `pack.export-preset.${problem.key}`, `${problem.message}.`);
  }
  if (value.format !== undefined && !isOneOf(value.format, PACK_PRESET_FORMATS)) {
    c.add(
      joinPath(path, "format"),
      "pack.export-preset.format",
      `export preset format must be one of: ${PACK_PRESET_FORMATS.join(", ")}.`,
    );
  }
}

/** Validate a parsed `toony-pack.json`. Never throws. */
export function validatePackManifest(value: unknown): ValidationResult {
  const c = new IssueCollector();
  if (!isPlainObject(value)) {
    c.add("pack", "pack.type", `${PACK_MANIFEST_LABEL} must be a JSON object.`);
    return c.result();
  }

  allowlistKeys(value, MANIFEST_KEYS, "pack", PACK_MANIFEST_LABEL, c);

  if (value.packFormat !== PACK_FORMAT_VERSION) {
    c.add("pack.packFormat", "pack.format-version", `packFormat must be ${PACK_FORMAT_VERSION}.`);
  }
  // The id namespaces a pack's contributions and appears in every message about
  // it, so it must be a single safe path segment like an episode id.
  if (!isNonEmptyString(value.id)) {
    c.add("pack.id", "pack.id", "pack id must be a non-empty string.");
  } else if (!isPathSafeId(value.id)) {
    c.add(
      "pack.id",
      "pack.id.unsafe",
      "pack id must be a path-safe segment (no /, \\, NUL, or . / .. traversal).",
    );
  }
  if (!isNonEmptyString(value.name)) {
    c.add("pack.name", "pack.name", "pack name must be a non-empty string.");
  }
  if (value.description !== undefined && !isString(value.description)) {
    c.add("pack.description", "pack.description", "description must be a string.");
  }

  // Each contribution list is optional; absent means "contributes none".
  if (value.workflows !== undefined) validateWorkflows(value.workflows, "pack.workflows", c);
  if (value.letteringThemes !== undefined) {
    validateFileEntries(
      value.letteringThemes,
      "pack.letteringThemes",
      "lettering theme",
      "pack.lettering-theme",
      c,
    );
  }
  if (value.styleLexicons !== undefined) {
    validateFileEntries(
      value.styleLexicons,
      "pack.styleLexicons",
      "style lexicon",
      "pack.style-lexicon",
      c,
    );
  }
  if (value.genres !== undefined) validateGenres(value.genres, "pack.genres", c);
  if (value.exportPresets !== undefined) {
    validateExportPresets(value.exportPresets, "pack.exportPresets", c);
  }
  if (value.craftBands !== undefined) validateCraftBands(value.craftBands, "pack.craftBands", c);

  return c.result();
}

/**
 * Narrow an already-validated manifest value, normalizing absent contribution
 * lists to empty arrays and absent preset options to an empty options object
 * (so a preset is directly usable as an export registry entry). Only call this
 * when `validatePackManifest` returned a valid result.
 */
export function asPackManifest(value: Record<string, unknown>): PackManifest {
  const presets = (value.exportPresets as PackExportPreset[] | undefined) ?? [];
  return {
    packFormat: value.packFormat as number,
    id: value.id as string,
    name: value.name as string,
    ...(typeof value.description === "string" ? { description: value.description } : {}),
    workflows: (value.workflows as PackWorkflowRef[] | undefined) ?? [],
    letteringThemes: (value.letteringThemes as PackLetteringThemeRef[] | undefined) ?? [],
    styleLexicons: (value.styleLexicons as PackStyleLexiconRef[] | undefined) ?? [],
    genres: (value.genres as PackGenreRef[] | undefined) ?? [],
    exportPresets: presets.map((preset) => ({ ...preset, options: preset.options ?? {} })),
    craftBands: (value.craftBands as PackCraftBandRef[] | undefined) ?? [],
  };
}

/**
 * Validate a genre scaffold file: a full episode bundle. Checked by the same
 * `@toony/schema` validators a project's own episodes go through, so a pack
 * cannot contribute a scaffold that `toony validate` would then reject.
 */
export function validateGenreScaffold(value: unknown): ValidationResult {
  const c = new IssueCollector();
  if (!isPlainObject(value)) {
    c.add("scaffold", "pack.scaffold.type", "a genre scaffold must be a JSON object.");
    return c.result();
  }
  validateEpisodeValue(value.episode, "scaffold.episode", c);
  validateEpisodeBundleRecords(value, "scaffold", c);
  return c.result();
}
