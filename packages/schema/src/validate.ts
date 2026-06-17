// Structural and cross-file validators for Toony projects.
//
// Validators accept `unknown` and never throw; they return a ValidationResult
// whose issues are actionable. #4 owns structural validity, schema conformance,
// canonical ordering, duplicate ids, missing records, and referential integrity.
// #11 consumes these validators for production-readiness linting.

import { IssueCollector, joinPath, type ValidationResult } from "./errors.js";
import {
  isArray,
  isBoolean,
  isFiniteNumber,
  isInteger,
  isNonEmptyString,
  isNormalizedUnit,
  isPlainObject,
  isString,
} from "./guards.js";
import { isPathSafeId } from "./path-safe-id.js";
import {
  BUBBLE_KINDS,
  CORNER_RADIUS_MAX_PX,
  CORNER_RADIUS_MIN_PX,
  FONT_FAMILY_IDS,
  FONT_SIZE_MAX_PX,
  FONT_SIZE_MIN_PX,
  FONT_WEIGHTS,
  GUTTER_HEIGHT_MAX_PX,
  GUTTER_HEIGHT_MIN_PX,
  LETTER_SPACING_MAX_EM,
  LETTER_SPACING_MIN_EM,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
  MANUAL_PROVIDER_ID,
  REVIEW_STATUSES,
  SCHEMA_VERSION,
  TEXT_ALIGNS,
  TRANSITION_TYPES,
} from "./types.js";

function isOneOf(value: unknown, allowed: readonly string[]): value is string {
  return typeof value === "string" && allowed.includes(value);
}

/** Reject absolute or parent-escaping paths so asset references stay project-relative. */
export function isProjectRelativePath(value: string): boolean {
  if (value.length === 0) return false;
  if (value.startsWith("/") || value.startsWith("\\")) return false;
  if (/^[A-Za-z]:[\\/]/.test(value)) return false;
  if (value.includes("://")) return false;
  const segments = value.split(/[\\/]/);
  return !segments.includes("..");
}

function requireSchemaVersion(value: unknown, path: string, c: IssueCollector): void {
  if (value !== SCHEMA_VERSION) {
    c.add(
      joinPath(path, "schemaVersion"),
      "schema-version.unsupported",
      `schemaVersion must be ${SCHEMA_VERSION}.`,
    );
  }
}

function validateNullableString(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  c: IssueCollector,
): void {
  const value = obj[key];
  if (value !== null && !isString(value)) {
    c.add(joinPath(path, key), "field.type", `${key} must be a string or null.`);
  }
}

// --- Language ---------------------------------------------------------------

export function validateLanguageConfigValue(value: unknown, path: string, c: IssueCollector): void {
  if (!isPlainObject(value)) {
    c.add(path, "languages.type", "languages must be an object.");
    return;
  }
  const fields = ["defaultLanguage", "dialogueLanguage", "promptLanguage"] as const;
  for (const field of fields) {
    if (!isNonEmptyString(value[field])) {
      c.add(joinPath(path, field), "field.required", `${field} must be a non-empty string.`);
    }
  }

  const supported = value.supportedLanguages;
  if (!isArray(supported) || supported.length === 0 || !supported.every(isNonEmptyString)) {
    c.add(
      joinPath(path, "supportedLanguages"),
      "languages.supported",
      "supportedLanguages must be a non-empty array of non-empty strings.",
    );
    return;
  }

  const supportedSet = new Set<string>();
  for (let i = 0; i < supported.length; i++) {
    const lang = supported[i] as string;
    if (supportedSet.has(lang)) {
      c.add(
        joinPath(joinPath(path, "supportedLanguages"), i),
        "languages.duplicate",
        `supportedLanguages contains duplicate "${lang}".`,
      );
    }
    supportedSet.add(lang);
  }

  for (const field of fields) {
    const lang = value[field];
    if (isNonEmptyString(lang) && !supportedSet.has(lang)) {
      c.add(
        joinPath(path, field),
        "language.not-supported",
        `${field} "${lang}" is not listed in supportedLanguages.`,
      );
    }
  }
}

// --- Image providers --------------------------------------------------------

