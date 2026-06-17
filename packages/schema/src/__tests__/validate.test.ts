import assert from "node:assert/strict";
import { test } from "node:test";
import { cloneValidProject, validProject } from "../__fixtures__/valid-project.js";
import type { ValidationResult } from "../errors.js";
import { validateProject, validateWebtoon } from "../validate.js";

function codes(result: ValidationResult): string[] {
  return result.issues.map((issue) => issue.code);
}

test("a fully valid project passes with no issues", () => {
  const result = validateProject(validProject);
  assert.equal(result.valid, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
});

test("non-object input fails fast", () => {
  const result = validateProject(null);
  assert.equal(result.valid, false);
  assert.ok(codes(result).includes("project.type"));
});

test("default language must be listed in supportedLanguages", () => {
  const project = cloneValidProject();
  project.webtoon.languages.defaultLanguage = "fr";
  const result = validateProject(project);
  assert.equal(result.valid, false);
  assert.ok(codes(result).includes("language.not-supported"));
});

test("supportedLanguages must be non-empty", () => {
  const project = cloneValidProject();
  project.webtoon.languages.supportedLanguages = [];
  const result = validateWebtoon(project.webtoon);
  assert.equal(result.valid, false);
  assert.ok(codes(result).includes("languages.supported"));
});

test("unknown defaultProvider is rejected", () => {
  const project = cloneValidProject();
  project.webtoon.imageProviders.defaultProvider = "ghost";
  const result = validateWebtoon(project.webtoon);
  assert.ok(codes(result).includes("imageProviders.default-unknown"));
});

test("a configured provider id satisfies defaultProvider", () => {
  const project = cloneValidProject();
  project.webtoon.imageProviders.providers = [{ id: "local-comfy", kind: "comfyui" }];
  project.webtoon.imageProviders.defaultProvider = "local-comfy";
  const result = validateWebtoon(project.webtoon);
  assert.equal(result.valid, true, JSON.stringify(result.issues));
});

test("provider records reject private metadata fields", () => {
  const project = cloneValidProject();
  project.webtoon.imageProviders.providers = [
    {
      id: "cloud-x",
      kind: "constrained-cloud",
      // Private provider details must not be accepted on a provider record.
      apiKey: "should-not-be-here",
      endpoint: "https://provider.example/v1",
    } as unknown as (typeof project.webtoon.imageProviders.providers)[number],
  ];
  project.webtoon.imageProviders.defaultProvider = "cloud-x";
  const result = validateWebtoon(project.webtoon);
  assert.equal(result.valid, false);
  const unexpected = result.issues.filter((issue) => issue.code === "provider.unexpected-field");
  assert.equal(unexpected.length, 2, JSON.stringify(result.issues));
  assert.deepEqual(unexpected.map((issue) => issue.path).sort(), [
    "webtoon.imageProviders.providers[0].apiKey",
    "webtoon.imageProviders.providers[0].endpoint",
  ]);
});

test("duplicate cut ids are reported", () => {
  const project = cloneValidProject();
  const bundle = project.episodes[0];
  assert.ok(bundle);
  bundle.cuts.push({ id: "cut-001", image: null, imagePrompt: "", negativePrompt: "" });
  const result = validateProject(project);
  assert.ok(codes(result).includes("cut.duplicate-id"));
});

test("duplicate lettering overlay ids are reported", () => {
  const project = cloneValidProject();
  const bundle = project.episodes[0];
  assert.ok(bundle);
  const overlay = bundle.lettering[0];
  assert.ok(overlay);
  bundle.lettering.push({ ...overlay, cutId: "cut-002" });
  const result = validateProject(project);
  assert.ok(codes(result).includes("overlay.duplicate-id"));
});

test("sequence referencing a missing cut record fails", () => {
  const project = cloneValidProject();
  const bundle = project.episodes[0];
  assert.ok(bundle);
  bundle.episode.sequence.push({ type: "cut", id: "cut-999" });
  const result = validateProject(project);
  assert.ok(codes(result).includes("sequence.missing-cut"));
});

test("a record not referenced by the sequence is an orphan", () => {
  const project = cloneValidProject();
  const bundle = project.episodes[0];
  assert.ok(bundle);
  bundle.transitions.push({
    id: "tr-orphan",
    type: "fade",
    gutterHeight: 0,
    text: null,
    sfx: null,
    agentNote: null,
    humanNote: null,
    image: null,
    reviewStatus: "draft",
  });
  const result = validateProject(project);
  assert.ok(codes(result).includes("transition.orphan"));
});

test("the sequence may not begin or end with a transition", () => {
  const project = cloneValidProject();
  const bundle = project.episodes[0];
  assert.ok(bundle);
  bundle.episode.sequence = [
    { type: "transition", id: "tr-001" },
    { type: "cut", id: "cut-001" },
  ];
  bundle.cuts = [{ id: "cut-001", image: null, imagePrompt: "", negativePrompt: "" }];
  const result = validateProject(project);
  assert.ok(codes(result).includes("sequence.leading-transition"));
});

test("two adjacent transitions are rejected", () => {
  const project = cloneValidProject();
  const bundle = project.episodes[0];
  assert.ok(bundle);
  bundle.episode.sequence = [
    { type: "cut", id: "cut-001" },
    { type: "transition", id: "tr-001" },
    { type: "transition", id: "tr-002" },
    { type: "cut", id: "cut-002" },
  ];
  bundle.transitions.push({
    id: "tr-002",
    type: "beat",
    gutterHeight: 24,
    text: null,
    sfx: null,
    agentNote: null,
    humanNote: null,
    image: null,
    reviewStatus: "draft",
  });
  const result = validateProject(project);
  assert.ok(codes(result).includes("sequence.adjacent-transitions"));
});

test("bubble geometry must stay inside the cut image", () => {
  const project = cloneValidProject();
  const overlay = project.episodes[0]?.lettering[0];
  assert.ok(overlay);
  overlay.geometry = { x: 0.8, y: 0.1, width: 0.5, height: 0.2 };
  const result = validateProject(project);
  assert.ok(codes(result).includes("geometry.x-overflow"));
});

test("tail must be a normalized point when present", () => {
  const project = cloneValidProject();
  const overlay = project.episodes[0]?.lettering[0];
  assert.ok(overlay);
  overlay.tail = { x: 1.5, y: 0.5 };
  const result = validateProject(project);
  assert.ok(codes(result).includes("tail.bounds"));
});

test("opacity outside 0..1 is rejected", () => {
  const project = cloneValidProject();
  const overlay = project.episodes[0]?.lettering[0];
  assert.ok(overlay);
  overlay.opacity = 1.4;
  const result = validateProject(project);
  assert.ok(codes(result).includes("overlay.opacity"));
});

test("an unknown transition type is rejected", () => {
  const project = cloneValidProject();
  const transition = project.episodes[0]?.transitions[0];
  assert.ok(transition);
  (transition as { type: string }).type = "wormhole";
  const result = validateProject(project);
  assert.ok(codes(result).includes("transition.kind"));
});

test("gutterHeight outside the allowed px range is rejected", () => {
  const project = cloneValidProject();
  const transition = project.episodes[0]?.transitions[0];
  assert.ok(transition);
  transition.gutterHeight = 999999;
  const result = validateProject(project);
  assert.ok(codes(result).includes("transition.gutter"));
});

test("lettering referencing a missing cut record fails", () => {
  const project = cloneValidProject();
  const overlay = project.episodes[0]?.lettering[0];
  assert.ok(overlay);
  overlay.cutId = "cut-404";
  const result = validateProject(project);
  assert.ok(codes(result).includes("overlay.missing-cut"));
});

test("absolute image paths in cut records are rejected", () => {
  const project = cloneValidProject();
  const cut = project.episodes[0]?.cuts[0];
  assert.ok(cut);
  cut.image = { clean: "/etc/passwd", final: null };
  const result = validateProject(project);
  assert.ok(codes(result).includes("cut.image-path"));
});

test("cut prompt fields are accepted as strings", () => {
  const project = cloneValidProject();
  const cut = project.episodes[0]?.cuts[0];
  assert.ok(cut);
  cut.imagePrompt = "a quiet harbor at dawn";
  cut.negativePrompt = "text, watermark";
  const result = validateProject(project);
  assert.equal(result.valid, true, JSON.stringify(result.issues));
});

test("cuts without prompt fields still validate (back-compat)", () => {
  const project = cloneValidProject();
  const cut = project.episodes[0]?.cuts[0];
  assert.ok(cut);
  // Simulate an older record that predates the prompt fields.
  delete (cut as { imagePrompt?: string }).imagePrompt;
  delete (cut as { negativePrompt?: string }).negativePrompt;
  const result = validateProject(project);
  assert.equal(result.valid, true, JSON.stringify(result.issues));
});

test("non-string cut prompt fields are rejected", () => {
  const project = cloneValidProject();
  const cut = project.episodes[0]?.cuts[0];
  assert.ok(cut);
  (cut as unknown as { imagePrompt: unknown }).imagePrompt = 42;
  const result = validateProject(project);
  assert.ok(codes(result).includes("cut.prompt"));
});

test("every issue carries a path, code, and message", () => {
  const result = validateProject(null);
  for (const issue of result.issues) {
    assert.equal(typeof issue.path, "string");
    assert.ok(issue.code.length > 0);
    assert.ok(issue.message.length > 0);
  }
});

test("narration and sfx overlays may have an empty speaker", () => {
  const project = cloneValidProject();
  const overlay = project.episodes[0]?.lettering[0];
  assert.ok(overlay);
  overlay.kind = "narration";
  overlay.speaker = "";
  const result = validateProject(project);
  assert.equal(result.valid, true, JSON.stringify(result.issues));
});

test("attributed kinds still require a non-empty speaker", () => {
  const project = cloneValidProject();
  const overlay = project.episodes[0]?.lettering[0];
  assert.ok(overlay);
  overlay.kind = "speech";
  overlay.speaker = "";
  const result = validateProject(project);
  assert.equal(result.valid, false);
  assert.ok(codes(result).includes("field.required"));
});

// --- Pro-lettering style fields (#54) --------------------------------------

test("an overlay with no style fields is valid (back-compatible)", () => {
  // The default fixture overlay carries none of the new fields.
  const result = validateProject(validProject);
  assert.equal(result.valid, true, JSON.stringify(result.issues));
});

test("a fully populated style overlay validates", () => {
  const project = cloneValidProject();
  const overlay = project.episodes[0]?.lettering[0];
  assert.ok(overlay);
  overlay.fontSize = 24;
  overlay.fontWeight = 600;
  overlay.lineHeight = 1.4;
  overlay.textAlign = "left";
  overlay.letterSpacing = 0.05;
  overlay.textColor = "#223344";
  overlay.cornerRadius = 18;
  overlay.zIndex = 3;
  const result = validateProject(project);
  assert.equal(result.valid, true, JSON.stringify(result.issues));
});

test("fontSize accepts null (auto-fit) and rejects out-of-range", () => {
  const project = cloneValidProject();
  const overlay = project.episodes[0]?.lettering[0];
  assert.ok(overlay);
  overlay.fontSize = null;
  assert.equal(validateProject(project).valid, true);
  overlay.fontSize = 5; // below FONT_SIZE_MIN_PX
  assert.ok(codes(validateProject(project)).includes("style.font-size"));
  overlay.fontSize = 201; // above FONT_SIZE_MAX_PX
  assert.ok(codes(validateProject(project)).includes("style.font-size"));
});

test("fontWeight must be one of the allowed weights", () => {
  const project = cloneValidProject();
  const overlay = project.episodes[0]?.lettering[0];
  assert.ok(overlay);
  overlay.fontWeight = 500;
  assert.equal(validateProject(project).valid, true);
  overlay.fontWeight = 450 as unknown as typeof overlay.fontWeight;
  assert.ok(codes(validateProject(project)).includes("style.font-weight"));
});

test("lineHeight, letterSpacing, and cornerRadius enforce their bounds", () => {
  const project = cloneValidProject();
  const overlay = project.episodes[0]?.lettering[0];
  assert.ok(overlay);
  overlay.lineHeight = 0.5;
  assert.ok(codes(validateProject(project)).includes("style.line-height"));
  overlay.lineHeight = 1.2;
  overlay.letterSpacing = 0.6;
  assert.ok(codes(validateProject(project)).includes("style.letter-spacing"));
  overlay.letterSpacing = 0;
  overlay.cornerRadius = 300;
  assert.ok(codes(validateProject(project)).includes("style.corner-radius"));
  overlay.cornerRadius = -1;
  assert.ok(codes(validateProject(project)).includes("style.corner-radius"));
});

test("textAlign must be an allowed enum value", () => {
  const project = cloneValidProject();
  const overlay = project.episodes[0]?.lettering[0];
  assert.ok(overlay);
  overlay.textAlign = "justify" as unknown as typeof overlay.textAlign;
  assert.ok(codes(validateProject(project)).includes("style.text-align"));
});

test("textColor must be a non-empty string when present", () => {
  const project = cloneValidProject();
  const overlay = project.episodes[0]?.lettering[0];
  assert.ok(overlay);
  overlay.textColor = "";
  assert.ok(codes(validateProject(project)).includes("style.text-color"));
});

test("zIndex must be a non-negative integer", () => {
  const project = cloneValidProject();
  const overlay = project.episodes[0]?.lettering[0];
  assert.ok(overlay);
  overlay.zIndex = -1;
  assert.ok(codes(validateProject(project)).includes("style.z-index"));
  overlay.zIndex = 1.5;
  assert.ok(codes(validateProject(project)).includes("style.z-index"));
});

// --- Curated font family (#56) ----------------------------------------------

test("fontFamily accepts a curated id and is back-compatible when absent", () => {
  const project = cloneValidProject();
  const overlay = project.episodes[0]?.lettering[0];
  assert.ok(overlay);
  // Absent is valid (the default fixture overlay omits it).
  assert.equal(validateProject(project).valid, true);
  // A known curated id is valid.
  overlay.fontFamily = "bangers";
  assert.equal(
    validateProject(project).valid,
    true,
    JSON.stringify(validateProject(project).issues),
  );
  overlay.fontFamily = "noto-sans-kr";
  assert.equal(validateProject(project).valid, true);
});

test("fontFamily rejects an unknown family id", () => {
  const project = cloneValidProject();
  const overlay = project.episodes[0]?.lettering[0];
  assert.ok(overlay);
  overlay.fontFamily = "comic-sans" as unknown as typeof overlay.fontFamily;
  assert.ok(codes(validateProject(project)).includes("style.font-family"));
});

// --- Character registry + cut.characters (#92) -----------------------------

test("a project without a character registry is valid (back-compat)", () => {
  // validProject has no webtoon.characters and no cut.characters.
  assert.equal(validateProject(validProject).valid, true);
});

test("a valid character registry validates", () => {
  const project = cloneValidProject();
  project.webtoon.characters = [
    {
      id: "mina",
      name: "Mina",
      lockstring: "short black bob, amber eyes, red scarf, flat cel style",
    },
    { id: "rex", name: "Rex", lockstring: "tall, grey hoodie, square jaw, flat cel style" },
  ];
  assert.equal(
    validateProject(project).valid,
    true,
    JSON.stringify(validateProject(project).issues),
  );
});

test("duplicate character ids are reported", () => {
  const project = cloneValidProject();
  project.webtoon.characters = [
    { id: "dup", name: "A", lockstring: "x" },
    { id: "dup", name: "B", lockstring: "y" },
  ];
  assert.ok(codes(validateProject(project)).includes("character.duplicate-id"));
});

test("a character with an empty lockstring/name/id is rejected", () => {
  const project = cloneValidProject();
  project.webtoon.characters = [{ id: "mina", name: "Mina", lockstring: "" }];
  assert.ok(codes(validateProject(project)).includes("field.required"));
});

test("cut.characters must be an array of non-empty strings", () => {
  const project = cloneValidProject();
  const cut = project.episodes[0]?.cuts[0];
  assert.ok(cut);
  cut.characters = ["" as string];
  assert.ok(codes(validateProject(project)).includes("cut.character-ref"));
  cut.characters = "mina" as unknown as string[];
  assert.ok(codes(validateProject(project)).includes("cut.characters"));
});

test("a cut may reference characters; schema does not check refs exist (lint does)", () => {
  const project = cloneValidProject();
  const cut = project.episodes[0]?.cuts[0];
  assert.ok(cut);
  cut.characters = ["not-in-registry"]; // no registry defined
  // Structurally valid — an unknown ref is a lint warning, not a schema error.
  assert.equal(
    validateProject(project).valid,
    true,
    JSON.stringify(validateProject(project).issues),
  );
});

// --- Bubble grammar: kinds, tone, tailTarget (#93) -------------------------

test("beat and ambient are valid bubble kinds", () => {
  const project = cloneValidProject();
  const overlay = project.episodes[0]?.lettering[0];
  assert.ok(overlay);
  for (const kind of ["beat", "ambient"] as const) {
    overlay.kind = kind;
    overlay.speaker = ""; // beat/ambient are unattributed-friendly; set non-empty if needed
    overlay.speaker = "X";
    assert.equal(
      validateProject(project).valid,
      true,
      `${kind}: ${JSON.stringify(validateProject(project).issues)}`,
    );
  }
});

test("tone must be one of the allowed tones when present", () => {
  const project = cloneValidProject();
  const overlay = project.episodes[0]?.lettering[0];
  assert.ok(overlay);
  overlay.tone = "aggressive";
  assert.equal(validateProject(project).valid, true);
  overlay.tone = "angry" as unknown as typeof overlay.tone;
  assert.ok(codes(validateProject(project)).includes("overlay.tone"));
});

test("tailTarget may be off-panel (outside 0..1) but must be finite, or null", () => {
  const project = cloneValidProject();
  const overlay = project.episodes[0]?.lettering[0];
  assert.ok(overlay);
  overlay.tailTarget = { x: 1.5, y: -0.2 }; // off-panel — allowed
  assert.equal(
    validateProject(project).valid,
    true,
    JSON.stringify(validateProject(project).issues),
  );
  overlay.tailTarget = null;
  assert.equal(validateProject(project).valid, true);
  overlay.tailTarget = { x: Number.NaN, y: 0.5 } as unknown as typeof overlay.tailTarget;
  assert.ok(codes(validateProject(project)).includes("tail-target.bounds"));
});

test("an overlay without tone/tailTarget is valid (back-compat)", () => {
  // The default fixture overlay carries neither field.
  assert.equal(validateProject(validProject).valid, true);
});
