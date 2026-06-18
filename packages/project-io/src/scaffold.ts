// Starter project model for `toony init`.
//
// Builds a valid in-memory `Project` (one starter episode with a canonical
// sequence). Writing it to disk is `writeProject`'s job; the two together
// guarantee a freshly initialized project passes validation.

import {
  type Cut,
  type Episode,
  type EpisodeBundle,
  type LetteringOverlay,
  type Project,
  SCHEMA_VERSION,
  type Transition,
  type Webtoon,
} from "@toony/schema";
import { buildGenreEpisodeBundle, type Genre } from "./genres.js";

/** Lowercase, hyphenate, and trim a name into a safe folder/project id. */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "untitled";
}

/** Title-case a slug back into a human-readable display title. */
function titleize(slug: string): string {
  return slug
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

/** A starter episode bundle with one cut, one transition, one more cut. */
function starterEpisode(): EpisodeBundle {
  const episode: Episode = {
    schemaVersion: SCHEMA_VERSION,
    id: "ep-001",
    title: "Episode 1",
    sequence: [
      { type: "cut", id: "cut-001" },
      { type: "transition", id: "tr-001" },
      { type: "cut", id: "cut-002" },
    ],
  };
  const cuts: Cut[] = [
    { id: "cut-001", image: null, imagePrompt: "", negativePrompt: "" },
    { id: "cut-002", image: null, imagePrompt: "", negativePrompt: "" },
  ];
  const transitions: Transition[] = [
    {
      id: "tr-001",
      type: "gutter",
      gutterHeight: 48,
      text: null,
      sfx: null,
      agentNote: null,
      humanNote: null,
      image: null,
      reviewStatus: "draft",
    },
  ];
  const lettering: LetteringOverlay[] = [];
  return { episode, cuts, transitions, lettering };
}

/**
 * Build the full in-memory project model for a new project. With no `genre` the
 * neutral starter episode is used (back-compat); a `genre` seeds a genre-tuned
 * cold-open + beat scaffold (#101) via `@toony/project-io`'s genre templates.
 * Either way the result is a valid, lint-clean project.
 */
export function buildInitialProject(name: string, genre?: Genre): Project {
  const projectId = slugify(name);
  const webtoon: Webtoon = {
    schemaVersion: SCHEMA_VERSION,
    projectId,
    title: titleize(projectId),
    languages: {
      defaultLanguage: "en",
      supportedLanguages: ["en"],
      dialogueLanguage: "en",
      promptLanguage: "en",
    },
    imageProviders: {
      defaultProvider: "manual",
      providers: [],
    },
  };
  const episode = genre ? buildGenreEpisodeBundle(genre) : starterEpisode();
  return { webtoon, episodes: [episode] };
}
