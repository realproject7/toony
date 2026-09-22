#!/usr/bin/env node
// Public-safety scanner for the Toony public repository.
//
// Scans tracked text files for credentials, private absolute paths, provider
// account identifiers and studied-work names, and tracked images for embedded
// EXIF/metadata markers. Exits 1 with actionable findings when anything unsafe
// is detected.
//
// Studied-work names:
//   The list of names cannot live in this repository, because a tracked list is
//   the leak it exists to prevent. It is read from untracked local
//   configuration: a JSON array of names at `.toony/public-safety-names.json`,
//   which `.gitignore` already keeps out of the repository. A fresh clone has
//   no such file, so a run without one says out loud that it did not check for
//   names rather than reporting a pass it did not earn. A finding names the
//   entry by its position in the list and never prints the name itself.
//
// Coverage:
//   Tracked files in this checkout, and nothing else. Issue and pull request
//   bodies are out of reach here: this runs offline inside `pnpm check` with no
//   credentials, and GitHub keeps edited bodies in revision history where no
//   scan can reach them. Sweeping those stays a manual review step.
//
// Escape hatches:
//   - Append `public-safe-ignore: <reason>` to a line to skip that single line.
//     Name matching honours it too: the line is dropped before the file is
//     flattened.
//   - Add a precise entry to ALLOWLIST below for legitimate, documented matches.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const IGNORE_MARKER = "public-safe-ignore:";

/** Untracked local configuration holding the studied-work name list. */
export const NAME_SOURCE_DEFAULT = ".toony/public-safety-names.json";

// Directories never scanned (also excluded by git tracking, kept for safety).
const SKIP_DIR_PATTERN = /(^|\/)(node_modules|\.git|dist|build|\.next|\.turbo)(\/|$)/;

const TEXT_EXTENSIONS = new Set([
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
  ".csv",
  ".tsv",
  ".yaml",
  ".yml",
  ".toml",
  ".env",
  ".sh",
  ".html",
  ".css",
  ".svg",
  ".xml",
  ".gitignore",
  "",
]);

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

// Documented allowlist for legitimate matches that the rules would otherwise
// flag. Each entry must be exact so it cannot mask real leaks.
//   - file: tracked path (forward slashes)
//   - substring: exact text on the matched line that makes it safe
//   - reason: why it is safe
const ALLOWLIST = [
  // The DESIGN doc uses a documented public-safe token, not a real path. // no-stub-ignore: allowlist comment
  {
    file: "docs/DESIGN.md",
    substring: "<LOCAL_DESIGN_PACKAGE>/toony-design/",
    reason: "documented public-safe token, not a real absolute path", // no-stub-ignore: allowlist comment
  },
];

/**
 * Credential / unsafe-text rules. Each rule has a name and a RegExp.
 * Rules are intentionally specific to limit false positives.
 */
