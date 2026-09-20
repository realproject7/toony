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
import { fileURLToPath } from "node:url";

// `fileURLToPath`, not `new URL(...).pathname`: the latter leaves the path
// percent-encoded, so a checkout under a directory with a space in its name
// reaches `readFileSync` as `My%20Projects` and the script dies before it
// checks anything. Same convention as the repo's other node scripts.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

/**
 * Split a shell command on its operators, respecting quotes, so each piece is
 * one invocation.
 */
function commandSegments(command) {
  const segments = [];
  let current = "";
  let quote = "";
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      current += c;
      if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      current += c;
      continue;
    }
    if (c === ";" || c === "&" || c === "|") {
      segments.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  segments.push(current);
  return segments.filter((segment) => segment.trim() !== "");
}

/** Split a segment into tokens, stripping one level of quoting. */
function tokenize(segment) {
  const tokens = [];
  let current = "";
  let quote = "";
  let started = false;
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (quote) {
      if (c === quote) quote = "";
      else current += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      started = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (started) tokens.push(current);
      current = "";
      started = false;
      continue;
    }
    current += c;
    started = true;
  }
  if (started) tokens.push(current);
  return tokens;
}

/** Is this token the compiler itself, however it was reached? */
function isTscToken(token) {
  return token === "tsc" || token.endsWith("/tsc") || token.endsWith("\\tsc");
}

/** A tsc CLI boolean is true when bare and false when followed by `false`. */
function readBoolean(args, index) {
  return args[index + 1] === "false" ? { value: false, consumed: 2 } : { value: true, consumed: 1 };
}

/**
 * Every tsc invocation in a shell command, with the config and the command-line
 * overrides that decide where it emits.
 *
 * The compiler is found ANYWHERE in a segment, not just at its head, because it
 * is routinely reached through a runner: `pnpm exec tsc`, `npx tsc`,
 * `cross-env FOO=1 tsc`, `../../node_modules/.bin/tsc`. A parser that only
 * matched the first token read a `test` script that compiled straight into
 * `dist` as no invocation at all, and reported OK.
 *
 * An invocation this cannot pin down is REPORTED rather than skipped. This
 * check is the only thing standing between `dist` and a second writer, so it
 * has to fail loudly when it stops being able to see, not quietly return OK.
 */
function tscInvocations(command) {
  const found = [];
  for (const segment of commandSegments(command)) {
    const tokens = tokenize(segment);
    const at = tokens.findIndex(isTscToken);
    if (at < 0) continue;
    const args = tokens.slice(at + 1);

    const configs = [];
    let outDirOverride;
    // Three states, not two. `undefined` is "the command said nothing about
    // emitting", which is NOT the same as `--noEmit false`, and collapsing them
    // left the caller guessing which one it had.
    let noEmitFlag;
    let unreadable;

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      const [flag, inlineValue] = arg.includes("=")
        ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)]
        : [arg, undefined];
      const take = () => {
        if (inlineValue !== undefined) return inlineValue;
        const next = args[i + 1];
        if (next === undefined || next.startsWith("-")) return undefined;
        i++;
        return next;
      };
      if (flag === "-p" || flag === "--project") {
        const value = take();
        if (value === undefined) unreadable = `${flag} with no config path`;
        else configs.push(value);
      } else if (flag === "-b" || flag === "--build") {
        // Build mode takes its projects as positional arguments. Named configs
        // are read like `-p`; a bare `-b` resolves references this does not
        // follow, so it is reported rather than assumed harmless.
        const positional = args.slice(i + 1).filter((a) => !a.startsWith("-"));
        if (positional.length === 0) unreadable = "-b with no named project";
        else configs.push(...positional);
        i = args.length;
      } else if (flag === "--outDir") {
        const value = take();
        if (value === undefined) unreadable = "--outDir with no directory";
        else outDirOverride = value;
      } else if (flag === "--noEmit") {
        const read = readBoolean(args, i);
        noEmitFlag = read.value;
        i += read.consumed - 1;
      }
    }

    // `--noEmit` on the command line settles the question by itself: it beats
    // whatever the config says, and no other flag overrides it. Settle it BEFORE
    // asking which config was named, or `tsc --noEmit` with no `-p` gets
    // reported as an emit that cannot be located, when it emits nothing at all.
    if (noEmitFlag === true) continue;

    if (unreadable !== undefined) {
      found.push({ unreadable, segment: segment.trim() });
      continue;
    }
    if (configs.length === 0) {
      // A bare `tsc` reads whichever tsconfig.json it finds from the cwd. Where
      // that lands is not something this can resolve from the command alone.
      found.push({ unreadable: "no -p/--project", segment: segment.trim() });
      continue;
    }
    for (const config of configs) {
      found.push({ config, outDirOverride, noEmitFlag });
    }
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
    for (const invocation of tscInvocations(task.command ?? "")) {
      if (invocation.unreadable !== undefined) {
        findings.push({
          taskId: task.taskId,
          detail:
            `runs the compiler in \`${invocation.segment}\`, but this check cannot tell ` +
            `where that emits (${invocation.unreadable}). It will not assume the emit is ` +
            "harmless: name the project with -p, or give the task a command this can read",
        });
        continue;
      }
      const { config, outDirOverride, noEmitFlag } = invocation;
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
      // Whether this invocation emits, by tsc's own precedence. `--noEmit` on
      // the command line decides it when present, and the config decides it
      // otherwise. `--outDir` is NOT part of this decision: verified against
      // this repo's pinned typescript, `--outDir out` does not defeat a config
      // `noEmit: true` (still emits nothing), and `--noEmit false` against that
      // same config DOES emit, into the config's own outDir. Treating an
      // `--outDir` as evidence that the command changed the emit decision got
      // both of those backwards, and the second one is the #253 defect itself
      // classified as harmless.
      if (noEmitFlag === undefined ? resolved.noEmit : noEmitFlag) continue;
      // Where it emits is a separate question, and there `--outDir` does win:
      // `tsc -p tsconfig.test.json --outDir dist` puts test output back into
      // `dist` while the config still reads `dist-test`.
      if (outDirOverride !== undefined) {
        resolved = { ...resolved, outDir: resolve(packageDir, outDirOverride) };
      }
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