export function validateImageProvidersValue(value: unknown, path: string, c: IssueCollector): void {
  if (!isPlainObject(value)) {
    c.add(path, "imageProviders.type", "imageProviders must be an object.");
    return;
  }
  const providers = value.providers;
  if (!isArray(providers)) {
    c.add(joinPath(path, "providers"), "imageProviders.providers", "providers must be an array.");
    return;
  }

  const ids = new Set<string>();
  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    const providerPath = joinPath(joinPath(path, "providers"), i);
    if (!isPlainObject(provider)) {
      c.add(providerPath, "provider.type", "provider must be an object.");
      continue;
    }
    if (!isNonEmptyString(provider.id)) {
      c.add(joinPath(providerPath, "id"), "provider.id", "provider id must be a non-empty string.");
    } else {
      if (ids.has(provider.id)) {
        c.add(
          joinPath(providerPath, "id"),
          "provider.duplicate",
          `duplicate provider id "${provider.id}".`,
        );
      }
      ids.add(provider.id);
    }
    if (!isNonEmptyString(provider.kind)) {
      c.add(
        joinPath(providerPath, "kind"),
        "provider.kind",
        "provider kind must be a non-empty string label.",
      );
    }
    // Allowlist provider keys so private metadata (account ids, endpoints,
    // tokens) cannot ride along on a provider record and still validate.
    for (const key of Object.keys(provider)) {
      if (key !== "id" && key !== "kind") {
        c.add(
          joinPath(providerPath, key),
          "provider.unexpected-field",
          `provider records allow only "id" and "kind"; remove unexpected field "${key}" (provider config must stay provider-neutral, no account details).`,
        );
      }
    }
  }

  const defaultProvider = value.defaultProvider;
  if (!isNonEmptyString(defaultProvider)) {
    c.add(
      joinPath(path, "defaultProvider"),
      "imageProviders.default",
      "defaultProvider must be a non-empty string.",
    );
  } else if (defaultProvider !== MANUAL_PROVIDER_ID && !ids.has(defaultProvider)) {
    c.add(
      joinPath(path, "defaultProvider"),
      "imageProviders.default-unknown",
      `defaultProvider "${defaultProvider}" must be "${MANUAL_PROVIDER_ID}" or a configured provider id.`,
    );
  }
}

// --- Webtoon ----------------------------------------------------------------

export function validateWebtoonValue(value: unknown, path: string, c: IssueCollector): void {
  if (!isPlainObject(value)) {
    c.add(path, "webtoon.type", "webtoon must be an object.");
    return;
  }
  requireSchemaVersion(value.schemaVersion, path, c);
  if (!isNonEmptyString(value.projectId)) {
    c.add(joinPath(path, "projectId"), "field.required", "projectId must be a non-empty string.");
  }
  if (!isNonEmptyString(value.title)) {
    c.add(joinPath(path, "title"), "field.required", "title must be a non-empty string.");
  }
  validateLanguageConfigValue(value.languages, joinPath(path, "languages"), c);
  validateImageProvidersValue(value.imageProviders, joinPath(path, "imageProviders"), c);
}

export function validateWebtoon(value: unknown): ValidationResult {
  const c = new IssueCollector();
  validateWebtoonValue(value, "webtoon", c);
  return c.result();
}

// --- Cut --------------------------------------------------------------------

export function validateCutValue(value: unknown, path: string, c: IssueCollector): void {
  if (!isPlainObject(value)) {
    c.add(path, "cut.type", "cut must be an object.");
    return;
  }
  if (!isNonEmptyString(value.id)) {
    c.add(joinPath(path, "id"), "field.required", "cut id must be a non-empty string.");
  }
  // Prompt fields are back-compatible: a project written before they existed
  // omits them entirely. A missing (undefined) prompt is accepted and normalized
  // to "" on read by project-io; a present value must be a string.
  for (const key of ["imagePrompt", "negativePrompt"] as const) {
    const prompt = value[key];
    if (prompt !== undefined && !isString(prompt)) {
      c.add(joinPath(path, key), "cut.prompt", `${key} must be a string.`);
    }
  }
  const image = value.image;
  if (image === null) return;
  if (!isPlainObject(image)) {
    c.add(joinPath(path, "image"), "cut.image", "image must be an object or null.");
    return;
  }
  for (const key of ["clean", "final"] as const) {
    const ref = image[key];
    if (ref === null) continue;
    if (!isNonEmptyString(ref)) {
      c.add(
        joinPath(joinPath(path, "image"), key),
        "cut.image-ref",
        `${key} must be a string or null.`,
      );
    } else if (!isProjectRelativePath(ref)) {
      c.add(
        joinPath(joinPath(path, "image"), key),
        "cut.image-path",
        `${key} must be a project-relative path (no absolute or parent-escaping paths).`,
      );
    }
  }
}

