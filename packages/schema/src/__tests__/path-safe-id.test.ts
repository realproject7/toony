import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { cloneValidProject } from "../__fixtures__/valid-project.js";
import type { ValidationResult } from "../errors.js";
import { foldingFilesystems, foldPathSafeId, isPathSafeId } from "../path-safe-id.js";
import { validateProject } from "../validate.js";

function codes(result: ValidationResult): string[] {
  return result.issues.map((issue) => issue.code);
}

test("isPathSafeId accepts plain segment ids", () => {
  assert.equal(isPathSafeId("ep-001"), true);
  assert.equal(isPathSafeId("episode_2"), true);
  assert.equal(isPathSafeId("a"), true);
});

test("isPathSafeId rejects traversal, separators, absolute, and empty", () => {
  for (const bad of [
    "",
    ".",
    "..",
    "../../outside",
    "foo/bar",
    "foo\\bar",
    "/etc/passwd",
    "C:\\Windows",
    "with\0nul",
  ]) {
    assert.equal(isPathSafeId(bad), false, `expected ${JSON.stringify(bad)} to be unsafe`);
  }
});

test("isPathSafeId rejects non-strings", () => {
  assert.equal(isPathSafeId(undefined), false);
  assert.equal(isPathSafeId(null), false);
  assert.equal(isPathSafeId(123), false);
});

test("validateProject rejects an episode id that would escape the episodes tree", () => {
  const project = cloneValidProject();
  const first = project.episodes[0];
  assert.ok(first);
  first.episode.id = "../../outside";
  const result = validateProject(project);
  assert.equal(result.valid, false);
  assert.ok(codes(result).includes("episode.id.unsafe"), JSON.stringify(result.issues));
});

test("validateProject still accepts a normal episode id", () => {
  const project = cloneValidProject();
  const result = validateProject(project);
  assert.ok(
    !codes(result).includes("episode.id.unsafe"),
    `unexpected unsafe-id issue: ${JSON.stringify(result.issues)}`,
  );
});

// --- The fold two ids share when a filesystem treats them as one name --------

// The over-aggressive direction FIRST. A fold that merges ids an author can
// tell apart refuses valid work, and there is nothing the author can do about
// it; a fold that misses a pair leaves a hazard the rest of the guard already
// lived with. These pairs are distinct on disk on a case-insensitive APFS
// volume, so the fold must keep them distinct too.
test("foldPathSafeId keeps genuinely distinct ids distinct (#317)", () => {
  for (const [a, b] of [
    ["ep-001", "ep-002"],
    // An accent is a real difference: NFC folds canonical equivalence, and
    // `e` and `\u00e9` are not canonically equivalent.
    ["ep-caf\u00e9", "ep-cafe"],
    // Compatibility equivalence is NOT folded: NFKC would merge these, and so
    // would `Intl.Collator` at accent sensitivity.
    ["ep-\u00b2", "ep-2"],
    ["ep-\u2160", "ep-I"],
    // Dotless i is its own letter outside a Turkic locale, and the filesystem
    // keeps it apart from `i`.
    ["ep-\u0131", "ep-i"],
  ]) {
    assert.ok(a !== undefined && b !== undefined);
    assert.notEqual(
      foldPathSafeId(a),
      foldPathSafeId(b),
      `expected ${JSON.stringify(a)} and ${JSON.stringify(b)} to stay distinct`,
    );
  }
});

test("foldPathSafeId folds case and Unicode normalization form alike (#317)", () => {
  for (const [a, b] of [
    ["ep-A", "ep-a"],
    // Composed e-acute against `e` + combining acute: the same text, two forms.
    ["ep-caf\u00e9", "ep-cafe\u0301"],
    // Both folds at once.
    ["EP-CAF\u00c9", "ep-cafe\u0301"],
  ]) {
    assert.ok(a !== undefined && b !== undefined);
    assert.notEqual(a, b, `${JSON.stringify(a)} and ${JSON.stringify(b)} are the same string`);
    assert.equal(
      foldPathSafeId(a),
      foldPathSafeId(b),
      `expected ${JSON.stringify(a)} and ${JSON.stringify(b)} to fold together`,
    );
  }
});

// --- What the fold does NOT close, and why nothing wider is adopted ---------

