#!/usr/bin/env node
// Project-derived render inputs checker for the Toony repository.
//
// Some values the shared renderer needs are properties of the PROJECT, not of
// the renderer: the gutter strip width (#215), the declared dialogue language
// (#213), the reference column (#217). Every consumer has to read them off
// `webtoon.json` and hand them down, or two consumers render the same episode
// differently — the studio previewing one thing and the export writing another.
//
// That failure is invisible to the test suite in one specific way: a consumer
// that substitutes the DEFAULT still renders something plausible, and every
// assertion about the default keeps passing. Where it bites hardest is the
// studio, whose components a node test cannot execute: the studio's sources are
// written for a bundler (extensionless relative imports, `@/` aliases, Next
// subpath imports), none of which plain Node ESM resolves. The geometry those
// components compute is therefore extracted into `@/lib/cut-stage` and tested
// directly; what remains unexecutable is the call sites, and those are what this
// checks:
//
//   1. A project-derived render input is never bound to a literal. Not
//      `gutterBandWidth={0.18}`, not `dialogueLanguage: "en"`.
//   2. A source that calls one of the render entry points below passes a gutter
//      band width, and passes a REFERENCE to one — not `0.18`, not `undefined`,
//      not an expression. Reserving the strip and lettering inside it are two
//      halves of one number.
//   3. The studio neither names the default nor hands the resolver a substitute.
//
// WHAT THIS IS: per-line and per-call TEXT matching. There is no dataflow
// analysis, so a reference that is itself assigned a constant somewhere else, or
// a value reaching a call through a spread, passes. It catches the reversion
// shapes, not every possible one. Behaviour that CAN be executed belongs in a
// test, not here.
//
// Per-line escape hatch, matching the other scanners:
//   - Append `render-input-ignore: <reason>` to the line.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const IGNORE_MARKER = "render-input-ignore:";

const SKIP_DIR_PATTERN = /(^|\/)(node_modules|\.git|dist|build|\.next|\.turbo)(\/|$)/;
const TEST_OR_FIXTURE_PATTERN =
  /(^|\/)(fixtures|__fixtures__|tests?|__tests__)(\/)|\.fixture\.|\.test\.|\.spec\./;
const SOURCE_PATTERN = /^(apps|packages)\/[^/]+\/src\/.*\.tsx?$/;

/**
 * Values a consumer must take FROM the project.
 *
 * `gutterBandWidth` is checked everywhere: nothing outside `@toony/schema`'s own
 * default should name a strip width, and the schema names it
 * `GUTTER_BAND_WIDTH_DEFAULT`, not this. The other two are checked in the studio
 * only, because a project SCAFFOLD legitimately writes literal values for them
 * into a new `webtoon.json` (`@toony/project-io`), and the studio never does.
 */
const PROJECT_INPUTS = [
  { name: "gutterBandWidth", scope: /./ },
  { name: "dialogueLanguage", scope: /^apps\/studio\// },
  { name: "referenceWidth", scope: /^apps\/studio\// },
];

/** `name: 0.18` / `name = 0.18` / `name={0.18}` / `name: "en"` — a pinned value. */
function literalBinding(name) {
  return new RegExp(`\\b${name}\\s*(?::|=)\\s*\\{?\\s*(?:-?\\d|["'\`])`);
}

/**
 * Render entry points that take the strip width. `cutPlacementFrame` and the
 * studio's `resolveCutStage` take it as the 4th positional argument; `layoutCut`
 * and `layoutBubble` take it on their options object.
 */
const BAND_CALLS = [
  { name: "cutPlacementFrame", position: 4 },
  { name: "resolveCutStage", position: 4 },
  { name: "layoutCut", options: true },
  { name: "layoutBubble", options: true },
];

/**
 * The studio must resolve the strip FROM the project, so naming the default in
 * studio source is the same defect as writing `0.18` — it renders the same
 * plausible-looking wrong thing, and every assertion about the default passes.
 */
const STUDIO_ONLY_BANNED = { pattern: /\bGUTTER_BAND_WIDTH_DEFAULT\b/, scope: /^apps\/studio\// };

/** The resolver has to be handed the project's field, not a substitute. */
const RESOLVER = "resolveGutterBandWidth";

/**
 * A plain property reference — `gutterBandWidth`, `opts.gutterBandWidth`,
 * `loaded.project.webtoon.gutterBandWidth`. Deliberately narrow: a literal, a
 * call, and any arithmetic are all rejected, so `0.18`, `undefined` and
 * `webtoon.gutterBandWidth * 0` cannot pass for the project's value.
 */
const PLAIN_REFERENCE = /^[A-Za-z_$][\w$]*(?:\s*\??\.\s*[A-Za-z_$][\w$]*)*$/;
const NOT_A_VALUE = new Set(["undefined", "null", "NaN", "Infinity", "void"]);

function isProjectReference(text) {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (NOT_A_VALUE.has(trimmed.split(/[\s.?]/)[0] ?? "")) return false;
  return PLAIN_REFERENCE.test(trimmed);
}

function listTrackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter((f) => f.length > 0);
}

/**
 * Every call of `name` in `content`, whitespace- and optional-call-tolerant:
 * `name(`, `name (`, `name?.(`. Each entry carries the argument-list source and
 * the index the name starts at.
 */
function findCalls(content, name) {
  const pattern = new RegExp(`\\b${name}\\s*(?:\\?\\.\\s*)?\\(`, "g");
  const calls = [];
  for (let match = pattern.exec(content); match !== null; match = pattern.exec(content)) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    for (let i = open; i < content.length; i++) {
      const ch = content[i];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) {
          calls.push({ start: match.index, text: content.slice(open + 1, i) });
          break;
        }
      }
    }
  }
  return calls;
}

