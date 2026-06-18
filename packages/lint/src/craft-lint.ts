// Craft lints (#94): deterministic, agent-readable checks for webtoon mobile
// readability + scroll pacing (docs/TOONY-WEBTOON-CRAFT.md §2/§4). Thresholds are
// named constants below so they are documented and tunable in one place. Line/
// length counts reuse @toony/render's text layout — the single source of wrapping.

import { layoutBubble } from "@toony/render";
import type { Character, EpisodeBundle, ShotType } from "@toony/schema";
import { type Finding, finding } from "./findings.js";

/** > this many speech/thought bubbles in a cut → density warning. */
export const CRAFT_MAX_DIALOGUE_BUBBLES = 2;
/** > this many characters of bubble text in a cut → density warning. */
export const CRAFT_MAX_CUT_TEXT_CHARS = 240;
/** A wrapped line longer than this → line-wrap warning (thumb-distance legibility). */
export const CRAFT_MAX_LINE_CHARS = 24;
/** More than this many wrapped lines → line-wrap warning (one idea per beat). */
export const CRAFT_MAX_LINES = 4;
/** An all-caps run longer than this with no break → all-caps info. */
export const CRAFT_MAX_ALLCAPS_LINE_CHARS = 16;
/** A narration/caption longer than this many words → fragmentation info. */
export const CRAFT_MAX_NARRATION_WORDS = 30;
/**
 * ≥ this many CONSECUTIVE cuts sharing the same `shotType` with nothing breaking
 * the rhythm → rhythm-monotony warning (#100). docs/TOONY-WEBTOON-CRAFT.md §5:
 * monotony kills the read; alternate splash/small/void shots.
 */
export const RHYTHM_RUN_MAX = 4;

/**
 * Reference render size for counting wrapped lines. Wrapping depends on the box
 * (normalized geometry) + font, so a FIXED reference makes the line/char checks
 * deterministic and image-independent (a portrait webtoon cut).
 */
const REFERENCE = { width: 1200, height: 1600 } as const;

/** Kinds that represent someone speaking/thinking and should be attributable. */
const ATTRIBUTED_KINDS = new Set(["speech", "thought", "shout", "whisper"]);
/** Kinds counted toward per-cut dialogue density. */
const DIALOGUE_KINDS = new Set(["speech", "thought"]);

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

/** A line that has upper-case letters and no lower-case ones (a shout/run-on). */
function isAllCapsRun(line: string): boolean {
  return /[A-Z]/.test(line) && !/[a-z]/.test(line);
}

/**
 * Run the craft lints over one episode bundle. `characters` is the project
 * registry (#92) used by tail-attribution; an EMPTY registry triggers graceful
 * degradation (attribution falls back to `speaker` only), so this lands
 * independently of #92. Deterministic: same inputs → same findings.
 */
