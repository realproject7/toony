// The genre lookup merges contributed scaffolds with the built-in five (#192).
// The built-ins must be untouched by the merge, and must always win.

import assert from "node:assert/strict";
import { test } from "node:test";
import { type EpisodeBundle, validateProject } from "@toony/schema";
import {
  buildGenreEpisodeBundle,
  GENRES,
  type GenreScaffold,
  listGenreIds,
  resolveGenreSeed,
} from "../genres.js";
import { buildInitialProject } from "../scaffold.js";

function scaffold(id: string, title = id): GenreScaffold {
  const bundle: EpisodeBundle = {
    episode: {
      schemaVersion: 1,
      id: "ep-001",
      title: `${title} opener`,
      sequence: [{ type: "cut", id: "cut-001" }],
    },
    cuts: [{ id: "cut-001", image: null, imagePrompt: `${title} scene`, negativePrompt: "" }],
    transitions: [],
    lettering: [],
  };
  return { id, title, bundle };
}

test("with no contributed scaffolds the genre vocabulary is exactly the built-in five", async () => {
  assert.deepEqual(await listGenreIds(), [...GENRES]);
  assert.deepEqual(await listGenreIds([]), [...GENRES]);
});

test("every built-in genre resolves to the bundle it always built", async () => {
  for (const genre of GENRES) {
    // A built-in genre contributes a bundle and nothing else: no craft values.
    assert.deepEqual(await resolveGenreSeed(genre), { bundle: buildGenreEpisodeBundle(genre) });
    // Contributed scaffolds present but unselected must not perturb a built-in.
    assert.deepEqual(await resolveGenreSeed(genre, [scaffold("noir")]), {
      bundle: buildGenreEpisodeBundle(genre),
    });
  }
});

test("a contributed scaffold is offered and resolves to its bundle", async () => {
  const noir = scaffold("noir", "Noir");
  assert.deepEqual(await listGenreIds([noir]), [...GENRES, "noir"]);
  assert.deepEqual(await resolveGenreSeed("noir", [noir]), { bundle: noir.bundle });
});

test("a contributed scaffold cannot redefine a built-in genre", async () => {
  const hijack = scaffold("romance", "Not Romance");
  assert.deepEqual(await resolveGenreSeed("romance", [hijack]), {
    bundle: buildGenreEpisodeBundle("romance"),
  });
  // …and it does not appear twice in the vocabulary either.
  assert.deepEqual(await listGenreIds([hijack]), [...GENRES]);
});

test("an unknown genre resolves to undefined rather than throwing", async () => {
  assert.equal(await resolveGenreSeed("horror"), undefined);
  assert.equal(await resolveGenreSeed("horror", [scaffold("noir")]), undefined);
});

test("registry lookups return Promises", () => {
  assert.ok(listGenreIds() instanceof Promise);
  assert.ok(resolveGenreSeed("romance") instanceof Promise);
});

test("buildInitialProject seeds a resolved bundle directly", async () => {
  const noir = scaffold("noir", "Noir");
  const project = buildInitialProject("demo", noir.bundle);
  assert.deepEqual(project.episodes, [noir.bundle]);
  // A built-in genre string still works exactly as before.
  assert.deepEqual(buildInitialProject("demo", "romance").episodes, [
    buildGenreEpisodeBundle("romance"),
  ]);
});

test("a contributed genre's gutter strip reaches the seed and the new project", async () => {
  // The whole inheritance path in one place: a genre declares the strip its
  // dialogue needs, the seed carries it, and `buildInitialProject` writes it
  // into `webtoon.json` — after which the PROJECT owns the number and nothing
  // has to find the pack again to render, lint, or export.
  const noir = { ...scaffold("noir", "Noir"), gutterBandWidth: 0.32 };
  const seed = await resolveGenreSeed("noir", [noir]);
  assert.deepEqual(seed, { bundle: noir.bundle, gutterBandWidth: 0.32 });

  const project = buildInitialProject("demo", seed?.bundle, {
    gutterBandWidth: seed?.gutterBandWidth,
  });
  assert.equal(project.webtoon.gutterBandWidth, 0.32);
  assert.equal(validateProject(project).valid, true);
});

test("a genre that declares no strip leaves the field off the new project", async () => {
  // Absent must stay absent: a defaulted number written into the file would be
  // an explicit choice the author never made, and would pin the project to
  // today's default forever.
  const seed = await resolveGenreSeed("romance");
  const project = buildInitialProject("demo", seed?.bundle, {
    gutterBandWidth: seed?.gutterBandWidth,
  });
  assert.equal("gutterBandWidth" in project.webtoon, false);
  assert.deepEqual(project.webtoon, buildInitialProject("demo", seed?.bundle).webtoon);
});