// --- Transition -------------------------------------------------------------

export function validateTransitionValue(value: unknown, path: string, c: IssueCollector): void {
  if (!isPlainObject(value)) {
    c.add(path, "transition.type", "transition must be an object.");
    return;
  }
  if (!isNonEmptyString(value.id)) {
    c.add(joinPath(path, "id"), "field.required", "transition id must be a non-empty string.");
  }
  if (!isOneOf(value.type, TRANSITION_TYPES)) {
    c.add(
      joinPath(path, "type"),
      "transition.kind",
      `type must be one of: ${TRANSITION_TYPES.join(", ")}.`,
    );
  }
  const gutter = value.gutterHeight;
  if (!isInteger(gutter) || gutter < GUTTER_HEIGHT_MIN_PX || gutter > GUTTER_HEIGHT_MAX_PX) {
    c.add(
      joinPath(path, "gutterHeight"),
      "transition.gutter",
      `gutterHeight must be an integer in px between ${GUTTER_HEIGHT_MIN_PX} and ${GUTTER_HEIGHT_MAX_PX}.`,
    );
  }
  for (const key of ["text", "sfx", "agentNote", "humanNote"] as const) {
    validateNullableString(value, key, path, c);
  }
  const image = value.image;
  if (image !== null) {
    if (!isNonEmptyString(image)) {
      c.add(joinPath(path, "image"), "transition.image", "image must be a string or null.");
    } else if (!isProjectRelativePath(image)) {
      c.add(
        joinPath(path, "image"),
        "transition.image-path",
        "image must be a project-relative path (no absolute or parent-escaping paths).",
      );
    }
  }
  if (!isOneOf(value.reviewStatus, REVIEW_STATUSES)) {
    c.add(
      joinPath(path, "reviewStatus"),
      "review-status.invalid",
      `reviewStatus must be one of: ${REVIEW_STATUSES.join(", ")}.`,
    );
  }
}

// --- Lettering overlay ------------------------------------------------------

function validateGeometry(value: unknown, path: string, c: IssueCollector): void {
  if (!isPlainObject(value)) {
    c.add(path, "geometry.type", "geometry must be an object.");
    return;
  }
  const { x, y, width, height } = value;
  if (!isNormalizedUnit(x) || !isNormalizedUnit(y)) {
    c.add(path, "geometry.origin", "geometry x and y must be normalized numbers in 0..1.");
  }
  if (!isFiniteNumber(width) || width <= 0 || width > 1) {
    c.add(joinPath(path, "width"), "geometry.width", "geometry width must be in (0..1].");
  }
  if (!isFiniteNumber(height) || height <= 0 || height > 1) {
    c.add(joinPath(path, "height"), "geometry.height", "geometry height must be in (0..1].");
  }
  if (isNormalizedUnit(x) && isFiniteNumber(width) && width > 0 && x + width > 1 + Number.EPSILON) {
    c.add(path, "geometry.x-overflow", "geometry x + width must not exceed 1.");
  }
  if (
    isNormalizedUnit(y) &&
    isFiniteNumber(height) &&
    height > 0 &&
    y + height > 1 + Number.EPSILON
  ) {
    c.add(path, "geometry.y-overflow", "geometry y + height must not exceed 1.");
  }
}

