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
// assertion about the default keeps passing. The studio is where it bites, and
// `CutCanvas` is React, so a node test cannot drive the component's own call.
// So this is checked at the source instead:
//
//   1. A project-derived render input is never bound to a literal. Not
//      `gutterBandWidth={0.18}`, not `dialogueLanguage: "en"` — the value comes
//      from the project or from a variable that does.
//   2. A studio or package source that calls `cutPlacementFrame` or `layoutCut`
//      passes a gutter band width. Reserving the strip and lettering inside it
//      are two halves of one number; a call that omits it silently takes the
//      default for its half.
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

/** Render entry points whose gutter band width must be supplied explicitly. */
const BAND_CALLS = ["cutPlacementFrame", "layoutCut"];

/**
 * The studio must resolve the strip FROM the project, so naming the default in
 * studio source is the same defect as writing `0.18` — it renders the same
 * plausible-looking wrong thing, and every assertion about the default passes.
 */
const STUDIO_ONLY_BANNED = { pattern: /\bGUTTER_BAND_WIDTH_DEFAULT\b/, scope: /^apps\/studio\// };

/** The resolver has to be handed the project's field, not a substitute. */
const RESOLVER = "resolveGutterBandWidth";

function listTrackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter((f) => f.length > 0);
}

/**
 * The source text of one call's argument list, from the `(` after `name` to its
 * matching `)`. Returns null when the call is not found past `from`.
 */
function callArguments(content, name, from) {
  const start = content.indexOf(`${name}(`, from);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start + name.length; i < content.length; i++) {
    const ch = content[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        return { text: content.slice(start + name.length + 1, i), start, end: i };
      }
    }
  }
  return null;
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

function scanFile(file) {
  const findings = [];
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    return findings;
  }
  const lines = content.split(/\r?\n/);

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
  // but the project's field is how the default gets in wearing a resolver's coat.
  for (let from = 0; ; ) {
    const found = callArguments(content, RESOLVER, from);
    if (!found) break;
    from = found.end + 1;
    const line = lines[lineOf(content, found.start) - 1] ?? "";
    if (line.includes(IGNORE_MARKER)) continue;
    if (isDeclaration(content, found.start)) continue;
    if (!found.text.includes("gutterBandWidth")) {
      findings.push({
        file,
        line: lineOf(content, found.start),
        rule: "resolver-input",
        detail: `${RESOLVER}(…) is not being given the project's gutterBandWidth`,
      });
    }
  }

  // A call that reserves the strip, or lays bubbles into it, must say which
  // strip. `cutPlacementFrame(overlays, w, h)` and a `layoutCut` options object
  // without the key both take the default for their half of the reservation.
  for (const call of BAND_CALLS) {
    let from = 0;
    for (;;) {
      const found = callArguments(content, call, from);
      if (!found) break;
      from = found.end + 1;
      const line = lines[lineOf(content, found.start) - 1] ?? "";
      if (line.includes(IGNORE_MARKER)) continue;
      if (isDeclaration(content, found.start)) continue;
      const args = topLevelArgs(found.text);
      const supplied =
        call === "cutPlacementFrame"
          ? args.length >= 4
          : args.some((arg) => arg.includes("gutterBandWidth"));
      if (!supplied) {
        findings.push({
          file,
          line: lineOf(content, found.start),
          rule: "band-width",
          detail: `${call}(…) does not pass a gutter band width, so it takes the default`,
        });
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
