// Unit tests for character lockstring injection into the generate prompt (#92).
// Pure/deterministic — asserts the composed prompt with no live provider.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Character } from "@toony/schema";
import { injectCharacterLockstrings } from "../commands/generate.js";

const REGISTRY: Character[] = [
  {
    id: "mina",
    name: "Mina",
    lockstring: "short black bob, amber eyes, red scarf, flat cel style",
  },
  { id: "rex", name: "Rex", lockstring: "tall, grey hoodie, square jaw, flat cel style" },
];

test("no character refs leaves the prompt unchanged", () => {
  assert.equal(
    injectCharacterLockstrings("rain-soaked alley", undefined, REGISTRY),
    "rain-soaked alley",
  );
  assert.equal(injectCharacterLockstrings("rain-soaked alley", [], REGISTRY), "rain-soaked alley");
});

test("a referenced character's lockstring is prepended verbatim", () => {
  assert.equal(
    injectCharacterLockstrings("rain-soaked alley at night", ["mina"], REGISTRY),
    "short black bob, amber eyes, red scarf, flat cel style, rain-soaked alley at night",
  );
});

test("multiple refs inject in cut order, deduplicated", () => {
  assert.equal(
    injectCharacterLockstrings("on the rooftop", ["rex", "mina", "rex"], REGISTRY),
    "tall, grey hoodie, square jaw, flat cel style, short black bob, amber eyes, red scarf, flat cel style, on the rooftop",
  );
});

test("unknown ids are skipped (lint flags them); all-unknown leaves prompt unchanged", () => {
  assert.equal(
    injectCharacterLockstrings("base", ["ghost", "mina"], REGISTRY),
    "short black bob, amber eyes, red scarf, flat cel style, base",
  );
  assert.equal(injectCharacterLockstrings("base", ["ghost"], REGISTRY), "base");
  assert.equal(injectCharacterLockstrings("base", ["mina"], []), "base");
});

test("a character with a blank lockstring contributes nothing", () => {
  const reg: Character[] = [{ id: "blank", name: "Blank", lockstring: "   " }];
  assert.equal(injectCharacterLockstrings("base", ["blank"], reg), "base");
});

test("injection is deterministic for the same inputs", () => {
  const a = injectCharacterLockstrings("scene", ["mina", "rex"], REGISTRY);
  const b = injectCharacterLockstrings("scene", ["mina", "rex"], REGISTRY);
  assert.equal(a, b);
});
