#!/usr/bin/env node
// Independent package identities and per-package floors. A successful command
// is insufficient: every current test task must report a complete node:test run.
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

export function testPackages(root) {
  const names = [];
  // These are the two workspace globs in pnpm-workspace.yaml.
  for (const directory of ["packages", "apps"]) {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkg = JSON.parse(readFileSync(join(root, directory, entry.name, "package.json"), "utf8"));
      if (typeof pkg.scripts?.test === "string" && pkg.scripts.test.trim()) names.push(pkg.name);
    }
  }
  return names.sort();
}

export function baselineFloors(baseline) {
  if (!/^[a-f0-9]{40}$/.test(baseline.sourceCommit) || !baseline.evidence?.trim()) {
    throw new Error("test baseline must name its independent source commit and evidence");
  }
  const floors = new Map(Object.entries(baseline.packages));
  if (floors.size === 0) throw new Error("test baseline has no package identities");
  for (const [name, count] of floors) {
    if (!name || !Number.isSafeInteger(count) || count <= 0) {
      throw new Error(`invalid test floor for ${name}`);
    }
  }
  for (const [name, reduction] of Object.entries(baseline.reductions ?? {})) {
    if (
      !floors.has(name) ||
      !Number.isSafeInteger(reduction.minimum) ||
      reduction.minimum < 0 ||
      reduction.minimum >= floors.get(name) ||
      typeof reduction.reason !== "string" ||
      !reduction.reason.trim()
    ) {
      throw new Error(`invalid declared test reduction for ${name}`);
    }
    floors.set(name, reduction.minimum);
  }
  return floors;
}

export function checkTestTasks(names, baseline) {
  const floors = baselineFloors(baseline);
  if (names.length === 0 || new Set(names).size !== names.length) {
    throw new Error("test tasks have no package identities or contain duplicate names");
  }
  for (const [name, minimum] of floors) {
    if (minimum > 0 && !names.includes(name)) {
      throw new Error(`missing test task: ${name} (baseline floor ${minimum})`);
    }
  }
  return floors;
}

export function checkTestResults(raw, names, baseline) {
  const floors = checkTestTasks(names, baseline);
  const reports = new Map();
  // Explicit node:test markers, independent of locale. POSIX [^[:alnum:]]
  // rejected Node 24's U+2139 in C.UTF-8 while accepting it in C (#282).
  for (const line of stripVTControlCharacters(raw).split(/\r?\n/)) {
    const match = /^(.+):test:\s+(?:#|ℹ)\s+(tests|pass|fail|cancelled|skipped|todo)\s+(\d+)\s*$/.exec(line);
    if (!match) continue;
    const [, name, field, value] = match;
    if (!names.includes(name)) throw new Error(`unexpected test report: ${name}`);
    const report = reports.get(name) ?? {};
    if (field in report) throw new Error(`duplicate ${field} summary for ${name}`);
    report[field] = Number(value);
    reports.set(name, report);
  }
  let total = 0;
  const lines = [];
  for (const name of names) {
    const report = reports.get(name);
    const fields = ["tests", "pass", "fail", "cancelled", "skipped", "todo"];
    if (!report || fields.some((field) => !Number.isSafeInteger(report[field]))) {
      throw new Error(`unverifiable test output: ${name} has no complete node:test summary`);
    }
    if (report.fail || report.cancelled || report.pass === 0) {
      throw new Error(`unsuccessful test run: ${name} (${JSON.stringify(report)})`);
    }
    if (report.tests !== report.pass + report.fail + report.cancelled + report.skipped + report.todo) {
      throw new Error(`inconsistent test totals for ${name}`);
    }
    const minimum = floors.get(name) ?? 1;
    if (report.pass < minimum) {
      throw new Error(`test reduction: ${name} passed ${report.pass}, baseline requires ${minimum}`);
    }
    total += report.pass;
    lines.push(`  ${name}: ${report.pass} passed (floor ${minimum})`);
  }
  for (const [name, reduction] of Object.entries(baseline.reductions ?? {})) {
    lines.push(`  declared reduction: ${name} -> ${reduction.minimum}: ${reduction.reason}`);
  }
  return [`test coverage: PASS (${total} passed, ${names.length} packages)`, ...lines];
}

function main() {
  const root = process.cwd();
  const baseline = JSON.parse(readFileSync(join(root, "scripts/test-baseline.json"), "utf8"));
  const names = testPackages(root);
  checkTestTasks(names, baseline);
  if (process.argv[2] === "--tasks") {
    console.log(`test tasks: PASS (${names.length} packages; baseline ${baseline.sourceCommit})`);
    return;
  }
  if (!process.argv[2]) throw new Error("usage: check-test-results.mjs <test.log> | --tasks");
  for (const line of checkTestResults(readFileSync(process.argv[2], "utf8"), names, baseline)) {
    console.log(line);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`test coverage: FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}
