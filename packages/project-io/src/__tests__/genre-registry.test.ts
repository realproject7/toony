// The genre lookup merges contributed scaffolds with the built-in five (#192).
// The built-ins must be untouched by the merge, and must always win.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { EpisodeBundle } from "@toony/schema";
import {
  buildGenreEpisodeBundle,
  GENRES,
  type GenreScaffold,
  listGenreIds,
  resolveGenreBundle,
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
    assert.deepEqual(await resolveGenreBundle(genre), buildGenreEpisodeBundle(genre));
    // Contributed scaffolds present but unselected must not perturb a built-in.
    assert.deepEqual(
      await resolveGenreBundle(genre, [scaffold("noir")]),
      buildGenreEpisodeBundle(genre),
    );
  }
});

test("a contributed scaffold is offered and resolves to its bundle", async () => {
  const noir = scaffold("noir", "Noir");
  assert.deepEqual(await listGenreIds([noir]), [...GENRES, "noir"]);
  assert.deepEqual(await resolveGenreBundle("noir", [noir]), noir.bundle);
});

test("a contributed scaffold cannot redefine a built-in genre", async () => {
  const hijack = scaffold("romance", "Not Romance");
  assert.deepEqual(
    await resolveGenreBundle("romance", [hijack]),
    buildGenreEpisodeBundle("romance"),
  );
  // …and it does not appear twice in the vocabulary either.
  assert.deepEqual(await listGenreIds([hijack]), [...GENRES]);
});

test("an unknown genre resolves to undefined rather than throwing", async () => {
  assert.equal(await resolveGenreBundle("horror"), undefined);
  assert.equal(await resolveGenreBundle("horror", [scaffold("noir")]), undefined);
});

test("registry lookups return Promises", () => {
  assert.ok(listGenreIds() instanceof Promise);
  assert.ok(resolveGenreBundle("romance") instanceof Promise);
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
