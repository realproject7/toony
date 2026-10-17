#!/usr/bin/env node
// Independent package identities and per-package floors. A successful command
// is insufficient: every current test task must report a complete node:test run.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

// A floor may trail the count it guards by at most this many tests. A wider gap
// means tests were added and the floor was not raised, and the floor has stopped
// being one: on 2026-09-22 two floors trailed by 31 and 34, so every test merged
// that day could be deleted with the gate green (#322). Raise the floor in the
// PR that adds the tests; the failure names the number to set.
export const FLOOR_SLACK = 3;

export function testPackages(root) {
  const names = [];
  // These are the two workspace globs in pnpm-workspace.yaml.
  for (const directory of ["packages", "apps"]) {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkg = JSON.parse(
        readFileSync(join(root, directory, entry.name, "package.json"), "utf8"),
      );
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
  if (!Number.isSafeInteger(baseline.verification) || baseline.verification <= 0) {
    throw new Error("test baseline has no verification floor for the scripts/__tests__ controls");
  }
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
    const match =
      /^(.+):test:\s+(?:#|ℹ)\s+(tests|pass|fail|cancelled|skipped|todo)\s+(\d+)\s*$/.exec(line);
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
    if (
      report.tests !==
      report.pass + report.fail + report.cancelled + report.skipped + report.todo
    ) {
      throw new Error(`inconsistent test totals for ${name}`);
    }
    const minimum = floors.get(name) ?? 1;
    if (report.pass < minimum) {
      throw new Error(
        `test reduction: ${name} passed ${report.pass}, baseline requires ${minimum}`,
      );
    }
    total += report.pass;
    lines.push(`  ${name}: ${report.pass} passed (floor ${minimum})`);
  }
  // Checked after every floor and summary, so a reduction or a missing summary
  // is named before a floor that merely needs raising.
  for (const name of names) {
    const minimum = floors.get(name) ?? 1;
    const pass = reports.get(name).pass;
    if (pass > minimum + FLOOR_SLACK) {
      throw new Error(
        `floor trails: ${name} passed ${pass}, baseline floor ${minimum}; raise it to ${pass} in scripts/test-baseline.json in the PR that added the tests`,
      );
    }
  }
  for (const [name, reduction] of Object.entries(baseline.reductions ?? {})) {
    lines.push(`  declared reduction: ${name} -> ${reduction.minimum}: ${reduction.reason}`);
  }
  return [`test coverage: PASS (${total} passed, ${names.length} packages)`, ...lines];
}

/**
 * The `pnpm test:verification` controls have no package identity and no turbo
 * prefix, so the package check above never sees them. This reads their one
 * node:test summary and holds it to `baseline.verification` the same way.
 */
export function checkVerificationResults(raw, baseline) {
  const floor = baseline.verification;
  if (!Number.isSafeInteger(floor) || floor <= 0) {
    throw new Error("test baseline has no verification floor for the scripts/__tests__ controls");
  }
  const report = {};
  for (const line of stripVTControlCharacters(raw).split(/\r?\n/)) {
    // The marker is at the start of the line: a package summary carries a
    // `<name>:test:` prefix and must not be mistaken for this one.
    const match = /^\s*(?:#|ℹ)\s+(tests|pass|fail|cancelled|skipped|todo)\s+(\d+)\s*$/.exec(line);
    if (!match) continue;
    const [, field, value] = match;
    if (field in report) throw new Error(`duplicate ${field} summary for verification controls`);
    report[field] = Number(value);
  }
  const fields = ["tests", "pass", "fail", "cancelled", "skipped", "todo"];
  if (fields.some((field) => !Number.isSafeInteger(report[field]))) {
    throw new Error(
      "unverifiable test output: verification controls have no complete node:test summary",
    );
  }
  if (report.fail || report.cancelled || report.pass === 0) {
    throw new Error(`unsuccessful test run: verification controls (${JSON.stringify(report)})`);
  }
  if (
    report.tests !==
    report.pass + report.fail + report.cancelled + report.skipped + report.todo
  ) {
    throw new Error("inconsistent test totals for verification controls");
  }
  if (report.pass < floor) {
    throw new Error(
      `test reduction: verification controls passed ${report.pass}, baseline requires ${floor}`,
    );
  }
  if (report.pass > floor + FLOOR_SLACK) {
    throw new Error(
      `floor trails: verification controls passed ${report.pass}, baseline floor ${floor}; raise "verification" to ${report.pass} in scripts/test-baseline.json in the PR that added the controls`,
    );
  }
  return `verification coverage: PASS (${report.pass} passed, floor ${floor})`;
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
  if (process.argv[2] === "--verification") {
    if (!process.argv[3]) {
      throw new Error("usage: check-test-results.mjs --verification <verification.log>");
    }
    console.log(checkVerificationResults(readFileSync(process.argv[3], "utf8"), baseline));
    return;
  }
  if (!process.argv[2]) {
    throw new Error(
      "usage: check-test-results.mjs <test.log> | --tasks | --verification <verification.log>",
    );
  }
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
