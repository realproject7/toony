// Tests for the genre init templates (#101): each genre seeds a VALID,
// shape-pinned starter; no genre keeps the neutral scaffold (back-compat).

import assert from "node:assert/strict";
import { test } from "node:test";
import { validateProject } from "@toony/schema";
import { buildGenreEpisodeBundle, GENRES, type Genre, isGenre } from "../genres.js";
import { buildInitialProject } from "../scaffold.js";

test("every genre seeds a schema-valid project", () => {
  for (const genre of GENRES) {
    const project = buildInitialProject("demo", genre);
    const result = validateProject(project);
    assert.equal(result.valid, true, `${genre}: ${JSON.stringify(result.issues)}`);
  }
});

test("genre scaffolds share the pinned cold-open + beat shape", () => {
  for (const genre of GENRES) {
    const bundle = buildGenreEpisodeBundle(genre);
    // 4 cuts, 3 transitions, canonical alternating sequence.
    assert.equal(bundle.cuts.length, 4, `${genre} cut count`);
    assert.equal(bundle.transitions.length, 3, `${genre} transition count`);
    assert.equal(bundle.episode.sequence.length, 7, `${genre} sequence length`);
    assert.deepEqual(
      bundle.episode.sequence.map((s) => s.type),
      ["cut", "transition", "cut", "transition", "cut", "transition", "cut"],
      `${genre} sequence shape`,
    );
    // Every cut carries the P2 craft metadata the genre seeds.
    for (const cut of bundle.cuts) {
      assert.ok(cut.shotType, `${genre} cut ${cut.id} shotType`);
      assert.ok(cut.palette && cut.palette.length > 0, `${genre} cut ${cut.id} palette`);
      assert.ok(cut.imagePrompt.length > 0, `${genre} cut ${cut.id} prompt`);
    }
    // No run of >= 4 identical shotType (the rhythm-monotony threshold).
    const shots = bundle.cuts.map((c) => c.shotType);
    assert.ok(new Set(shots).size >= 2, `${genre} varies shotType`);
  }
});

test("each genre includes a scale/impact beat for orientation or payoff", () => {
  // Per craft §5/§9 every genre lands at least one establishing_wide (scale) or
  // impact_splash (payoff) beat — action opens tight on a montage but pulls back
  // to a wide scale reveal, so the check is presence-anywhere, not first-cut.
  for (const genre of GENRES) {
    const shots = buildGenreEpisodeBundle(genre).cuts.map((c) => c.shotType);
    assert.ok(
      shots.includes("establishing_wide") || shots.includes("impact_splash"),
      `${genre} shots ${shots.join(",")}`,
    );
  }
});

test("genre presets seed their signature craft fields", () => {
  const overlays = (g: Genre) => buildGenreEpisodeBundle(g).lettering;
  const transitions = (g: Genre) => buildGenreEpisodeBundle(g).transitions;

  // action → impact_band SFX + a black_band beat.
  assert.ok(overlays("action").some((o) => o.sfxMode === "impact_band"));
  assert.ok(transitions("action").some((t) => t.type === "black_band"));
  // comedy → hand_lettered SFX + a chibi styleTag on the misdirect reveal.
  assert.ok(overlays("comedy").some((o) => o.sfxMode === "hand_lettered"));
  assert.ok(buildGenreEpisodeBundle("comedy").cuts.some((c) => c.styleTag === "chibi"));
  // thriller → a sound-cue title_card + a desaturate_repeat pivot.
  assert.ok(transitions("thriller").some((t) => t.type === "title_card" && !!t.text));
  assert.ok(transitions("thriller").some((t) => t.type === "desaturate_repeat"));
  // romance → a palette_shift carrying a color.
  assert.ok(transitions("romance").some((t) => t.type === "palette_shift" && !!t.color));
  // at least one genre seeds a bubble tone (interiority/emphasis).
  assert.ok(GENRES.some((g) => overlays(g).some((o) => o.tone)));
});

test("attributed dialogue bubbles always carry a speaker (lint-clean attribution)", () => {
  const attributed = new Set(["speech", "thought", "shout", "whisper"]);
  for (const genre of GENRES) {
    for (const overlay of buildGenreEpisodeBundle(genre).lettering) {
      if (attributed.has(overlay.kind)) {
        assert.ok(overlay.speaker.trim().length > 0, `${genre} ${overlay.id} needs a speaker`);
      }
    }
  }
});

test("buildGenreEpisodeBundle is deterministic", () => {
  for (const genre of GENRES) {
    assert.deepEqual(buildGenreEpisodeBundle(genre), buildGenreEpisodeBundle(genre));
  }
});

test("isGenre accepts the documented genres and rejects others", () => {
  for (const genre of GENRES) assert.equal(isGenre(genre), true);
  assert.equal(isGenre("horror"), false);
  assert.equal(isGenre(""), false);
});

test("no genre keeps the neutral two-cut scaffold (back-compat)", () => {
  const neutral = buildInitialProject("demo");
  const bundle = neutral.episodes[0];
  assert.ok(bundle);
  assert.equal(bundle.cuts.length, 2);
  assert.equal(bundle.cuts[0]?.shotType, undefined);
  assert.equal(bundle.cuts[0]?.palette, undefined);
  // Still valid.
  assert.equal(validateProject(neutral).valid, true);
});