// The fold is narrower than the table a case-insensitive APFS volume folds by,
// and two places say so in prose: `foldPathSafeId`'s own comment and
// `docs/PROJECT_FORMAT.md`. Prose cannot be run, and the two records had
// already drifted into disagreeing about the same fact. So the claims live
// here, executable, and the records are read back against them.
//
// Every pair below was checked directly against a case-insensitive APFS
// volume: both members created, the listing read back, one entry returned and
// the first member's contents replaced by the second's.
const MISSED_PAIRS = [
  // LATIN SMALL LETTER LONG S.
  { label: "long s", a: "ep-ſ", b: "ep-s" },
  // LATIN SMALL LETTER SHARP S, which full case folding expands to `ss`.
  { label: "sharp s", a: "ep-ß", b: "ep-ss" },
  // LATIN SMALL LIGATURE FI.
  { label: "fi ligature", a: "ep-ﬁ", b: "ep-fi" },
  // GREEK SMALL LETTER FINAL SIGMA against GREEK SMALL LETTER SIGMA: the same
  // letter, spelled by its position in the word.
  { label: "final sigma", a: "ep-ς", b: "ep-σ" },
  // GREEK CAPITAL LETTER SIGMA against the final form. `toLowerCase()` sends
  // the capital to U+03C3, which is not where the final form already is.
  { label: "capital sigma", a: "ep-Σ", b: "ep-ς" },
] as const;

// The control in the other direction, and the reason no wider rule is adopted:
// the filesystem keeps these two apart, so a fold that merges them refuses work
// an author has no way to rephrase.
const OVER_FOLD = { a: "ep-²", b: "ep-2" } as const;

// The rules wide enough to be worth measuring, with what each one actually
// closes. Neither is the full case-folding table, and it is that gap between
// "wider" and "wide enough" that the records have to state correctly.
const WIDER_RULES = [
  {
    name: "compatibility normalization (NFKC)",
    merges: (a: string, b: string) =>
      a.normalize("NFKC").toLowerCase() === b.normalize("NFKC").toLowerCase(),
    closes: ["long s", "fi ligature"],
  },
  {
    name: "a locale collator at accent sensitivity",
    merges: (a: string, b: string) =>
      new Intl.Collator(undefined, { sensitivity: "accent" }).compare(a, b) === 0,
    closes: ["fi ligature", "final sigma", "capital sigma"],
  },
] as const;

test("the fold leaves every pair the records call open open (#317)", () => {
  for (const pair of MISSED_PAIRS) {
    assert.notEqual(
      foldPathSafeId(pair.a),
      foldPathSafeId(pair.b),
      `${pair.label}: expected ${JSON.stringify(pair.a)} and ${JSON.stringify(pair.b)} to stay distinct`,
    );
  }
});

test("no wider rule closes that gap, and each one over-folds (#317)", () => {
  for (const rule of WIDER_RULES) {
    // Exactly which pairs the rule closes, not merely "not all of them": a
    // record that says a rule closes the gap, or closes a pair it leaves open,
    // is wrong here in the direction that matters.
    assert.deepEqual(
      MISSED_PAIRS.filter((pair) => rule.merges(pair.a, pair.b)).map((pair) => pair.label),
      [...rule.closes],
      rule.name,
    );
    assert.ok(
      rule.merges(OVER_FOLD.a, OVER_FOLD.b),
      `${rule.name} no longer merges ${JSON.stringify(OVER_FOLD.a)} onto ${JSON.stringify(OVER_FOLD.b)}`,
    );
  }
  // What adopting one would cost, and what the shipped fold does instead.
  assert.notEqual(foldPathSafeId(OVER_FOLD.a), foldPathSafeId(OVER_FOLD.b));
});

// This test file compiles to dist-test/__tests__/, so the package root is two
// up and the repository root is four.
const FOLD_SOURCE = readFileSync(new URL("../../src/path-safe-id.ts", import.meta.url), "utf8");
const FORMAT_DOC = readFileSync(
  new URL("../../../../docs/PROJECT_FORMAT.md", import.meta.url),
  "utf8",
);

test("both records name every pair the gap is known to leave open (#317)", () => {
  // A reader takes the list in front of them for the extent of the accepted
  // risk. An incomplete list understates it, and the two records understating
  // it differently is how they drift apart. Each id is matched with its
  // backticks so `ep-s` is not found inside `ep-ss`.
  for (const record of [
    { name: "foldPathSafeId's comment", text: FOLD_SOURCE },
    { name: "docs/PROJECT_FORMAT.md", text: FORMAT_DOC },
  ]) {
    for (const pair of MISSED_PAIRS) {
      for (const id of [pair.a, pair.b]) {
        assert.ok(
          record.text.includes(`\`${id}\``),
          `${record.name} does not name ${JSON.stringify(id)} (${pair.label})`,
        );
      }
    }
    for (const id of [OVER_FOLD.a, OVER_FOLD.b]) {
      assert.ok(record.text.includes(`\`${id}\``), `${record.name} does not name ${id}`);
    }
  }
});

// --- Where the format doc says an episode id lives ---------------------------

// `webtoon.json` holds the character registry and no episode field, so a reader
// who follows the doc there to find the ids this guard protects finds nothing.
// The sentence that states the guarantee is read back and checked against the
// place the ids are actually written.
test("the format doc names the file that holds an episode id (#320)", () => {
  const paragraph = FORMAT_DOC.split("\n\n").find((text) =>
    text.includes("carry the same guarantee"),
  );
  assert.ok(paragraph, "docs/PROJECT_FORMAT.md no longer states the episode-id guarantee");
  assert.ok(
    paragraph.includes("`episodes/<id>/episode.yaml`"),
    `the episode-id guarantee does not name the real location: ${paragraph}`,
  );
  assert.ok(
    !paragraph.includes("webtoon.json"),
    `the episode-id guarantee still sends a reader to webtoon.json: ${paragraph}`,
  );
});