const TEXT_RULES = [
  {
    name: "private-absolute-path",
    // /Users/<name> or /home/<name> with a real-looking user segment.
    regex: /\/(Users|home)\/[A-Za-z0-9._-]+/,
  },
  {
    name: "aws-access-key-id",
    regex: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/,
  },
  {
    name: "private-key-block",
    regex: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/,
  },
  {
    name: "bearer-token",
    regex: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/,
  },
  {
    name: "generic-secret-assignment",
    // api_key / apiKey / secret / token = "<20+ non-space chars>"
    regex:
      /\b(api[_-]?key|apikey|secret|token|password|passwd|client[_-]?secret)\b\s*[:=]\s*['"`][^'"`\s]{20,}['"`]/i,
  },
  {
    name: "google-api-key",
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/,
  },
  {
    name: "slack-token",
    regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}/,
  },
  {
    name: "github-token",
    regex: /\bgh[pousr]_[0-9A-Za-z]{36,}\b/,
  },
  {
    name: "private-url-credentials",
    // matches scheme://<user>:<pass>@host  public-safe-ignore: rule definition
    regex: /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s:@]+@[^/\s]+/i,
  },
];

function listTrackedFiles() {
  const output = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  return output.split("\0").filter((f) => f.length > 0);
}

function isAllowed(file, lineText) {
  return ALLOWLIST.some((entry) => entry.file === file && lineText.includes(entry.substring));
}

/** Report a configuration fault that stops the scan from meaning anything. */
function fail(message) {
  console.error(`public-safety scan: FAILED — ${message}`);
  process.exit(1);
}

/** Collapse every whitespace run to one space, so a line break cannot hide a name. */
export function normaliseText(value) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Read the studied-work name list from untracked local configuration.
 * Returns null when there is no source, so the caller can report that names
 * were not checked instead of passing as if they had been.
 */
export function loadNames(path, trackedFiles) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    return fail(`name source ${path} could not be read: ${error.message}`);
  }
  if (trackedFiles.includes(relative(".", resolve(path)))) {
    return fail(`name source ${path} is tracked by git. The list must never enter the repository.`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail(`name source ${path} is not valid JSON. It must be an array of names.`);
  }
  if (!Array.isArray(parsed) || parsed.some((name) => typeof name !== "string")) {
    return fail(`name source ${path} must be a JSON array of names.`);
  }
  const names = parsed.map(normaliseText).filter((name) => name.length > 0);
  if (names.length === 0) return fail(`name source ${path} lists no names.`);
  return names;
}

/**
 * Flatten lines into one lowercase string with single-space gaps, recording
 * where each line starts. A name split across a line break then matches, and
 * the finding still reports the line the name starts on.
 */
function flattenLines(lines) {
  const spans = [];
  let text = "";
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(IGNORE_MARKER)) continue;
    const collapsed = normaliseText(lines[i]);
    if (collapsed.length === 0) continue;
    spans.push({ start: text.length === 0 ? 0 : text.length + 1, line: i + 1 });
    text = text.length === 0 ? collapsed : `${text} ${collapsed}`;
  }
  return { text, spans };
}

function lineAt(spans, index) {
  let line = 0;
  for (const span of spans) {
    if (span.start > index) break;
    line = span.line;
  }
  return line;
}

/** Scan flattened text for studied-work names, returning an array of findings. */
export function scanNames(file, lines, names) {
  const { text, spans } = flattenLines(lines);
  const findings = [];
  for (let i = 0; i < names.length; i++) {
    const at = text.indexOf(names[i]);
    if (at < 0) continue;
    // The name is never printed. Its position in the untracked list is enough
    // to look it up locally.
    findings.push({
      file,
      line: lineAt(spans, at),
      rule: "studied-work-name",
      excerpt: `name source entry ${i + 1}`,
    });
  }
  return findings;
}

/** Scan a single text file, returning an array of finding objects. */
function scanTextFile(file, names) {
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
    if (isAllowed(file, line)) continue;

    for (const rule of TEXT_RULES) {
      const match = rule.regex.exec(line);
      if (match) {
        findings.push({
          file,
          line: i + 1,
          rule: rule.name,
          excerpt: redact(match[0]),
        });
      }
    }
  }
  if (names) findings.push(...scanNames(file, lines, names));
  return findings;
}

/** Redact a matched secret so the scanner output never leaks the value. */
function redact(value) {
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}…[redacted ${value.length} chars]`;
}

/**
 * Scan an image file for embedded metadata markers.
 * - JPEG: APP1 "Exif" marker.
 * - PNG: textual chunks tEXt / iTXt / zTXt and eXIf.
 */
function scanImageFile(file) {
  const findings = [];
  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    return findings;
  }
  const ext = extname(file).toLowerCase();

  if (ext === ".jpg" || ext === ".jpeg") {
    if (buf.includes(Buffer.from("Exif\0\0", "latin1")) || hasJpegApp1(buf)) {
      findings.push({ file, line: 0, rule: "jpeg-exif-metadata", excerpt: "Exif APP1" });
    }
  } else if (ext === ".png") {
    for (const chunk of ["tEXt", "iTXt", "zTXt", "eXIf"]) {
      if (buf.includes(Buffer.from(chunk, "latin1"))) {
        findings.push({ file, line: 0, rule: `png-${chunk}-metadata`, excerpt: chunk });
      }
    }
  } else if (ext === ".webp") {
    if (
      buf.includes(Buffer.from("EXIF", "latin1")) ||
      buf.includes(Buffer.from("XMP ", "latin1"))
    ) {
      findings.push({ file, line: 0, rule: "webp-metadata", excerpt: "EXIF/XMP chunk" });
    }
  }
  return findings;
}

/** Detect a JPEG APP1 (0xFFE1) segment, which carries EXIF/XMP. */
function hasJpegApp1(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return false;
  let offset = 2;
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) break;
    const marker = buf[offset + 1];
    if (marker === 0xda) break; // start of scan: no more metadata segments
    const size = buf.readUInt16BE(offset + 2);
    if (marker === 0xe1) return true; // APP1
    offset += 2 + size;
  }
  return false;
}

