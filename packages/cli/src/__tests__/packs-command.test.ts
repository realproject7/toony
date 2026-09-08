// `toony packs` — the pack seam from the outside (#209).
//
// Discovery itself is tested in `@toony/packs`. What matters here is what a user
// can now see and do: which packs are installed and which root each came from, a
// directory installed and removed without knowing the precedence rules, and the
// reason a pack that is sitting on disk is not loading.
//
// The contribution lists are asserted as exact sets, never "includes". A pack
// that lost a claim and a pack that contributes nothing look the same under a
// substring check, and telling those apart is the whole point of the report.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { runInit } from "../commands/init.js";
import { runPacks } from "../commands/packs.js";
import { EXIT_OK, EXIT_USAGE, EXIT_VALIDATION } from "../exit.js";
import { run } from "../index.js";

let workdir: string;

function capture(options: { cwd?: string; env?: Record<string, string | undefined> } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      cwd: options.cwd ?? workdir,
      out: (line: string) => out.push(line),
      err: (line: string) => err.push(line),
      env: options.env,
    },
    out,
    err,
  };
}

interface RootJson {
  path: string;
  kind: string;
  exists: boolean;
  packs: number;
}

interface ListJson {
  root: string;
  roots: RootJson[];
  packs: {
    id: string;
    name: string;
    dir: string;
    root: string;
    rootKind: string;
    contributes: {
      workflows: string[];
      genres: string[];
      exportPresets: string[];
      craftBands: string[];
    };
  }[];
  issues: number;
}

interface DoctorJson {
  root: string;
  roots: RootJson[];
  packs: string[];
  issues: { pack: string; path: string; code: string; message: string }[];
}

const GRAPH = { "3": { class_type: "KSampler", inputs: { seed: 0, steps: 40 } } };

const BAND = { bandFormat: 1, metrics: { gutterRatio: { min: 0.2, max: 0.4 } } };

function scaffold(prompt: string): Record<string, unknown> {
  return {
    episode: {
      schemaVersion: 1,
      id: "ep-001",
      title: "Episode 1",
      sequence: [{ type: "cut", id: "cut-001" }],
    },
    cuts: [{ id: "cut-001", image: null, imagePrompt: prompt, negativePrompt: "" }],
    transitions: [],
    lettering: [],
  };
}

/** A complete pack directory contributing one of every kind. */
async function writePack(
  dir: string,
  id: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  await mkdir(join(dir, "workflows"), { recursive: true });
  await mkdir(join(dir, "genres"), { recursive: true });
  await mkdir(join(dir, "bands"), { recursive: true });
  await writeFile(
    join(dir, "toony-pack.json"),
    JSON.stringify({
      packFormat: 1,
      id,
      name: `${id} pack`,
      workflows: [{ name: `${id}-flow`, file: "workflows/flow.json" }],
      genres: [{ id, title: id, file: "genres/scaffold.json" }],
      exportPresets: [{ id: `${id}-preset`, target: "platform", options: { width: 1600 } }],
      craftBands: [{ id: `${id}-band`, file: "bands/band.json" }],
      ...overrides,
    }),
  );
  await writeFile(join(dir, "workflows", "flow.json"), JSON.stringify(GRAPH));
  await writeFile(join(dir, "genres", "scaffold.json"), JSON.stringify(scaffold(`${id} street`)));
  await writeFile(join(dir, "bands", "band.json"), JSON.stringify(BAND));
  return dir;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const projectPacks = (root: string) => join(root, ".toony", "packs");

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), "toony-packs-cmd-"));
});
afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

// --- Seeing what is installed ------------------------------------------------

test("list names each pack, the root it came from, and exactly what it contributes", async () => {
  const envRoot = join(workdir, "collection");
  await writePack(join(envRoot, "alpha"), "alpha");
  await writePack(join(projectPacks(workdir), "beta"), "beta");

  const c = capture({ env: { TOONY_PACKS: envRoot } });
  assert.equal(await runPacks(["list", "--json"], c.io), EXIT_OK, c.err.join("\n"));
  const report = JSON.parse(c.out.join("\n")) as ListJson;

  assert.deepEqual(
    report.packs.map((pack) => [pack.id, pack.rootKind]),
    [
      ["alpha", "env"],
      ["beta", "project"],
    ],
    "both roots contribute, in discovery order, each labelled",
  );
  assert.equal(report.packs[0]?.root, envRoot);
  assert.equal(report.packs[0]?.dir, join(envRoot, "alpha"));
  assert.deepEqual(report.packs[0]?.contributes, {
    workflows: ["alpha-flow"],
    genres: ["alpha"],
    exportPresets: ["alpha-preset"],
    craftBands: ["alpha-band"],
  });
  assert.equal(report.issues, 0);
});

