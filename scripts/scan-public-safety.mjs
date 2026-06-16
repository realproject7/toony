#!/usr/bin/env node
// Public-safety scanner for the Toony public repository.
//
// Scans tracked text files for credentials, private absolute paths, provider
// account identifiers, and tracked images for embedded EXIF/metadata markers.
// Exits 1 with actionable findings when anything unsafe is detected.
//
// Escape hatches:
//   - Append `public-safe-ignore: <reason>` to a line to skip that single line.
//   - Add a precise entry to ALLOWLIST below for legitimate, documented matches.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const IGNORE_MARKER = "public-safe-ignore:";

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

/** Scan a single text file, returning an array of finding objects. */
function scanTextFile(file) {
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
  const findings = [];

  for (const file of files) {
    if (SKIP_DIR_PATTERN.test(file)) continue;
    const ext = extname(file).toLowerCase();
    const base = file.split("/").pop() ?? file;

    if (IMAGE_EXTENSIONS.has(ext)) {
      findings.push(...scanImageFile(file));
      continue;
    }
    if (TEXT_EXTENSIONS.has(ext) || TEXT_EXTENSIONS.has(base.toLowerCase())) {
      findings.push(...scanTextFile(file));
    }
  }

  if (findings.length === 0) {
    console.log(`public-safety scan: OK (${files.length} tracked files checked)`);
    return;
  }

  console.error(`public-safety scan: FAILED — ${findings.length} finding(s):\n`);
  for (const f of findings) {
    const loc = f.line > 0 ? `${f.file}:${f.line}` : f.file;
    console.error(`  [${f.rule}] ${loc}`);
    console.error(`      match: ${f.excerpt}`);
  }
  console.error(
    "\nFix the leak, or add `public-safe-ignore: <reason>` to the line if it is a documented false positive.",
  );
  process.exit(1);
}

main();