function validateTail(value: unknown, path: string, c: IssueCollector): void {
  if (value === null) return;
  if (!isPlainObject(value)) {
    c.add(path, "tail.type", "tail must be a normalized {x, y} point or null.");
    return;
  }
  if (!isNormalizedUnit(value.x) || !isNormalizedUnit(value.y)) {
    c.add(path, "tail.bounds", "tail x and y must be normalized numbers in 0..1.");
  }
}

function validateBorder(value: unknown, path: string, c: IssueCollector): void {
  if (value === null) return;
  if (!isPlainObject(value)) {
    c.add(path, "border.type", "border must be an object or null.");
    return;
  }
  if (!isFiniteNumber(value.width) || value.width < 0) {
    c.add(joinPath(path, "width"), "border.width", "border width must be a number >= 0.");
  }
  if (!isNonEmptyString(value.color)) {
    c.add(joinPath(path, "color"), "border.color", "border color must be a non-empty string.");
  }
}

export function validateLetteringOverlayValue(
  value: unknown,
  path: string,
  c: IssueCollector,
): void {
  if (!isPlainObject(value)) {
    c.add(path, "overlay.type", "lettering overlay must be an object.");
    return;
  }
  for (const key of ["id", "cutId", "font", "fill"] as const) {
    if (!isNonEmptyString(value[key])) {
      c.add(joinPath(path, key), "field.required", `${key} must be a non-empty string.`);
    }
  }
  // speaker is always a string, but only attributed kinds require it to be
  // non-empty; narration and SFX are unattributed and may leave it empty.
  if (!isString(value.speaker)) {
    c.add(joinPath(path, "speaker"), "field.type", "speaker must be a string.");
  } else if (
    value.speaker.trim().length === 0 &&
    value.kind !== "narration" &&
    value.kind !== "sfx"
  ) {
    c.add(
      joinPath(path, "speaker"),
      "field.required",
      "speaker must be a non-empty string for this bubble kind.",
    );
  }
  if (!isString(value.text)) {
    c.add(joinPath(path, "text"), "field.type", "text must be a string.");
  }
  if (!isOneOf(value.kind, BUBBLE_KINDS)) {
    c.add(
      joinPath(path, "kind"),
      "overlay.kind",
      `kind must be one of: ${BUBBLE_KINDS.join(", ")}.`,
    );
  }
  if (!isNormalizedUnit(value.opacity)) {
    c.add(joinPath(path, "opacity"), "overlay.opacity", "opacity must be a number in 0..1.");
  }
  if (!isBoolean(value.overflow)) {
    c.add(joinPath(path, "overflow"), "overlay.overflow", "overflow must be a boolean.");
  }
  if (!isOneOf(value.reviewStatus, REVIEW_STATUSES)) {
    c.add(
      joinPath(path, "reviewStatus"),
      "review-status.invalid",
      `reviewStatus must be one of: ${REVIEW_STATUSES.join(", ")}.`,
    );
  }
  validateBorder(value.border, joinPath(path, "border"), c);
  validateTail(value.tail, joinPath(path, "tail"), c);
  validateGeometry(value.geometry, joinPath(path, "geometry"), c);
  validateLetteringStyle(value, path, c);
}

/**
 * Validate the additive pro-lettering style fields (#54). Each is OPTIONAL:
 * an absent field is valid and resolved to a default by the renderer, so older
 * projects keep validating. A field that IS present must satisfy its bound/enum.
 */