test("list reports every root searched, including the ones not created yet", async () => {
  // The pack is in a folder that is not a pack root at all, which is the state a
  // user is in when they say "I copied it in and nothing happened".
  await writePack(join(workdir, "packs", "alpha"), "alpha");

  const c = capture();
  assert.equal(await runPacks(["list", "--json"], c.io), EXIT_OK, c.err.join("\n"));
  const report = JSON.parse(c.out.join("\n")) as ListJson;

  assert.deepEqual(report.packs, []);
  assert.deepEqual(
    report.roots.map((root) => [root.kind, root.path, root.exists]),
    [
      ["project", projectPacks(workdir), false],
      ["workspace", projectPacks(join(workdir, "..")), false],
    ],
    "the roots Toony looked in, so the missing one is visible",
  );
});

// --- Being told why a pack is not loading ------------------------------------

test("a pack with no manifest is reported by path and code, and doctor exits 1", async () => {
  await writePack(join(projectPacks(workdir), "good"), "good");

  // Control first: doctor must not simply always fail.
  const clean = capture();
  assert.equal(await runPacks(["doctor"], clean.io), EXIT_OK, clean.err.join("\n"));
  assert.match(clean.out.join("\n"), /problems: none/);

  const broken = join(projectPacks(workdir), "mine");
  await mkdir(broken, { recursive: true });

  const c = capture();
  assert.equal(await runPacks(["doctor", "--json"], c.io), EXIT_VALIDATION);
  const report = JSON.parse(c.out.join("\n")) as DoctorJson;
  assert.deepEqual(report.packs, ["good"], "the good pack still loads");
  assert.deepEqual(
    report.issues.map((issue) => [issue.pack, issue.path, issue.code]),
    [[broken, "toony-pack.json", "pack.manifest-missing"]],
  );
  assert.match(report.issues[0]?.message ?? "", /every pack must declare one/);
});

test("a genre claimed by an earlier pack is absent from the list and explained by doctor", async () => {
  // The reported failure: a pack is installed, `toony init --genre` still does
  // not offer its genre, and nothing said why.
  const envRoot = join(workdir, "collection");
  await writePack(join(envRoot, "first"), "first");
  const second = join(projectPacks(workdir), "second");
  await writePack(second, "second", {
    genres: [{ id: "first", title: "Second", file: "genres/scaffold.json" }],
  });

  const env = { TOONY_PACKS: envRoot };
  const list = capture({ env });
  assert.equal(await runPacks(["list", "--json"], list.io), EXIT_OK, list.err.join("\n"));
  const report = JSON.parse(list.out.join("\n")) as ListJson;
  assert.deepEqual(report.packs[0]?.contributes.genres, ["first"], "the first claim keeps the id");
  assert.deepEqual(
    report.packs[1]?.contributes.genres,
    [],
    "the loser contributes no genre at all, and says so",
  );
  assert.deepEqual(report.packs[1]?.contributes.workflows, ["second-flow"], "its rest is intact");
  assert.equal(report.issues, 1);

  // The text listing points at the command that explains the problem.
  const text = capture({ env });
  assert.equal(await runPacks(["list"], text.io), EXIT_OK);
  assert.match(text.err.join("\n"), /1 pack problem\(s\) found; run `toony packs doctor`/);

  const doctor = capture({ env });
  assert.equal(await runPacks(["doctor", "--json"], doctor.io), EXIT_VALIDATION);
  const problems = JSON.parse(doctor.out.join("\n")) as DoctorJson;
  assert.deepEqual(
    problems.issues.map((issue) => [issue.pack, issue.path, issue.code]),
    [[second, "genres.first", "pack.genre.claimed"]],
  );
  assert.match(problems.issues[0]?.message ?? "", /rename it in this pack/);
});

test("doctor text output carries the path, the code, and the fix for every problem", async () => {
  const dir = join(projectPacks(workdir), "gap");
  await writePack(dir, "gap", {
    workflows: [{ name: "gap-flow", file: "workflows/absent.json" }],
  });

  const c = capture();
  assert.equal(await runPacks(["doctor"], c.io), EXIT_VALIDATION);
  const text = c.out.join("\n");
  assert.match(text, /problems: 1/);
  assert.ok(text.includes(dir), "the folder to open is named");
  assert.match(text, /\[pack\.workflow\.file-missing\] workflows\.gap-flow: /);
  assert.match(text, /workflow file "workflows\/absent\.json" could not be read/);
});

