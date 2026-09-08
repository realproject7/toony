// Back-compat for projects written before #208 retired `LetteringOverlay.font`.
//
// The shipped example projects predate #208: every overlay in them carries a
// `font` name. Reading their real bytes through the real reader is what proves
// the retirement did not strand them, so nothing here is hand-built.

import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { letteringFile } from "../paths.js";
import { loadProject } from "../reader.js";
import { writeLettering } from "../writer.js";

const EXAMPLES = ["dead-air", "last-train"];

// This file compiles to dist/__tests__/, so the repository root is four up.
function exampleRoot(name: string): string {
  return fileURLToPath(new URL(`../../../../examples/${name}`, import.meta.url));
}

test("the shipped example projects load and validate with their stored font", async () => {
  for (const name of EXAMPLES) {
    const loaded = await loadProject(exampleRoot(name));
    assert.equal(
      loaded.validation.valid,
      true,
      `${name}: ${JSON.stringify(loaded.validation.issues)}`,
    );
    const lettering = loaded.project.episodes[0]?.lettering ?? [];
    assert.ok(lettering.length > 0, `${name} has no lettering`);
    // The reader must hand the value back untouched: accepted, never stripped,
    // never replaced. A stripped field would make this a vacuous back-compat
    // test everywhere else in the suite.
    for (const overlay of lettering) {
      assert.equal(typeof overlay.font, "string", `${name} ${overlay.id} lost its font name`);
    }
  }
});

test("saving a pre-#208 project keeps its stored font and adds none", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "toony-legacy-"));
  try {
    const root = join(workdir, "last-train");
    await cp(exampleRoot("last-train"), root, { recursive: true });
    const path = letteringFile(root, "ep-001");
    const before = JSON.parse(await readFile(path, "utf8"));

    // The studio save path: load, hand the overlays straight back to the writer.
    const loaded = await loadProject(root);
    const lettering = loaded.project.episodes[0]?.lettering ?? [];
    await writeLettering(root, "ep-001", lettering);

    // The writer normalizes key order, so compare records, not bytes.
    const after = JSON.parse(await readFile(path, "utf8"));
    assert.deepEqual(after, before, "a no-op save changed a pre-#208 lettering file");
    const reloaded = await loadProject(root);
    assert.equal(reloaded.validation.valid, true, JSON.stringify(reloaded.validation.issues));
    assert.deepEqual(reloaded.project.episodes[0]?.lettering, lettering);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});
