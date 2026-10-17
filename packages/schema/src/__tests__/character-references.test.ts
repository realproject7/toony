// A character's reference sheets (#327): project-relative paths under the
// character's own folder, unique, optional. Whether the file is there is a lint
// question, so the validator accepts a sheet that is not drawn yet.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Webtoon } from "../types.js";
import { validateWebtoon } from "../validate.js";

function webtoon(references?: string[]): Webtoon {
  return {
    schemaVersion: 1,
    projectId: "demo",
    title: "Demo",
    languages: {
      defaultLanguage: "en",
      supportedLanguages: ["en"],
      dialogueLanguage: "en",
      promptLanguage: "en",
    },
    imageProviders: { defaultProvider: "manual", providers: [] },
    characters: [
      {
        id: "mira",
        name: "Mira",
        lockstring: "teal coat",
        ...(references === undefined ? {} : { references }),
      },
    ],
  };
}

test("a registry entry without references validates as it always did", () => {
  assert.deepEqual(validateWebtoon(webtoon()).issues, []);
});

test("references are project-relative paths under the character's folder, unique", () => {
  assert.deepEqual(
    validateWebtoon(webtoon(["characters/mira/sheet.png", "characters/mira/turnaround.png"]))
      .issues,
    [],
  );
  const codes = (refs: unknown) =>
    validateWebtoon(webtoon(refs as string[])).issues.map((issue) => issue.code);
  assert.deepEqual(codes("characters/mira/sheet.png"), ["character.references"]);
  assert.deepEqual(codes([""]), ["character.reference"]);
  assert.deepEqual(codes(["/abs/sheet.png"]), ["character.reference-path"]);
  assert.deepEqual(codes(["characters/mira/../../secret.png"]), ["character.reference-path"]);
  assert.deepEqual(codes(["characters/sol/sheet.png"]), ["character.reference-folder"]);
  assert.deepEqual(codes(["assets/sheet.png"]), ["character.reference-folder"]);
  assert.deepEqual(codes(["characters/mira/a.png", "characters/mira/a.png"]), [
    "character.reference-duplicate",
  ]);
});

test("an issue names the entry it is about", () => {
  const result = validateWebtoon(webtoon(["characters/mira/a.png", "elsewhere/b.png"]));
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]?.path, "webtoon.characters[0].references[1]");
});
