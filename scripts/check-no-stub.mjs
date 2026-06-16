#!/usr/bin/env node
// No-stub checker for the Toony repository.
//
// Toony forbids stub / placeholder / temporary runtime code. This script scans // no-stub-ignore: describes the checker
// tracked source and documentation files for stub markers and exits 1 if any // no-stub-ignore: describes the checker
// are found outside of test and fixture files.
//
// Excluded automatically:
//   - test files: *.test.*, *.spec.*, anything under __tests__/ or tests/
//   - fixture files: anything under fixtures/ or named *.fixture.*
//
// Per-line escape hatch (for legitimate prose, e.g. docs stating this rule):
//   - Append `no-stub-ignore: <reason>` to the line.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const IGNORE_MARKER = "no-stub-ignore:"; // no-stub-ignore: defines the marker

const SKIP_DIR_PATTERN = /(^|\/)(node_modules|\.git|dist|build|\.next|\.turbo)(\/|$)/;

const FIXTURE_PATTERN =
  /(^|\/)(fixtures|__fixtures__)(\/)|\.fixture\.|(^|\/)(tests?|__tests__)(\/)|\.test\.|\.spec\./;

const SCANNED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".md",
  ".mdx",
  ".txt",
  ".yaml",
  ".yml",
  ".toml",
  ".css",
  ".html",
]);

// Marker rules. Built so the patterns themselves carry the ignore marker on // no-stub-ignore: describes the checker
// their own definition lines and are excluded from the scan of this file.
const MARKERS = [
  { name: "todo", regex: /\bTODO\b/ }, // no-stub-ignore: rule definition
  { name: "fixme", regex: /\bFIXME\b/ }, // no-stub-ignore: rule definition
  { name: "xxx", regex: /\bXXX\b/ }, // no-stub-ignore: rule definition
  { name: "hack", regex: /\bHACK\b/ }, // no-stub-ignore: rule definition
  { name: "stub", regex: /(?<!no-)\bstub\b/i }, // no-stub-ignore: rule definition
  { name: "placeholder", regex: /\bplaceholder\b/i }, // no-stub-ignore: rule definition
  { name: "temporary", regex: /\btemporary\b/i }, // no-stub-ignore: rule definition
  // `mock` only as a runtime identifier (call / import / new), not the word.
  { name: "mock-runtime", regex: /\bmock[A-Za-z0-9_]*\s*\(|\bnew\s+Mock|from\s+['"][^'"]*mock/i }, // no-stub-ignore: rule definition
];

function listTrackedFiles() {
  const output = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  return output.split("\0").filter((f) => f.length > 0);
}

function isFixtureOrTest(file) {
  return FIXTURE_PATTERN.test(file);
}

function scanFile(file) {
  const findings = [];
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    return findings;
  }

  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(IGNORE_MARKER)) continue;
    for (const marker of MARKERS) {
      if (marker.regex.test(line)) {
        findings.push({ file, line: i + 1, marker: marker.name });
      }
    }
  }
  return findings;
}

function main() {
  const files = listTrackedFiles();
  const findings = [];
  let checked = 0;

  for (const file of files) {
    if (SKIP_DIR_PATTERN.test(file)) continue;
    if (isFixtureOrTest(file)) continue;
    if (!SCANNED_EXTENSIONS.has(extname(file).toLowerCase())) continue;
    checked++;
    findings.push(...scanFile(file));
  }

  if (findings.length === 0) {
    console.log(`no-stub check: OK (${checked} files checked)`);
    return;
  }

  console.error(`no-stub check: FAILED — ${findings.length} stub marker(s):\n`); // no-stub-ignore: output message
  for (const f of findings) {
    console.error(`  [${f.marker}] ${f.file}:${f.line}`);
  }
  console.error(
    "\nRemove the stub/placeholder code, move it to a named test/fixture file, " + // no-stub-ignore: output message
      "or append `no-stub-ignore: <reason>` for legitimate prose.",
  );
  process.exit(1);
}

main();
