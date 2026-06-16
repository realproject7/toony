// Generate PlotLink-ready markdown from canonical project/episode data.
//
// The markdown is a generated SUPPORT artifact (never editable production
// state), derived from the episode's reading sequence, lettering, and
// transitions. The PlotLink 500..10,000 character bound is enforced on the
// generated output: over-length is truncated at a line boundary; under-length
// is an error (no padding/fabrication).

import type { EpisodeBundle, LetteringOverlay, Project } from "@toony/schema";
import { ExportError } from "./errors.js";

export const PLOTLINK_MARKDOWN_MIN = 500;
export const PLOTLINK_MARKDOWN_MAX = 10000;

function overlayLine(overlay: LetteringOverlay): string {
  const text = overlay.text.trim();
  if (text.length === 0) return "";
  if (overlay.kind === "narration") return `> ${text}`;
  if (overlay.kind === "sfx") return `*SFX: ${text}*`;
  const speaker = overlay.speaker.trim();
  return speaker.length > 0 ? `**${speaker}:** ${text}` : text;
}

function generate(project: Project, bundle: EpisodeBundle): string {
  const lines: string[] = [];
  lines.push(`# ${project.webtoon.title}`, "");
  lines.push(`## ${bundle.episode.title}`, "");
  lines.push(
    `Episode \`${bundle.episode.id}\` of \`${project.webtoon.projectId}\`, ` +
      `${bundle.cuts.length} cut(s) and ${bundle.transitions.length} transition(s) ` +
      "in reading order.",
    "",
  );
  lines.push("### Script", "");

  for (const item of bundle.episode.sequence) {
    if (item.type === "cut") {
      const overlays = bundle.lettering.filter((o) => o.cutId === item.id);
      lines.push(`#### ${item.id}`);
      const dialogue = overlays.map(overlayLine).filter((l) => l.length > 0);
      if (dialogue.length > 0) lines.push(...dialogue);
      else lines.push("_(no lettering)_");
      lines.push("");
    } else {
      const transition = bundle.transitions.find((t) => t.id === item.id);
      if (transition) {
        const label = transition.type.replace(/-/g, " ");
        const detail =
          transition.text ?? transition.sfx ?? transition.humanNote ?? transition.agentNote;
        lines.push(detail ? `— ${label}: ${detail.trim()} —` : `— ${label} —`, "");
      }
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function truncateToBound(markdown: string): string {
  if (markdown.length <= PLOTLINK_MARKDOWN_MAX) return markdown;
  const limit = PLOTLINK_MARKDOWN_MAX - 1; // leave room for a trailing newline
  const slice = markdown.slice(0, limit);
  const lastBreak = slice.lastIndexOf("\n");
  const cut = lastBreak > PLOTLINK_MARKDOWN_MIN ? slice.slice(0, lastBreak) : slice;
  return `${cut.trimEnd()}\n`;
}

/**
 * Build PlotLink markdown for an episode, enforcing the 500..10,000 character
 * bound. Throws `ExportError` when the generated content is below the minimum.
 */
export function buildPlotlinkMarkdown(project: Project, bundle: EpisodeBundle): string {
  const markdown = truncateToBound(generate(project, bundle));
  if (markdown.length < PLOTLINK_MARKDOWN_MIN) {
    throw new ExportError(
      "plotlink.markdown-too-short",
      `generated PlotLink markdown is ${markdown.length} characters; the ${PLOTLINK_MARKDOWN_MIN}-character minimum is not met. Add dialogue, narration, or transition notes to the episode.`,
    );
  }
  return markdown;
}