function validateLetteringStyle(
  value: Record<string, unknown>,
  path: string,
  c: IssueCollector,
): void {
  // fontFamily (#56): when present, must be one of the curated family ids. Absent
  // is valid and resolves to the per-kind default in @toony/render / @toony/export,
  // so projects written before this field existed keep validating and rendering.
  if (value.fontFamily !== undefined && !isOneOf(value.fontFamily, FONT_FAMILY_IDS)) {
    c.add(
      joinPath(path, "fontFamily"),
      "style.font-family",
      `fontFamily must be one of: ${FONT_FAMILY_IDS.join(", ")}.`,
    );
  }
  // fontSize: a number within bounds, OR null (explicit auto-fit).
  if (value.fontSize !== undefined && value.fontSize !== null) {
    if (
      !isFiniteNumber(value.fontSize) ||
      value.fontSize < FONT_SIZE_MIN_PX ||
      value.fontSize > FONT_SIZE_MAX_PX
    ) {
      c.add(
        joinPath(path, "fontSize"),
        "style.font-size",
        `fontSize must be a number in ${FONT_SIZE_MIN_PX}..${FONT_SIZE_MAX_PX} px, or null for auto-fit.`,
      );
    }
  }
  if (
    value.fontWeight !== undefined &&
    !(
      typeof value.fontWeight === "number" &&
      (FONT_WEIGHTS as readonly number[]).includes(value.fontWeight)
    )
  ) {
    c.add(
      joinPath(path, "fontWeight"),
      "style.font-weight",
      `fontWeight must be one of: ${FONT_WEIGHTS.join(", ")}.`,
    );
  }
  if (
    value.lineHeight !== undefined &&
    (!isFiniteNumber(value.lineHeight) ||
      value.lineHeight < LINE_HEIGHT_MIN ||
      value.lineHeight > LINE_HEIGHT_MAX)
  ) {
    c.add(
      joinPath(path, "lineHeight"),
      "style.line-height",
      `lineHeight must be a number in ${LINE_HEIGHT_MIN}..${LINE_HEIGHT_MAX}.`,
    );
  }
  if (value.textAlign !== undefined && !isOneOf(value.textAlign, TEXT_ALIGNS)) {
    c.add(
      joinPath(path, "textAlign"),
      "style.text-align",
      `textAlign must be one of: ${TEXT_ALIGNS.join(", ")}.`,
    );
  }
  if (
    value.letterSpacing !== undefined &&
    (!isFiniteNumber(value.letterSpacing) ||
      value.letterSpacing < LETTER_SPACING_MIN_EM ||
      value.letterSpacing > LETTER_SPACING_MAX_EM)
  ) {
    c.add(
      joinPath(path, "letterSpacing"),
      "style.letter-spacing",
      `letterSpacing must be a number in ${LETTER_SPACING_MIN_EM}..${LETTER_SPACING_MAX_EM} em.`,
    );
  }
  if (value.textColor !== undefined && !isNonEmptyString(value.textColor)) {
    c.add(joinPath(path, "textColor"), "style.text-color", "textColor must be a non-empty string.");
  }
  if (
    value.cornerRadius !== undefined &&
    (!isFiniteNumber(value.cornerRadius) ||
      value.cornerRadius < CORNER_RADIUS_MIN_PX ||
      value.cornerRadius > CORNER_RADIUS_MAX_PX)
  ) {
    c.add(
      joinPath(path, "cornerRadius"),
      "style.corner-radius",
      `cornerRadius must be a number in ${CORNER_RADIUS_MIN_PX}..${CORNER_RADIUS_MAX_PX} px.`,
    );
  }
  if (value.zIndex !== undefined && (!isInteger(value.zIndex) || value.zIndex < 0)) {
    c.add(joinPath(path, "zIndex"), "style.z-index", "zIndex must be an integer >= 0.");
  }
}

// --- Episode sequence -------------------------------------------------------

export function validateSequenceItemValue(value: unknown, path: string, c: IssueCollector): void {
  if (!isPlainObject(value)) {
    c.add(path, "sequence-item.type", "sequence item must be an object.");
    return;
  }
  if (value.type !== "cut" && value.type !== "transition") {
    c.add(
      joinPath(path, "type"),
      "sequence-item.kind",
      'sequence item type must be "cut" or "transition".',
    );
  }
  if (!isNonEmptyString(value.id)) {
    c.add(joinPath(path, "id"), "field.required", "sequence item id must be a non-empty string.");
  }
}

