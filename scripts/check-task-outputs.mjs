#!/usr/bin/env node
// Task output-directory checker for the Toony repository.
//
// The release gate reads turbo's task summary. A summary is only worth reading
// if the directories it describes are the directories the tasks actually wrote.
// Two tasks sharing one output directory breaks that in two ways at once (#253):
//
//   1. Turbo orders tasks by their declared dependencies. Two tasks with no edge
//      between them run AT THE SAME TIME. `@toony/schema:build` and
//      `@toony/schema:test` have no edge — `test` depends on `^build`, its
//      dependencies' builds, not its own — so when both emitted into `dist` they
//      overwrote each other's files mid-emit. A concurrent asset copy died with
//      ENOENT; a consumer importing that `dist` got a half-written module and
//      failed with a missing export.
//   2. Turbo's cache is keyed on a task's inputs and restores that task's
//      DECLARED outputs. A second task writing into `dist` is invisible to it,
//      so `dist` could hold the test compile while `build` reported FULL TURBO.
//      Anyone verifying a newly merged field checks the built artifact, and the
//      artifact and the green summary disagreed.
//
// The rule that removes both, checked here:
//
//   Every directory a task compiles into is declared in THAT task's turbo
//   `outputs`, and is not covered by any other task's outputs in the same
//   package.
//
// WHAT THIS IS: the emit directory of each `tsc -p <config>` in a task's
// command, resolved through the config's `extends` chain, matched against the
// output globs turbo itself reports for that task. Turbo is asked for the
// resolved task definitions rather than turbo.json being re-parsed, so
// package-specific overrides are honoured.
//
// WHAT THIS IS NOT: it does not see emits from tasks that compile by some route
// other than `tsc -p` (`next build`, the CLI's esbuild bundle). Those write the
// directories `build` already declares, and they are single-writer; this checks
// the shape that was actually multi-writer.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");

/** Strip `//` and block comments from JSON with comments (tsconfig, turbo.json). */
function stripJsonComments(text) {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inLine) {
      if (c === "\n") {
        inLine = false;
        out += c;
      }
      continue;
    }
    if (inBlock) {
      if (c === "*" && next === "/") {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += c;
      if (c === "\\") {
        out += next ?? "";
        i++;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === "/" && next === "/") {
      inLine = true;
      i++;
      continue;
    }
    if (c === "/" && next === "*") {
      inBlock = true;
      i++;
      continue;
    }
    out += c;
  }
  return out;
}

function readJsonc(file) {
  return JSON.parse(stripJsonComments(readFileSync(file, "utf8")));
}

/**
 * Resolve a tsconfig's effective `outDir` and `noEmit` through its `extends`
 * chain. `outDir` is relative to the config that declares it, which is what tsc
 * does and what makes an inherited `outDir` land in the right package.
 */
function resolveTsconfig(configPath) {
  const seen = new Set();
  let outDir;
  let outDirFrom;
  let noEmit;
  let current = configPath;
  while (current && !seen.has(current)) {
    seen.add(current);
    const json = readJsonc(current);
    const options = json.compilerOptions ?? {};
    if (outDir === undefined && typeof options.outDir === "string") {
      outDir = options.outDir;
      outDirFrom = dirname(current);
    }
    if (noEmit === undefined && typeof options.noEmit === "boolean") {
      noEmit = options.noEmit;
    }
    current =
      typeof json.extends === "string" ? resolve(dirname(current), json.extends) : undefined;
  }
  return {
    outDir: outDir === undefined ? undefined : resolve(outDirFrom, outDir),
    noEmit: noEmit === true,
  };
}

/** Every `tsc -p <config>` (or `--project <config>`) in a shell command. */
function tscProjects(command) {
  const found = [];
  const pattern = /(?:^|&&|\|\||;|\|)\s*(?:\S*\btsc)\b([^&|;]*)/g;
  for (const match of command.matchAll(pattern)) {
    const args = match[1] ?? "";
    const project = args.match(/(?:-p|--project)\s+(\S+)/);
    if (!project) continue;
    found.push({ config: project[1], noEmitFlag: /--noEmit\b/.test(args) });
  }
  return found;
}

/**
 * Does an output glob cover this directory? The glob's literal prefix (the text
 * before its first wildcard) is the deepest path it can be rooted at, so a glob
 * covers a directory when that prefix is the directory or an ancestor of it.
 * `!`-prefixed globs exclude, and are applied last.
 */