// --- Installing and removing -------------------------------------------------

test("an installed pack lands in the project root and its genre becomes selectable", async () => {
  const source = await writePack(join(workdir, "source", "noir"), "noir");

  const c = capture();
  assert.equal(await runPacks(["install", source], c.io), EXIT_OK, c.err.join("\n"));
  const dest = join(projectPacks(workdir), "noir");
  assert.ok(c.out.join("\n").includes(`installed "noir" (noir pack) to ${dest}`));

  // The nested data files came with it, byte for byte.
  assert.equal(
    await readFile(join(dest, "genres", "scaffold.json"), "utf8"),
    await readFile(join(source, "genres", "scaffold.json"), "utf8"),
  );

  // What the install is FOR: the genre is now in the vocabulary.
  const init = capture();
  assert.equal(await runInit(["story", "--genre", "noir"], init.io), EXIT_OK, init.err.join("\n"));
  const cuts = await readFile(join(workdir, "story", "episodes", "ep-001", "cuts.yaml"), "utf8");
  assert.match(cuts, /noir street/);
});

test("--workspace installs one level up, so every project in the folder sees it", async () => {
  const source = await writePack(join(workdir, "source", "noir"), "noir");
  const project = join(workdir, "story");
  await mkdir(project, { recursive: true });

  const c = capture();
  assert.equal(await runPacks(["install", source, project, "--workspace"], c.io), EXIT_OK);
  assert.ok(await exists(join(projectPacks(workdir), "noir")));

  const list = capture();
  assert.equal(await runPacks(["list", project, "--json"], list.io), EXIT_OK);
  const report = JSON.parse(list.out.join("\n")) as ListJson;
  assert.deepEqual(
    report.packs.map((pack) => [pack.id, pack.rootKind]),
    [["noir", "workspace"]],
  );

  const init = capture({ cwd: project });
  assert.equal(await runInit(["inner", "--genre", "noir"], init.io), EXIT_OK, init.err.join("\n"));
});

test("a directory that is not a valid pack is refused, and nothing is written", async () => {
  const source = await writePack(join(workdir, "source", "evil"), "evil", { main: "./evil.js" });

  const c = capture();
  assert.equal(await runPacks(["install", source], c.io), EXIT_USAGE);
  const errors = c.err.join("\n");
  assert.match(errors, /\[pack\.unexpected-field\] pack\.main: /);
  assert.match(errors, /can never declare code/);
  assert.equal(
    await exists(projectPacks(workdir)),
    false,
    "a refused install creates no pack root at all",
  );
});

test("install treats a URL as a path and fails; nothing about a pack is fetched", async () => {
  const c = capture();
  assert.equal(await runPacks(["install", "https://example.com/pack.zip"], c.io), EXIT_USAGE);
  assert.match(c.err.join("\n"), /never downloads one/);
  assert.equal(await exists(projectPacks(workdir)), false);
});