export function validateEpisodeValue(value: unknown, path: string, c: IssueCollector): void {
  if (!isPlainObject(value)) {
    c.add(path, "episode.type", "episode must be an object.");
    return;
  }
  requireSchemaVersion(value.schemaVersion, path, c);
  if (!isNonEmptyString(value.id)) {
    c.add(joinPath(path, "id"), "field.required", "episode id must be a non-empty string.");
  } else if (!isPathSafeId(value.id)) {
    // The episode id is joined into `episodes/<id>/...` on disk by project-io and
    // the export engine, so it must be a single safe path segment — reject `/`,
    // `\`, NUL, absolute prefixes, and `.`/`..` traversal before any write.
    c.add(
      joinPath(path, "id"),
      "episode.id.unsafe",
      "episode id must be a path-safe segment (no /, \\, NUL, or . / .. traversal).",
    );
  }
  if (!isNonEmptyString(value.title)) {
    c.add(joinPath(path, "title"), "field.required", "episode title must be a non-empty string.");
  }
  const sequence = value.sequence;
  if (!isArray(sequence)) {
    c.add(joinPath(path, "sequence"), "episode.sequence", "sequence must be an array.");
    return;
  }
  for (let i = 0; i < sequence.length; i++) {
    validateSequenceItemValue(sequence[i], joinPath(joinPath(path, "sequence"), i), c);
  }
}

// --- Cross-file project validation ------------------------------------------

function collectIds(
  records: unknown,
  recordKind: string,
  path: string,
  c: IssueCollector,
): Set<string> {
  const ids = new Set<string>();
  if (!isArray(records)) return ids;
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!isPlainObject(record) || !isNonEmptyString(record.id)) continue;
    if (ids.has(record.id)) {
      c.add(
        joinPath(joinPath(path, i), "id"),
        `${recordKind}.duplicate-id`,
        `duplicate ${recordKind} id "${record.id}".`,
      );
    }
    ids.add(record.id);
  }
  return ids;
}

function validateSequenceIntegrity(
  episode: Record<string, unknown>,
  cutIds: Set<string>,
  transitionIds: Set<string>,
  path: string,
  c: IssueCollector,
): void {
  const sequence = episode.sequence;
  if (!isArray(sequence)) return;

  const seen = new Set<string>();
  const referencedCutIds = new Set<string>();
  const referencedTransitionIds = new Set<string>();

  for (let i = 0; i < sequence.length; i++) {
    const item = sequence[i];
    const itemPath = joinPath(joinPath(path, "sequence"), i);
    if (!isPlainObject(item) || !isNonEmptyString(item.id)) continue;

    if (seen.has(item.id)) {
      c.add(
        itemPath,
        "sequence.duplicate-reference",
        `sequence references id "${item.id}" more than once.`,
      );
    }
    seen.add(item.id);

    if (item.type === "cut") {
      referencedCutIds.add(item.id);
      if (!cutIds.has(item.id)) {
        c.add(
          itemPath,
          "sequence.missing-cut",
          `sequence references cut "${item.id}" with no matching cut record.`,
        );
      }
    } else if (item.type === "transition") {
      referencedTransitionIds.add(item.id);
      if (!transitionIds.has(item.id)) {
        c.add(
          itemPath,
          "sequence.missing-transition",
          `sequence references transition "${item.id}" with no matching transition record.`,
        );
      }
    }
  }

  for (const cutId of cutIds) {
    if (!referencedCutIds.has(cutId)) {
      c.add(
        joinPath(path, "cuts"),
        "cut.orphan",
        `cut "${cutId}" is not referenced by the episode sequence.`,
      );
    }
  }
  for (const transitionId of transitionIds) {
    if (!referencedTransitionIds.has(transitionId)) {
      c.add(
        joinPath(path, "transitions"),
        "transition.orphan",
        `transition "${transitionId}" is not referenced by the episode sequence.`,
      );
    }
  }

  validateSequenceShape(sequence, joinPath(path, "sequence"), c);
}

/** Canonical well-formedness: a transition must sit between two cuts. */
function validateSequenceShape(sequence: unknown[], path: string, c: IssueCollector): void {
  const types: string[] = [];
  for (const item of sequence) {
    if (isPlainObject(item) && typeof item.type === "string") types.push(item.type);
    else types.push("invalid");
  }
  if (types.length === 0) {
    c.add(path, "sequence.empty", "episode sequence must contain at least one cut.");
    return;
  }
  if (types[0] === "transition") {
    c.add(
      path,
      "sequence.leading-transition",
      "episode sequence must not begin with a transition.",
    );
  }
  if (types[types.length - 1] === "transition") {
    c.add(path, "sequence.trailing-transition", "episode sequence must not end with a transition.");
  }
  for (let i = 1; i < types.length; i++) {
    if (types[i] === "transition" && types[i - 1] === "transition") {
      c.add(
        joinPath(path, i),
        "sequence.adjacent-transitions",
        "two transitions cannot be adjacent; a transition must sit between cuts.",
      );
    }
  }
}

