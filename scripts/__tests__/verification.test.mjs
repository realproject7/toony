import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkTestResults, checkTestTasks, testPackages } from "../check-test-results.mjs";

const scripts = dirname(dirname(fileURLToPath(import.meta.url)));
const baseline = {
  sourceCommit: "1234567890123456789012345678901234567890",
  evidence: "independent reviewed baseline",
  packages: { "@fixture/a": 3, "fixture-b": 2 },
  reductions: {},
};
function summary(name, pass, marker = "#", changes = {}) {
  const fields = { tests: pass, pass, fail: 0, cancelled: 0, skipped: 0, todo: 0, ...changes };
  return Object.entries(fields).map(([key, value]) => `${name}:test: ${marker} ${key} ${value}`).join("\n");
}
const names = ["@fixture/a", "fixture-b"];
const full = `${summary(names[0], 3)}\n${summary(names[1], 2)}`;

test("both Node reporters are parsed independently of locale, including color escapes", () => {
  for (const locale of ["C", "C.UTF-8"]) {
    for (const marker of ["#", "ℹ"]) {
      const source = `${summary(names[0], 3, marker)}\n${summary(names[1], 2, marker)}`;
      for (const raw of [source, `\u001b[32m${source.replaceAll("\n", "\u001b[0m\n\u001b[32m")}\u001b[0m`]) {
        // Exercise an actual process with the locale inherited at startup.
        const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
          import {checkTestResults} from ${JSON.stringify(new URL("../check-test-results.mjs", import.meta.url).href)};
          console.log(checkTestResults(${JSON.stringify(raw)}, ${JSON.stringify(names)}, ${JSON.stringify(baseline)})[0]);
        `], { encoding: "utf8", env: { ...process.env, LC_ALL: locale } });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /5 passed, 2 packages/);
      }
    }
  }
});

test("zero, incomplete, duplicate, failed and cancelled reports fail closed", () => {
  for (const raw of [
    "command exited successfully",
    full.replace("fixture-b:test: # fail 0", ""),
    `${full}\n${summary(names[0], 3)}`,
    `${summary(names[0], 3, "#", { tests: 4, fail: 1 })}\n${summary(names[1], 2)}`,
    `${summary(names[0], 3, "#", { tests: 4, cancelled: 1 })}\n${summary(names[1], 2)}`,
    `${summary(names[0], 3)}\n${summary(names[1], 0)}`,
  ]) assert.throws(() => checkTestResults(raw, names, baseline));
});

test("package identities cannot be masked by a replacement task or a larger total", () => {
  assert.throws(() => checkTestTasks(["@fixture/a", "replacement"], baseline), /missing test task: fixture-b/);
  assert.throws(() => checkTestResults(`${summary(names[0], 100)}\n${summary(names[1], 1)}`, names, baseline), /test reduction: fixture-b/);
  assert.throws(() => checkTestResults(summary(names[0], 100), names, baseline), /unverifiable.*fixture-b/);
});

test("a deliberate count reduction or task removal requires a recorded reason", () => {
  const reduced = { ...baseline, reductions: { "fixture-b": { minimum: 1, reason: "Removed duplicate assertion; reviewed in the PR" } } };
  assert.match(checkTestResults(`${summary(names[0], 3)}\n${summary(names[1], 1)}`, names, reduced).join("\n"), /declared reduction/);
  reduced.reductions["fixture-b"].minimum = 0;
  assert.match(checkTestResults(summary(names[0], 3), [names[0]], reduced).join("\n"), /fixture-b -> 0/);
  reduced.reductions["fixture-b"].reason = "";
  assert.throws(() => checkTestTasks([names[0]], reduced), /invalid declared/);
});

test("deleting a real package test script is detected before the test command runs", () => {
  const root = mkdtempSync(join(tmpdir(), "toony-task-removal-"));
  try {
    mkdirSync(join(root, "packages/a"), { recursive: true });
    mkdirSync(join(root, "apps/b"), { recursive: true });
    for (const [path, name] of [["packages/a", names[0]], ["apps/b", names[1]]]) {
      writeFileSync(join(root, path, "package.json"), JSON.stringify({ name, scripts: { test: "node --test" } }));
    }
    assert.doesNotThrow(() => checkTestTasks(testPackages(root), baseline));
    writeFileSync(join(root, "apps/b/package.json"), JSON.stringify({ name: names[1], scripts: {} }));
    assert.throws(() => checkTestTasks(testPackages(root), baseline), /missing test task: fixture-b/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stage logs survive failure and deleted scratch directories without rerunning", () => {
  const root = mkdtempSync(join(tmpdir(), "toony-stage-control-"));
  try {
    const clone = join(root, "repo");
    const logs = join(root, "logs");
    mkdirSync(clone);
    mkdirSync(logs);
    writeFileSync(join(clone, "package.json"), "{}");
    for (const stage of ["install", "check", "build", "test"]) {
      const result = spawnSync("bash", ["-c", '. "$1"; run_stage "$2" bash -c \'echo "compiler diagnostic TS5083"; exit 7\'', "control", join(scripts, "release-stage.sh"), stage], {
        encoding: "utf8", env: { ...process.env, CLONE: clone, LOGS: logs, V: "24" },
      });
      assert.equal(result.status, 7);
      assert.match(result.stdout, /compiler diagnostic TS5083/);
      assert.equal(readFileSync(join(logs, `node-24-${stage}.log`), "utf8"), "compiler diagnostic TS5083\n");
    }
    const result = spawnSync("bash", ["-c", '. "$1"; run_stage test bash -c \'echo original-cause; rm -rf "$CLONE"; exit 1\'', "control", join(scripts, "release-stage.sh")], {
      encoding: "utf8", env: { ...process.env, CLONE: clone, LOGS: logs, V: "24" },
    });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /scratch checkout disappeared during stage/);
    assert.match(readFileSync(join(logs, "node-24-test.log"), "utf8"), /original-cause/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
