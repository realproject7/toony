#!/usr/bin/env node
// Run a package's compiled test files with node:test, and FAIL when none are
// found — so a green test command can never silently mean "zero tests ran".
//
// Discovery is done in Node (recursive directory walk for *.test.js) and the
// files are passed explicitly to `node --test`. This avoids both shell glob and
// Node-side glob expansion, so it behaves identically on Node 20 (engines floor)
// through current releases, where a bare directory or glob argument can report
// zero tests and still exit 0.

import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2];
if (!root) {
  console.error("usage: run-tests.mjs <compiled-output-dir>");
  process.exit(2);
}

function findTestFiles(dir) {
  const found = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      found.push(...findTestFiles(full));
    } else if (name.endsWith(".test.js")) {
      found.push(full);
    }
  }
  return found;
}

const files = findTestFiles(root).sort();
if (files.length === 0) {
  console.error(`run-tests: no compiled test files (*.test.js) found under "${root}".`);
  console.error("Refusing to report success with zero tests. Did the build emit tests?");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
if (result.error) {
  console.error(`run-tests: failed to launch the test runner: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
