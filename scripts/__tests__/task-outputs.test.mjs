import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { inspectTaskOutputs } from "../check-task-outputs.mjs";

const require = createRequire(import.meta.url);
const compiler = join(dirname(require.resolve("typescript/package.json")), "bin/tsc");

function files(root, prefix = "") {
  return readdirSync(join(root, prefix), { withFileTypes: true })
    .flatMap((entry) => {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      return entry.isDirectory() ? files(root, path) : [path];
    })
    .sort();
}

function fixture(options, run) {
  const root = mkdtempSync(join(tmpdir(), "toony-compiler-control-"));
  try {
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src/index.ts"), "export const answer = 42;\n");
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { outDir: "dist", lib: ["es5"], types: [], skipLibCheck: true, ...options },
        include: ["src/*.ts"],
      }),
    );
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function compile(root, args) {
  const result = spawnSync(process.execPath, [compiler, ...args], { cwd: root, encoding: "utf8" });
  assert.equal(result.signal, null, result.stderr);
  assert.ifError(result.error);
  return result;
}

function inspect(root, args) {
  return inspectTaskOutputs(
    [
      {
        taskId: "fixture#test",
        package: "fixture",
        directory: ".",
        command: `tsc ${args.join(" ")}`,
        outputs: ["dist/**", "override/**"],
      },
      {
        taskId: "fixture#other",
        package: "fixture",
        directory: ".",
        command: "echo another writer",
        outputs: ["dist/**", "override/**"],
      },
    ],
    root,
  );
}

const cases = [
  ["config noEmit", { noEmit: true }, [], []],
  ["outDir does not enable emit", { noEmit: true }, ["--outDir", "override"], []],
  ["explicit false enables emit", { noEmit: true }, ["--noEmit", "false"], ["dist/index.js"]],
  ["explicit false and outDir", { noEmit: true }, ["--noEmit", "false", "--outDir", "override"], ["override/index.js"]],
  ["default emit", {}, [], ["dist/index.js"]],
  ["bare noEmit disables emit", {}, ["--noEmit"], []],
  ["outDir overrides destination", {}, ["--outDir", "override"], ["override/index.js"]],
];

for (const [name, options, flags, expected] of cases) {
  test(`pinned compiler disk output: ${name}`, () => {
    fixture(options, (root) => {
      const args = ["-p", "tsconfig.json", ...flags];
      const result = compile(root, args);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const emitted = files(root).filter((path) => !["src/index.ts", "tsconfig.json"].includes(path));
      assert.deepEqual(emitted, expected);
      const verdict = inspect(root, args);
      // The conflicting task is real checker input. A disk emit must be flagged;
      // a non-emitting compiler must not be called a second writer.
      assert.equal(verdict.findings.length > 0, emitted.length > 0);
      assert.equal(verdict.checked, emitted.length > 0 ? 1 : 0);
      for (const finding of verdict.findings) {
        assert.match(finding.detail, /two writers, one directory/);
        assert.ok(emitted.some((path) => finding.detail.includes(`"${dirname(path)}"`)));
      }
    });
  });
}

for (const mode of ["incremental", "composite"]) {
  for (const [name, options, expected] of [
    ["no rootDir", {}, "dist/tsconfig.tsbuildinfo"],
    ["source rootDir", { rootDir: "src" }, "tsconfig.tsbuildinfo"],
    ["explicit build info", { tsBuildInfoFile: "cache/custom.tsbuildinfo" }, "cache/custom.tsbuildinfo"],
  ]) {
    test(`noEmit ${mode} build information: ${name}`, () => {
      fixture({ noEmit: true, [mode]: true, ...options }, (root) => {
        const result = compile(root, ["-p", "tsconfig.json"]);
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.deepEqual(files(root), [expected, "src/index.ts", "tsconfig.json"].sort());
        // Build-info files are recorded here but deliberately outside this
        // checker's JS/declaration emit-directory contract.
        assert.deepEqual(inspect(root, ["-p", "tsconfig.json"]), { findings: [], checked: 0 });
      });
    });
  }
}

for (const args of [
  ["--project=tsconfig.json"],
  ["-p=tsconfig.json"],
  ["-p", "tsconfig.json", "--outDir=override"],
  ["-p", "tsconfig.json", "--noEmit=false"],
]) {
  test(`compiler and checker reject inline options: ${args.join(" ")}`, () => {
    fixture({}, (root) => {
      const result = compile(root, args);
      assert.notEqual(result.status, 0);
      assert.match(result.stdout + result.stderr, /TS5023/);
      assert.deepEqual(files(root), ["src/index.ts", "tsconfig.json"]);
      assert.ok(inspect(root, args).findings.some((finding) => /unsupported inline/.test(finding.detail)));
    });
  });
}

test("the controls use the repository's pinned compiler", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const pinned = require(join(root, "package.json")).devDependencies.typescript;
  assert.equal(require("typescript/package.json").version, pinned);
});