test("no packs subcommand reaches the network", async () => {
  // Every command here works on directories that are already on the machine, so
  // a fetch of any kind is a bug. This fails loudly instead of silently
  // succeeding against a live host.
  const source = await writePack(join(workdir, "source", "noir"), "noir");
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("a packs command reached the network");
  }) as typeof fetch;
  try {
    for (const args of [["install", source], ["list"], ["doctor"], ["remove", "noir"]]) {
      const c = capture();
      assert.equal(await runPacks(args, c.io), EXIT_OK, `${args.join(" ")}: ${c.err.join("\n")}`);
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("an existing install is kept unless --force is passed, and --force replaces it", async () => {
  const source = await writePack(join(workdir, "source", "noir"), "noir");
  await writeFile(join(source, "extra.json"), JSON.stringify({ dropped: true }));
  const first = capture();
  assert.equal(await runPacks(["install", source], first.io), EXIT_OK, first.err.join("\n"));

  await rm(join(source, "extra.json"));
  const dest = join(projectPacks(workdir), "noir");

  const refused = capture();
  assert.equal(await runPacks(["install", source], refused.io), EXIT_USAGE);
  assert.match(refused.err.join("\n"), /pass --force to replace it/);
  assert.ok(await exists(join(dest, "extra.json")), "the refused install changed nothing");

  const forced = capture();
  assert.equal(await runPacks(["install", source, "--force"], forced.io), EXIT_OK);
  assert.equal(
    await exists(join(dest, "extra.json")),
    false,
    "--force replaces the directory rather than merging into it",
  );
  assert.deepEqual((await readdir(dest)).sort(), [
    "bands",
    "genres",
    "toony-pack.json",
    "workflows",
  ]);
});

test("a removed pack is off disk and out of the genre vocabulary", async () => {
  const source = await writePack(join(workdir, "source", "noir"), "noir");
  const install = capture();
  assert.equal(await runPacks(["install", source], install.io), EXIT_OK);

  const c = capture();
  assert.equal(await runPacks(["remove", "noir"], c.io), EXIT_OK, c.err.join("\n"));
  assert.equal(await exists(join(projectPacks(workdir), "noir")), false);

  const init = capture();
  assert.equal(await runInit(["story", "--genre", "noir"], init.io), EXIT_USAGE);
  assert.match(init.err.join("\n"), /unknown genre "noir"/);
});

test("remove takes the project copy and never deletes inside a TOONY_PACKS collection", async () => {
  const envRoot = join(workdir, "collection");
  const shared = await writePack(join(envRoot, "noir"), "noir");
  const source = await writePack(join(workdir, "source", "noir"), "noir");
  const env = { TOONY_PACKS: envRoot };
  const install = capture({ env });
  assert.equal(await runPacks(["install", source], install.io), EXIT_OK);

  // The collection copy wins discovery, but the removable copy is the local one.
  const local = capture({ env });
  assert.equal(await runPacks(["remove", "noir"], local.io), EXIT_OK, local.err.join("\n"));
  assert.equal(await exists(join(projectPacks(workdir), "noir")), false);
  assert.ok(await exists(shared), "the collection is untouched");

  const refused = capture({ env });
  assert.equal(await runPacks(["remove", "noir"], refused.io), EXIT_USAGE);
  assert.match(refused.err.join("\n"), /TOONY_PACKS collection/);
  assert.ok(await exists(shared));
});

test("a pack that never loaded can still be removed by its folder name", async () => {
  const broken = join(projectPacks(workdir), "mine");
  await mkdir(broken, { recursive: true });
  await writeFile(join(broken, "toony-pack.json"), "{ not json");

  const c = capture();
  assert.equal(await runPacks(["remove", "mine"], c.io), EXIT_OK, c.err.join("\n"));
  assert.equal(await exists(broken), false);

  const doctor = capture();
  assert.equal(await runPacks(["doctor"], doctor.io), EXIT_OK, doctor.out.join("\n"));
});

test("removing an id that is not installed names the ids that are", async () => {
  await writePack(join(projectPacks(workdir), "alpha"), "alpha");
  const c = capture();
  assert.equal(await runPacks(["remove", "beta"], c.io), EXIT_USAGE);
  assert.match(c.err.join("\n"), /no pack "beta" is installed/);
  assert.match(c.err.join("\n"), /installed: alpha/);
  assert.ok(await exists(join(projectPacks(workdir), "alpha")));
});

test("a traversing id is refused before anything on disk is touched", async () => {
  const outside = join(workdir, "outside");
  await mkdir(outside, { recursive: true });
  const c = capture();
  assert.equal(await runPacks(["remove", "../outside"], c.io), EXIT_USAGE);
  assert.match(c.err.join("\n"), /path-safe segment/);
  assert.ok(await exists(outside));
});

// --- Usage -------------------------------------------------------------------

test("an unknown subcommand and a flag a subcommand ignores are usage errors", async () => {
  const unknown = capture();
  assert.equal(await runPacks(["frobnicate"], unknown.io), EXIT_USAGE);
  assert.match(unknown.err.join("\n"), /unknown packs subcommand: frobnicate/);

  const missing = capture();
  assert.equal(await runPacks([], missing.io), EXIT_USAGE);
  assert.match(missing.err.join("\n"), /missing subcommand/);

  // A flag that would be silently ignored is refused instead: nobody should get
  // a human table while believing they asked for JSON.
  const source = await writePack(join(workdir, "source", "noir"), "noir");
  const flag = capture();
  assert.equal(await runPacks(["install", source, "--json"], flag.io), EXIT_USAGE);
  assert.match(flag.err.join("\n"), /--json is not an option of "toony packs install"/);
  assert.equal(await exists(projectPacks(workdir)), false);
});

test("the command is reachable through the CLI dispatcher and documented in help", async () => {
  const c = capture();
  assert.equal(await run(["packs", "list"], c.io), EXIT_OK, c.err.join("\n"));
  assert.match(c.out.join("\n"), /no packs installed/);

  const help = capture();
  assert.equal(await run(["--help"], help.io), EXIT_OK);
  assert.match(help.out.join("\n"), /toony packs <list\|doctor\|install\|remove>/);
});
