// A pack's lettering themes and style lexicons (#334, #335) are parsed and
// validated at discovery, like genre scaffolds: a valid file is carried by id,
// an invalid or missing one is reported and skipped, and a pack that ships
// neither contributes exactly what it did before.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { loadPacks } from "../discover.js";
import { PACK_MANIFEST_FILE, PROJECT_PACKS_DIR } from "../manifest.js";
import { validatePackManifest } from "../validate.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "toony-pack-style-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const THEME = {
  themeFormat: 1,
  kinds: {
    speech: { fontFamily: "nunito", fill: "#f2f6fa" },
    narration: { fill: "#0b1420", textColor: "#dbe6f3" },
  },
};
const LEXICON = {
  lexiconFormat: 1,
  styleClause: "flat cel shading, clean ink line",
  negativeBase: "lowres, watermark",
};

test("the manifest holds theme and lexicon entries to { id, file } with unique ids", () => {
  const manifest = (extra: Record<string, unknown>) => ({
    packFormat: 1,
    id: "style",
    name: "Style",
    ...extra,
  });
  assert.deepEqual(
    validatePackManifest(manifest({ letteringThemes: [{ id: "cold", file: "themes/cold.json" }] }))
      .issues,
    [],
  );
  assert.deepEqual(
    validatePackManifest(manifest({ styleLexicons: [{ id: "cold", file: "lexicons/cold.json" }] }))
      .issues,
    [],
  );
  const codes = (extra: Record<string, unknown>) =>
    validatePackManifest(manifest(extra)).issues.map((i) => i.code);
  assert.deepEqual(codes({ letteringThemes: "x" }), ["pack.lettering-theme.type"]);
  assert.deepEqual(codes({ letteringThemes: [{ id: "", file: "a.json" }] }), [
    "pack.lettering-theme.id",
  ]);
  assert.deepEqual(
    codes({
      letteringThemes: [
        { id: "a", file: "a.json" },
        { id: "a", file: "b.json" },
      ],
    }),
    ["pack.lettering-theme.duplicate"],
  );
  assert.ok(
    codes({ styleLexicons: [{ id: "a", file: "a.txt" }] }).some((c) => c.startsWith("pack.file")),
  );
  assert.ok(codes({ styleLexicons: [{ id: "a", file: "a.json", words: 3 }] }).length > 0);
});

test("discovery carries valid themes and lexicons by id and reports the broken ones", async () => {
  const dir = join(root, PROJECT_PACKS_DIR, "style");
  await mkdir(join(dir, "themes"), { recursive: true });
  await mkdir(join(dir, "lexicons"), { recursive: true });
  await writeFile(join(dir, "themes", "cold.json"), JSON.stringify(THEME));
  await writeFile(
    join(dir, "themes", "broken.json"),
    JSON.stringify({ themeFormat: 1, kinds: { yell: {} } }),
  );
  await writeFile(join(dir, "lexicons", "cold.json"), JSON.stringify(LEXICON));
  await writeFile(
    join(dir, PACK_MANIFEST_FILE),
    JSON.stringify({
      packFormat: 1,
      id: "style",
      name: "Style",
      letteringThemes: [
        { id: "cold", file: "themes/cold.json" },
        { id: "broken", file: "themes/broken.json" },
        { id: "missing", file: "themes/missing.json" },
      ],
      styleLexicons: [{ id: "cold", file: "lexicons/cold.json" }],
    }),
  );
  const loaded = await loadPacks(root, {});
  assert.deepEqual(
    loaded.content.letteringThemes.map((t) => t.id),
    ["cold"],
  );
  assert.deepEqual(loaded.content.letteringThemes[0]?.theme, THEME);
  assert.deepEqual(
    loaded.content.styleLexicons.map((l) => l.id),
    ["cold"],
  );
  assert.deepEqual(loaded.content.styleLexicons[0]?.lexicon, LEXICON);
  assert.deepEqual(loaded.issues.map((i) => i.code).sort(), [
    "pack.lettering-theme.file-missing",
    "theme.unknown-kind",
  ]);
  assert.deepEqual(loaded.packs[0]?.contributes.letteringThemes, ["cold"]);
  assert.deepEqual(loaded.packs[0]?.contributes.styleLexicons, ["cold"]);
});

test("a pack that ships neither contributes empty lists, and an empty workspace does too", async () => {
  const dir = join(root, PROJECT_PACKS_DIR, "plain");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, PACK_MANIFEST_FILE),
    JSON.stringify({ packFormat: 1, id: "plain", name: "Plain" }),
  );
  const loaded = await loadPacks(root, {});
  assert.deepEqual(loaded.content.letteringThemes, []);
  assert.deepEqual(loaded.content.styleLexicons, []);
  assert.deepEqual(loaded.packs[0]?.contributes.letteringThemes, []);
  const none = await loadPacks(join(root, "nothing"), {});
  assert.deepEqual(none.content.letteringThemes, []);
  assert.deepEqual(none.content.styleLexicons, []);
});