function globsCover(globs, dirRelative) {
  let covered = false;
  for (const glob of globs) {
    const negated = glob.startsWith("!");
    const body = negated ? glob.slice(1) : glob;
    const literal = body.split(/[*?[]/)[0].replace(/\/+$/, "");
    if (literal === "") continue;
    if (
      dirRelative === literal ||
      dirRelative.startsWith(`${literal}/`) ||
      literal.startsWith(`${dirRelative}/`)
    ) {
      covered = !negated;
    }
  }
  return covered;
}

function turboTasks() {
  const turboConfig = readJsonc(join(repoRoot, "turbo.json"));
  // Derive the task list from turbo.json so a task added there is checked
  // without this script being edited. `<pkg>#<task>` keys contribute their task.
  const taskNames = [
    ...new Set(Object.keys(turboConfig.tasks ?? {}).map((k) => k.split("#").pop())),
  ];
  if (taskNames.length === 0) {
    console.error("task-outputs check: turbo.json declares no tasks.");
    process.exit(1);
  }
  const raw = execFileSync("pnpm", ["exec", "turbo", "run", ...taskNames, "--dry=json"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const start = raw.indexOf("{");
  if (start < 0) {
    console.error("task-outputs check: turbo produced no JSON to read.");
    process.exit(1);
  }
  return { taskNames, tasks: JSON.parse(raw.slice(start)).tasks ?? [] };
}

function main() {
  const { taskNames, tasks } = turboTasks();
  const findings = [];
  let checked = 0;

  // Emit directories per package, so one task's directory can be tested against
  // every other task's declared outputs in the same package.
  const outputsByTask = new Map();
  for (const task of tasks) {
    const declared = task.resolvedTaskDefinition?.outputs ?? task.outputs ?? [];
    outputsByTask.set(task.taskId, declared);
  }

  for (const task of tasks) {
    const packageDir = resolve(repoRoot, task.directory);
    for (const { config, noEmitFlag } of tscProjects(task.command ?? "")) {
      const configPath = isAbsolute(config) ? config : join(packageDir, config);
      let resolved;
      try {
        resolved = resolveTsconfig(configPath);
      } catch (error) {
        findings.push({
          taskId: task.taskId,
          detail: `cannot read tsconfig "${config}": ${error.message}`,
        });
        continue;
      }
      if (noEmitFlag || resolved.noEmit) continue;
      if (resolved.outDir === undefined) {
        findings.push({
          taskId: task.taskId,
          detail: `"${config}" emits but declares no outDir, so turbo cannot know where its output lands`,
        });
        continue;
      }
      checked++;
      const dirRelative = relative(packageDir, resolved.outDir);
      const own = outputsByTask.get(task.taskId) ?? [];
      if (!globsCover(own, dirRelative)) {
        findings.push({
          taskId: task.taskId,
          detail:
            `compiles "${config}" into "${dirRelative}", which its own turbo outputs ` +
            `(${JSON.stringify(own)}) do not cover — turbo neither caches nor restores it`,
        });
      }
      for (const other of tasks) {
        if (other.taskId === task.taskId || other.package !== task.package) continue;
        const otherOutputs = outputsByTask.get(other.taskId) ?? [];
        if (globsCover(otherOutputs, dirRelative)) {
          findings.push({
            taskId: task.taskId,
            detail:
              `compiles "${config}" into "${dirRelative}", which "${other.taskId}" also ` +
              `declares as its output (${JSON.stringify(otherOutputs)}) — two writers, one directory`,
          });
        }
      }
    }
  }

  if (findings.length === 0) {
    console.log(
      `task-outputs check: OK (${checked} compile output(s) across ${tasks.length} task(s): ${taskNames.join(", ")})`,
    );
    return;
  }

  console.error(`task-outputs check: FAILED — ${findings.length} finding(s):\n`);
  for (const f of findings) {
    console.error(`  ${f.taskId} — ${f.detail}`);
  }
  console.error(
    "\nEvery directory a task compiles into must be declared in that task's turbo\n" +
      "`outputs` and shared with no other task. Otherwise two tasks with no edge\n" +
      "between them write one directory at the same time, and turbo's summary stops\n" +
      "describing what is on disk.",
  );
  process.exit(1);
}

main();