function main() {
  const files = listTrackedFiles();
  const names = loadNames(NAME_SOURCE_DEFAULT, files);
  const findings = [];
  // Every tracked file lands in exactly one of these three, so the report can
  // never claim a file was checked when nothing read it.
  const unreadFormats = new Map();
  let excludedByDirectory = 0;
  let inspected = 0;

  for (const file of files) {
    if (SKIP_DIR_PATTERN.test(file)) {
      excludedByDirectory++;
      continue;
    }
    const ext = extname(file).toLowerCase();
    const base = file.split("/").pop() ?? file;

    if (IMAGE_EXTENSIONS.has(ext)) {
      findings.push(...scanImageFile(file));
      inspected++;
      continue;
    }
    if (TEXT_EXTENSIONS.has(ext) || TEXT_EXTENSIONS.has(base.toLowerCase())) {
      findings.push(...scanTextFile(file, names));
      inspected++;
      continue;
    }
    const format = ext || base.toLowerCase();
    unreadFormats.set(format, (unreadFormats.get(format) ?? 0) + 1);
  }

  const ok = findings.length === 0;
  const say = (line) => (ok ? console.log(line) : console.error(line));
  const nameState = names ? `${names.length} name(s) checked` : "names NOT CHECKED";
  const coverage = `${inspected} of ${files.length} tracked files inspected; ${nameState}`;

  if (ok) {
    console.log(`public-safety scan: OK (${coverage})`);
  } else {
    console.error(`public-safety scan: FAILED — ${findings.length} finding(s) (${coverage}):\n`);
    for (const f of findings) {
      const loc = f.line > 0 ? `${f.file}:${f.line}` : f.file;
      console.error(`  [${f.rule}] ${loc}`);
      console.error(`      match: ${f.excerpt}`);
    }
  }

  if (unreadFormats.size > 0) {
    const breakdown = [...unreadFormats]
      .sort()
      .map(([format, count]) => `${format} (${count})`)
      .join(", ");
    say(`  not inspected: formats this scanner does not read: ${breakdown}`);
  }
  if (excludedByDirectory > 0) {
    say(`  not inspected: ${excludedByDirectory} file(s) under an excluded directory`);
  }

  if (names === null) {
    console.error(
      "\npublic-safety scan: studied-work names were NOT checked. There is no name source at\n" +
        `${NAME_SOURCE_DEFAULT}. That list must stay out of this repository, so put it at that\n` +
        "path, where git already ignores it, and run the scan again.",
    );
  }

  if (!ok) {
    console.error(
      "\nFix the leak, or add `public-safe-ignore: <reason>` to the line if it is a documented false positive.",
    );
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
