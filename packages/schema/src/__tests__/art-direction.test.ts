import assert from "node:assert/strict";
import { test } from "node:test";
import { cloneValidProject } from "../__fixtures__/valid-project.js";
import {
  type ArtDirection,
  artDirectionIssues,
  validateArtDirection,
  validateCharacterCraft,
} from "../art-direction.js";
import { IssueCollector } from "../errors.js";
import type { Cut } from "../types.js";
import { validateProject } from "../validate.js";

function direction(): ArtDirection {
  return {
    version: 1,
    purpose: "Orient the reader",
    framing: "wide",
    camera: "Eye level across the street",
    subjects: [],
    environment: {
      setting: "A quiet street",
      depth: "Near rail, middle road, distant buildings",
      lighting: "Overcast daylight",
    },
    style: { linework: "Thin ink", color: "Muted blue", shading: "Soft masses" },
    focalPoints: ["One lit window"],
    lettering: { mode: "none" },
  };
}

test("silent scenery permits an empty cast without forced lettering space", () => {
  const d = direction(),
    c = new IssueCollector();
  validateArtDirection(d, "art", c);
  assert.deepEqual(c.result().issues, []);
  const project = cloneValidProject();
  Object.assign(project.episodes[0]?.cuts[0] ?? {}, { artDirection: d, characters: [] });
  assert.equal(validateProject(project).valid, true);
});

test("composition refuses impossible space, unsupported keys and unbounded values", () => {
  const d = direction();
  const r = { x: 0.1, y: 0.1, width: 0.4, height: 0.4, description: "Face" };
  d.protectedRegions = [r];
  d.lettering = { mode: "reserved", regions: [{ ...r, description: "Dialogue" }] };
  const c = new IssueCollector();
  validateArtDirection({ ...d, privateEndpoint: "forbidden", camera: "x".repeat(4001) }, "art", c);
  const codes = c.result().issues.map((i) => i.code);
  assert.ok(codes.includes("art.space-conflict"));
  assert.ok(codes.includes("art.unknown-key"));
  assert.ok(codes.includes("art.text"));
});

test("continuity catches wardrobe drift and cannot point forward", () => {
  const a = {
    id: "a",
    artDirection: {
      ...direction(),
      subjects: [{ characterId: "hero", position: "left", action: "Waiting", wardrobeId: "coat" }],
    },
  } as Cut;
  const b = structuredClone(a);
  b.id = "b";
  assert.ok(b.artDirection?.subjects[0]);
  b.artDirection.subjects[0].wardrobeId = "shirt";
  b.artDirection.continuity = { fromCutId: "a", preserve: ["Identity"] };
  const cast = [
    {
      id: "hero",
      name: "Hero",
      lockstring: "Cropped hair",
      wardrobe: [
        { id: "coat", description: "Grey coat" },
        { id: "shirt", description: "Blue shirt" },
      ],
    },
  ];
  assert.match(artDirectionIssues(b, cast, [a, b]).join(), /Outfit change/);
  b.artDirection.continuity.changes = ["Took off coat indoors"];
  assert.deepEqual(artDirectionIssues(b, cast, [a, b]), []);
  assert.match(artDirectionIssues(b, cast, [b, a]).join(), /earlier cut/);
});

test("detail shots require visible details and cast/outfit references resolve", () => {
  const d = direction();
  d.framing = "detail";
  d.subjects = [
    { characterId: "hero", position: "center", action: "Reaching", wardrobeId: "missing" },
  ];
  const cut = { id: "a", characters: [], artDirection: d } as unknown as Cut;
  const issues = artDirectionIssues(cut, [{ id: "hero", name: "Hero", lockstring: "Hair" }], [cut]);
  assert.equal(issues.length, 3);
});

test("character craft rejects duplicate outfits and incomplete development", () => {
  const c = new IssueCollector();
  validateCharacterCraft(
    {
      wardrobe: [
        { id: "coat", description: "Grey" },
        { id: "coat", description: "Blue" },
      ],
      development: { role: "Protagonist" },
    },
    "hero",
    c,
  );
  assert.ok(c.result().issues.some((i) => i.code === "character.duplicate-outfit"));
  assert.ok(c.result().issues.some((i) => i.path.endsWith("desire")));
});

test("a character's avoid tags are optional text", () => {
  const ok = new IssueCollector();
  validateCharacterCraft({ avoid: "straight hair, stubble" }, "hero", ok);
  validateCharacterCraft({}, "hero", ok);
  assert.deepEqual(ok.result().issues, []);
  const bad = new IssueCollector();
  validateCharacterCraft({ avoid: ["straight hair"] }, "hero", bad);
  validateCharacterCraft({ avoid: "" }, "hero", bad);
  assert.equal(bad.result().issues.filter((i) => i.path.endsWith("avoid")).length, 2);
});