export function lintCraft(bundle: EpisodeBundle, characters: readonly Character[] = []): Finding[] {
  const findings: Finding[] = [];
  const registryIds = new Set(characters.map((character) => character.id));
  const hasRegistry = registryIds.size > 0;
  const cutById = new Map(bundle.cuts.map((cut) => [cut.id, cut]));

  // --- Per-cut density ---
  for (const cut of bundle.cuts) {
    const overlays = bundle.lettering.filter((overlay) => overlay.cutId === cut.id);
    const dialogue = overlays.filter((overlay) => DIALOGUE_KINDS.has(overlay.kind)).length;
    if (dialogue > CRAFT_MAX_DIALOGUE_BUBBLES) {
      findings.push(
        finding(
          "warning",
          "craft/bubble-density",
          cut.id,
          `cut "${cut.id}" has ${dialogue} speech/thought bubbles (max ${CRAFT_MAX_DIALOGUE_BUBBLES}); aim for one idea per scroll-beat.`,
        ),
      );
    }
    const totalChars = overlays.reduce((sum, overlay) => sum + overlay.text.length, 0);
    if (totalChars > CRAFT_MAX_CUT_TEXT_CHARS) {
      findings.push(
        finding(
          "warning",
          "craft/bubble-density",
          cut.id,
          `cut "${cut.id}" has ${totalChars} characters of bubble text (max ${CRAFT_MAX_CUT_TEXT_CHARS}); split dialogue across cuts.`,
        ),
      );
    }
  }

  // --- Per-overlay checks ---
  for (const overlay of bundle.lettering) {
    // Tail attribution: an attributed kind needs a resolvable speaker.
    if (ATTRIBUTED_KINDS.has(overlay.kind)) {
      const hasSpeaker = overlay.speaker.trim().length > 0;
      const refs = cutById.get(overlay.cutId)?.characters ?? [];
      const hasCharacter = hasRegistry && refs.some((id) => registryIds.has(id));
      if (!hasSpeaker && !hasCharacter) {
        findings.push(
          finding(
            "warning",
            "craft/tail-attribution",
            overlay.id,
            `${overlay.kind} bubble "${overlay.id}" has no resolvable speaker; set a speaker${
              hasRegistry ? " or reference a registered character on the cut" : ""
            }.`,
          ),
        );
      }
    }

    if (overlay.text.trim().length > 0) {
      const lines = layoutBubble(overlay, REFERENCE.width, REFERENCE.height).text.lines;
      // Line-wrap: aim for 2–4 short stacked lines. One finding per overlay.
      if (lines.length > CRAFT_MAX_LINES) {
        findings.push(
          finding(
            "warning",
            "craft/line-wrap",
            overlay.id,
            `bubble "${overlay.id}" wraps to ${lines.length} lines (max ${CRAFT_MAX_LINES}); shorten to 2–4 short lines.`,
          ),
        );
      } else if (lines.some((line) => line.length > CRAFT_MAX_LINE_CHARS)) {
        findings.push(
          finding(
            "warning",
            "craft/line-wrap",
            overlay.id,
            `bubble "${overlay.id}" has a line longer than ${CRAFT_MAX_LINE_CHARS} characters; break it for thumb-distance legibility.`,
          ),
        );
      }
      // All-caps run-on (advisory).
      if (lines.some((line) => isAllCapsRun(line) && line.length > CRAFT_MAX_ALLCAPS_LINE_CHARS)) {
        findings.push(
          finding(
            "info",
            "craft/all-caps-runon",
            overlay.id,
            `bubble "${overlay.id}" has an all-caps run longer than ${CRAFT_MAX_ALLCAPS_LINE_CHARS} characters; consider breaking it for legibility.`,
          ),
        );
      }
    }

    // Narration fragmentation (advisory): long captions read better split.
    if (overlay.kind === "narration") {
      const words = wordCount(overlay.text);
      if (words > CRAFT_MAX_NARRATION_WORDS) {
        findings.push(
          finding(
            "info",
            "craft/narration-fragment",
            overlay.id,
            `narration "${overlay.id}" is ${words} words (max ${CRAFT_MAX_NARRATION_WORDS}); consider splitting it across consecutive cuts for scroll pacing.`,
          ),
        );
      }
    }
  }

  // --- Rhythm monotony (#100) ---
  // Walk the episode's reading SEQUENCE and flag a long RUN of consecutive cuts
  // that share the same `shotType` with nothing breaking the rhythm. The run
  // resets when (a) the next cut has a different `shotType`, (b) a NON-`gutter`
  // transition occurs between cuts (a scene-break/fade/etc. is a deliberate beat
  // change), or (c) a cut has no `shotType` (graceful degrade — an unclassified
  // cut breaks the run rather than extending it). Plain `gutter` transitions do
  // NOT reset. Deterministic: the sequence order is the single source.
  const transitionById = new Map(
    bundle.transitions.map((transition) => [transition.id, transition]),
  );
  let run: { shotType: ShotType; cutIds: string[] } | null = null;
  const flushRun = (): void => {
    const current = run;
    run = null;
    if (current && current.cutIds.length >= RHYTHM_RUN_MAX) {
      const [firstId = ""] = current.cutIds;
      findings.push(
        finding(
          "warning",
          "craft/rhythm-monotony",
          firstId,
          `${current.cutIds.length} consecutive cuts share shotType "${current.shotType}" (max ${RHYTHM_RUN_MAX - 1}): ${current.cutIds.join(", ")}; alternate splash/small/void shots to keep the scroll moving.`,
        ),
      );
    }
  };
  for (const item of bundle.episode.sequence) {
    if (item.type === "transition") {
      // A non-gutter (or unresolved) transition is a deliberate rhythm break; a
      // plain gutter keeps the run going.
      if (transitionById.get(item.id)?.type !== "gutter") flushRun();
      continue;
    }
    const shotType = cutById.get(item.id)?.shotType;
    if (!shotType) {
      // Unclassified/missing cut breaks the run and does not start a new one.
      flushRun();
      continue;
    }
    if (run && run.shotType === shotType) {
      run.cutIds.push(item.id);
    } else {
      flushRun();
      run = { shotType, cutIds: [item.id] };
    }
  }
  flushRun();

  return findings;
}