export function validateProject(value: unknown): ValidationResult {
  const c = new IssueCollector();
  if (!isPlainObject(value)) {
    c.add("project", "project.type", "project must be an object.");
    return c.result();
  }

  validateWebtoonValue(value.webtoon, "webtoon", c);

  const episodes = value.episodes;
  if (!isArray(episodes)) {
    c.add("episodes", "project.episodes", "episodes must be an array.");
    return c.result();
  }

  const episodeIds = new Set<string>();
  for (let i = 0; i < episodes.length; i++) {
    const bundle = episodes[i];
    const bundlePath = joinPath("episodes", i);
    if (!isPlainObject(bundle)) {
      c.add(bundlePath, "episode-bundle.type", "episode bundle must be an object.");
      continue;
    }

    validateEpisodeValue(bundle.episode, joinPath(bundlePath, "episode"), c);

    const episode = bundle.episode;
    if (isPlainObject(episode) && isNonEmptyString(episode.id)) {
      if (episodeIds.has(episode.id)) {
        c.add(
          joinPath(joinPath(bundlePath, "episode"), "id"),
          "episode.duplicate-id",
          `duplicate episode id "${episode.id}".`,
        );
      }
      episodeIds.add(episode.id);
    }

    if (isArray(bundle.cuts)) {
      for (let j = 0; j < bundle.cuts.length; j++) {
        validateCutValue(bundle.cuts[j], joinPath(joinPath(bundlePath, "cuts"), j), c);
      }
    } else {
      c.add(joinPath(bundlePath, "cuts"), "episode-bundle.cuts", "cuts must be an array.");
    }

    if (isArray(bundle.transitions)) {
      for (let j = 0; j < bundle.transitions.length; j++) {
        validateTransitionValue(
          bundle.transitions[j],
          joinPath(joinPath(bundlePath, "transitions"), j),
          c,
        );
      }
    } else {
      c.add(
        joinPath(bundlePath, "transitions"),
        "episode-bundle.transitions",
        "transitions must be an array.",
      );
    }

    if (isArray(bundle.lettering)) {
      for (let j = 0; j < bundle.lettering.length; j++) {
        validateLetteringOverlayValue(
          bundle.lettering[j],
          joinPath(joinPath(bundlePath, "lettering"), j),
          c,
        );
      }
    } else {
      c.add(
        joinPath(bundlePath, "lettering"),
        "episode-bundle.lettering",
        "lettering must be an array.",
      );
    }

    const cutIds = collectIds(bundle.cuts, "cut", joinPath(bundlePath, "cuts"), c);
    const transitionIds = collectIds(
      bundle.transitions,
      "transition",
      joinPath(bundlePath, "transitions"),
      c,
    );

    // Overlay ids must also be unique so #8 can target edits deterministically.
    collectIds(bundle.lettering, "overlay", joinPath(bundlePath, "lettering"), c);

    if (isPlainObject(episode)) {
      validateSequenceIntegrity(episode, cutIds, transitionIds, bundlePath, c);
    }

    if (isArray(bundle.lettering)) {
      for (let j = 0; j < bundle.lettering.length; j++) {
        const overlay = bundle.lettering[j];
        if (
          isPlainObject(overlay) &&
          isNonEmptyString(overlay.cutId) &&
          !cutIds.has(overlay.cutId)
        ) {
          c.add(
            joinPath(joinPath(joinPath(bundlePath, "lettering"), j), "cutId"),
            "overlay.missing-cut",
            `lettering overlay references cut "${overlay.cutId}" with no matching cut record.`,
          );
        }
      }
    }
  }

  return c.result();
}
