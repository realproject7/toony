// Named fixture: a minimal valid Toony project for schema-lint tests. Original
// test content; asset paths are project-relative only.

import type { Project } from "@toony/schema";

export function makeValidProject(): Project {
  return {
    webtoon: {
      schemaVersion: 1,
      projectId: "lint-sample",
      title: "Lint Sample",
      languages: {
        defaultLanguage: "en",
        supportedLanguages: ["en"],
        dialogueLanguage: "en",
        promptLanguage: "en",
      },
      imageProviders: { defaultProvider: "manual", providers: [] },
    },
    episodes: [
      {
        episode: {
          schemaVersion: 1,
          id: "ep-001",
          title: "Sample",
          sequence: [
            { type: "cut", id: "cut-001" },
            { type: "transition", id: "tr-001" },
            { type: "cut", id: "cut-002" },
          ],
        },
        cuts: [
          { id: "cut-001", image: { clean: "assets/clean/cut-001.webp", final: null } },
          { id: "cut-002", image: null },
        ],
        transitions: [
          {
            id: "tr-001",
            type: "gutter",
            gutterHeight: 32,
            text: null,
            sfx: null,
            agentNote: null,
            humanNote: null,
            image: null,
            reviewStatus: "draft",
          },
        ],
        lettering: [],
      },
    ],
  };
}
