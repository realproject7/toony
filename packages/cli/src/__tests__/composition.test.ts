import assert from "node:assert/strict";
import { test } from "node:test";
import type { ArtDirection } from "@toony/schema";
import { compositionCapabilities, compositionPrompt } from "../composition.js";

const d: ArtDirection = {
  version: 1,
  purpose: "Reveal distance between the pair",
  framing: "wide",
  camera: "Low view from the door",
  subjects: [
    {
      characterId: "a",
      position: "left",
      action: "Waits",
      expression: "Worried",
      wardrobeId: "rain",
    },
    { characterId: "b", position: "right", action: "Leaves" },
  ],
  environment: {
    setting: "Station",
    depth: "Near door, platform, distant rails",
    lighting: "Blue evening",
  },
  style: {
    linework: "Fine contours",
    color: "Blue with amber focal light",
    shading: "Broad shadows",
  },
  focalPoints: ["Gap between people"],
  lettering: { mode: "none" },
};
const cast = [
  {
    id: "a",
    name: "A",
    lockstring: "1girl, black hair",
    visualIdentity: "Round glasses",
    wardrobe: [{ id: "rain", description: "Yellow raincoat" }],
  },
  { id: "b", name: "B", lockstring: "1boy, cropped hair" },
];

test("shot leads, identities and outfits bind to individual subjects, silent art has no forced gap", () => {
  const p = compositionPrompt("A departure", d, cast);
  assert.ok(p.startsWith("Original wide image. Camera:"));
  assert.match(
    p,
    /Subject a at left: Waits.*Identity: Round glasses.*Outfit rain: Yellow raincoat/,
  );
  assert.match(p, /Subject b at right: Leaves.*cropped hair/);
  assert.doesNotMatch(p, /1girl|1boy|black hair/);
  assert.match(p, /no forced blank lettering band/);
});

test("detail composition cannot inherit a full portrait or invisible outfit", () => {
  const detail = structuredClone(d);
  detail.framing = "detail";
  assert.ok(d.subjects[0]);
  detail.subjects = [{ ...d.subjects[0], visibleDetails: ["Yellow cuff and fingertips"] }];
  const p = compositionPrompt("A hand on the latch", detail, cast);
  assert.match(p, /Yellow cuff and fingertips/);
  assert.doesNotMatch(p, /glasses|Worried|raincoat/);
  assert.match(p, /do not widen/);
});

test("capabilities never present prompt instructions as spatial controls or image editing", () => {
  const c = compositionCapabilities(d, true);
  assert.equal(c.identityReference, "one-image");
  assert.equal(c.wardrobe, "prompt-only");
  assert.equal(c.sourceImageEditing, "unsupported");
  assert.equal(c.multiCharacterReferences, "unsupported");
});
