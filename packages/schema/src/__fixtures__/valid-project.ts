// Named test fixture: a small, fully valid, original Toony project.
// All content here is original test material and not derived from any specific
// webtoon work. Asset paths are project-relative only.

import type { Project } from "../types.js";

export const validProject: Project = {
  webtoon: {
    schemaVersion: 1,
    projectId: "lantern-tide",
    title: "Lantern Tide",
    languages: {
      defaultLanguage: "en",
      supportedLanguages: ["en", "ko"],
      dialogueLanguage: "en",
      promptLanguage: "en",
    },
    imageProviders: {
      defaultProvider: "manual",
      providers: [],
    },
  },
  episodes: [
    {
      episode: {
        schemaVersion: 1,
        id: "ep-001",
        title: "First Light",
        sequence: [
          { type: "cut", id: "cut-001" },
          { type: "transition", id: "tr-001" },
          { type: "cut", id: "cut-002" },
        ],
      },
      cuts: [
        {
          id: "cut-001",
          image: { clean: "assets/clean/cut-001.webp", final: null },
          imagePrompt: "",
          negativePrompt: "",
        },
        {
          id: "cut-002",
          image: { clean: "assets/clean/cut-002.webp", final: null },
          imagePrompt: "",
          negativePrompt: "",
        },
      ],
      transitions: [
        {
          id: "tr-001",
          type: "gutter",
          gutterHeight: 48,
          text: null,
          sfx: null,
          agentNote: "ease the reader into the harbor scene",
          humanNote: null,
          image: null,
          reviewStatus: "draft",
        },
      ],
      lettering: [
        {
          id: "ov-001",
          cutId: "cut-001",
          speaker: "Mira",
          kind: "speech",
          text: "The tide remembers every name.",
          font: "Nanum Gothic",
          fill: "#ffffff",
          opacity: 1,
          border: { width: 2, color: "#101010" },
          tail: { x: 0.42, y: 0.78 },
          geometry: { x: 0.1, y: 0.12, width: 0.45, height: 0.2 },
          overflow: false,
          reviewStatus: "human-edited",
        },
        {
          id: "ov-002",
          cutId: "cut-002",
          speaker: "Narration",
          kind: "narration",
          text: "Dawn arrived without asking.",
          font: "Nanum Gothic",
          fill: "#101010",
          opacity: 0.92,
          border: null,
          tail: null,
          geometry: { x: 0.05, y: 0.05, width: 0.6, height: 0.15 },
          overflow: false,
          reviewStatus: "final",
        },
      ],
    },
  ],
};

/** A deep clone of the valid project, for tests that mutate before validating. */
export function cloneValidProject(): Project {
  return structuredClone(validProject);
}