/** Split an argument list on TOP-LEVEL commas only. */
function topLevelArgs(text) {
  const args = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      args.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0) args.push(current);
  return args;
}

function lineOf(content, index) {
  return content.slice(0, index).split(/\r?\n/).length;
}

/**
 * Whether the name at `index` is being DECLARED rather than called. Only the
 * declaration's own parameter list may be free of the argument these rules
 * require; every other occurrence is a call site, including one on a line that
 * happens to start with `const` or `for (const`.
 */
function isDeclaration(content, index) {
  return /\bfunction\s+$/.test(content.slice(Math.max(0, index - 40), index));
}

/**
 * How an options object supplies the strip width: `"reference"` when it names it
 * and gives it a project reference, `"spread"` when it forwards a whole options
 * object by name (which this cannot see into), `"pinned"` when it names it and
 * gives it something else, `"absent"` when it does not name it at all.
 *
 * Only a spread OF A REFERENCE counts: `{ ...opts }` may be carrying the width,
 * but `{ ...(measure ? { measure } : {}) }` demonstrably is not, and treating
 * every spread as a maybe let exactly that shape through.
 */
function optionsSupply(text) {
  const entries = topLevelArgs(text.replace(/^\s*\{/, "").replace(/\}\s*$/, ""));
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (trimmed === "gutterBandWidth") return "reference"; // shorthand
    if (trimmed.startsWith("gutterBandWidth")) {
      const value = trimmed.slice("gutterBandWidth".length).replace(/^\s*:/, "");
      return isProjectReference(value) ? "reference" : "pinned";
    }
  }
  const forwards = entries.some(
    (entry) => entry.trim().startsWith("...") && isProjectReference(entry.trim().slice(3)),
  );
  return forwards ? "spread" : "absent";
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
  const ignored = (index) => (lines[lineOf(content, index) - 1] ?? "").includes(IGNORE_MARKER);
  const add = (index, rule, detail) =>
    findings.push({ file, line: lineOf(content, index), rule, detail });

  for (const input of PROJECT_INPUTS) {
    if (!input.scope.test(file)) continue;
    const pattern = literalBinding(input.name);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes(IGNORE_MARKER)) continue;
      if (pattern.test(line)) {
        findings.push({
          file,
          line: i + 1,
          rule: "literal",
          detail: `"${input.name}" is pinned to a literal; read it off the project instead`,
        });
      }
    }
  }

  if (STUDIO_ONLY_BANNED.scope.test(file)) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes(IGNORE_MARKER)) continue;
      if (STUDIO_ONLY_BANNED.pattern.test(line)) {
        findings.push({
          file,
          line: i + 1,
          rule: "default-in-studio",
          detail: "the studio names the default strip instead of resolving the project's",
        });
      }
    }
  }

  // The resolver turns an absent field into the default, so handing it anything
  // but the project's own field is how the default gets in wearing a resolver's
  // coat — including an expression that merely mentions the field.
  for (const call of findCalls(content, RESOLVER)) {
    if (ignored(call.start) || isDeclaration(content, call.start)) continue;
    const arg = topLevelArgs(call.text)[0] ?? "";
    if (!isProjectReference(arg) || !/(^|\.)\s*gutterBandWidth$/.test(arg.trim())) {
      add(
        call.start,
        "resolver-input",
        `${RESOLVER}(${arg.trim()}) is not the project's gutterBandWidth`,
      );
    }
  }

  // A call that reserves the strip, or lays bubbles into it, must say WHICH
  // strip — and say it by reference. A call that omits it, or pins it, takes the
  // default for its half of one reservation.
  for (const call of BAND_CALLS) {
    for (const found of findCalls(content, call.name)) {
      if (ignored(found.start) || isDeclaration(content, found.start)) continue;
      const args = topLevelArgs(found.text);
      if (call.position) {
        const arg = args[call.position - 1];
        if (arg === undefined) {
          add(
            found.start,
            "band-width",
            `${call.name}(…) does not pass a gutter band width, so it takes the default`,
          );
        } else if (!isProjectReference(arg)) {
          add(
            found.start,
            "band-width",
            `${call.name}(…, ${arg.trim()}) pins the gutter band width instead of passing the project's`,
          );
        }
        continue;
      }
      const options = args[3];
      const supply = options === undefined ? "absent" : optionsSupply(options);
      if (supply === "absent") {
        add(
          found.start,
          "band-width",
          `${call.name}(…) does not pass a gutter band width, so it takes the default`,
        );
      } else if (supply === "pinned") {
        add(
          found.start,
          "band-width",
          `${call.name}(…) pins the gutter band width instead of passing the project's`,
        );
      }
    }
  }

  return findings;
}

function main() {
  const findings = [];
  let checked = 0;

  for (const file of listTrackedFiles()) {
    if (SKIP_DIR_PATTERN.test(file)) continue;
    if (!SOURCE_PATTERN.test(file)) continue;
    if (TEST_OR_FIXTURE_PATTERN.test(file)) continue;
    checked++;
    findings.push(...scanFile(file));
  }

  if (findings.length === 0) {
    console.log(`render-inputs check: OK (${checked} files checked)`);
    return;
  }

  console.error(`render-inputs check: FAILED — ${findings.length} finding(s):\n`);
  for (const f of findings) {
    console.error(`  [${f.rule}] ${f.file}:${f.line} — ${f.detail}`);
  }
  console.error(
    "\nA project-derived render input must reach every consumer from the project.\n" +
      "Read it off `webtoon.json` (via the resolver in @toony/schema) and pass it down,\n" +
      "or append `render-input-ignore: <reason>` when a line genuinely authors a value.",
  );
  process.exit(1);
}

main();