// --- Which filesystems a collision message may name -------------------------

test("a pair that differs only by case names both filesystems (#317)", () => {
  assert.equal(
    foldingFilesystems("ep-A", "ep-a"),
    "filesystems that fold case (macOS APFS, Windows NTFS)",
  );
});

// Pairs the fold merges whose two members agree lowercased but not uppercased.
// The discriminator read `toLowerCase()` alone, on the rule that a pair equal
// once lowercased differs by case alone, and these are the pairs that rule is
// wrong about: NTFS upcases each one to two strings and holds two entries.
//
// Every pair was checked the way MISSED_PAIRS was, directly against a
// case-insensitive APFS volume: both members created, the listing read back,
// one entry returned and the first member's contents replaced by the second's.
// So the refusal is right on APFS and only the phrase was ever at stake.
const LOWERCASE_ONLY_PAIRS = [
  // LATIN CAPITAL LETTER I WITH DOT ABOVE lowercases to TWO codepoints, which
  // is the id the second member already is. An expanding lowercase mapping, so
  // what lowercasing hides here is a difference in normalization form.
  { label: "dotted capital I", a: "ep-\u0130", b: "ep-i\u0307" },
  { label: "dotted capital I against NFD", a: "ep-\u0130", b: "ep-I\u0307" },
  // KELVIN SIGN, ANGSTROM SIGN and OHM SIGN are NFC singletons: each lowercases
  // onto the ordinary letter, so lowercasing hides the normalization difference
  // that NTFS preserves.
  { label: "kelvin sign", a: "ep-\u212a", b: "ep-K" },
  { label: "angstrom sign", a: "ep-\u212b", b: "ep-\u00c5" },
  { label: "ohm sign", a: "ep-\u2126", b: "ep-\u03a9" },
  // Two capitals that share one lowercase and keep their own uppercase:
  // LATIN CAPITAL LETTER SHARP S, and GREEK CAPITAL THETA SYMBOL.
  { label: "capital sharp s", a: "ep-\u1e9e", b: "ep-\u00df" },
  { label: "capital theta symbol", a: "ep-\u03f4", b: "ep-\u0398" },
  // Each of those again against the lowercase letter. A case difference on top
  // does not bring NTFS back, because the upcase table still disagrees.
  { label: "kelvin sign against lowercase k", a: "ep-\u212a", b: "ep-k" },
  { label: "angstrom sign against lowercase a-ring", a: "ep-\u212b", b: "ep-\u00e5" },
  { label: "ohm sign against lowercase omega", a: "ep-\u2126", b: "ep-\u03c9" },
  { label: "theta symbol against lowercase theta", a: "ep-\u03f4", b: "ep-\u03b8" },
] as const;

test("a pair equal only once lowercased does not name NTFS (#320)", () => {
  for (const pair of LOWERCASE_ONLY_PAIRS) {
    // The premise: this is a pair the guards refuse, and it is a pair the old
    // discriminator sent down the branch that names NTFS.
    assert.equal(
      foldPathSafeId(pair.a),
      foldPathSafeId(pair.b),
      `${pair.label}: expected the fold to merge these`,
    );
    assert.equal(
      pair.a.toLowerCase(),
      pair.b.toLowerCase(),
      `${pair.label}: expected lowercasing to make these equal`,
    );
    // NTFS folds case by an upcase table, and the table sends these two to two
    // different strings, so it holds them as two entries.
    assert.notEqual(
      pair.a.toUpperCase(),
      pair.b.toUpperCase(),
      `${pair.label}: expected uppercasing to keep these apart`,
    );
    assert.equal(
      foldingFilesystems(pair.a, pair.b),
      "filesystems that fold Unicode normalization form (macOS APFS)",
      pair.label,
    );
  }
});

test("a pair that differs by normalization form does not name NTFS (#317)", () => {
  // NTFS folds case and preserves normalization form: it holds these as two
  // directory entries, so naming it would tell a reader on Windows something
  // untrue about their own filesystem. Both ids fold together all the same.
  const nfc = "ep-café";
  const nfd = "ep-café";
  assert.equal(foldPathSafeId(nfc), foldPathSafeId(nfd));
  assert.equal(
    foldingFilesystems(nfc, nfd),
    "filesystems that fold Unicode normalization form (macOS APFS)",
  );
  // Differing by case AS WELL does not bring NTFS back: it still keeps them
  // apart, because it still preserves the normalization form.
  assert.equal(
    foldingFilesystems("EP-CAFÉ", nfd),
    "filesystems that fold Unicode normalization form (macOS APFS)",
  );
});
