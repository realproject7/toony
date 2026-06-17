#!/usr/bin/env node
// Bundle the Next.js standalone Studio build into the CLI package.
//
// `next build` (with `output: 'standalone'`) emits a self-contained server under
// `apps/studio/.next/standalone`, but Next deliberately leaves out two things the
// server still needs at runtime: the client static assets (`.next/static`) and
// the app's `public/` directory. This script assembles a complete, runnable copy
// of the Studio under `packages/cli/studio/` so `toony studio` can launch it from
// a global install with no monorepo present.
//
// Layout produced (mirrors Next's documented standalone deploy layout):
//   packages/cli/studio/
//     apps/studio/server.js          ← entry the CLI spawns
//     apps/studio/.next/...          ← server build + required-server-files
//     apps/studio/.next/static/...   ← copied from apps/studio/.next/static
//     apps/studio/public/...         ← copied from apps/studio/public
//     node_modules/...               ← traced minimal deps (next/react/...)
//     packages/...                   ← traced @toony/* deps
//
// Public-safety: Next bakes a few absolute build-time paths (the file-tracing
// root, turbopack root) into `server.js`. They are not used at runtime (the
// server `chdir`s to its own dir and uses a relative `distDir`), but to keep the
// published tarball free of private filesystem paths we rewrite them to a neutral
// stand-in path.

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const repoRoot = join(pkgRoot, "..", "..");
const studioApp = join(repoRoot, "apps", "studio");
const standalone = join(studioApp, ".next", "standalone");

if (!existsSync(join(standalone, "apps", "studio", "server.js"))) {
  console.error(
    "bundle-studio: standalone build not found at apps/studio/.next/standalone — " +
      "run `pnpm --filter @toony/studio build` first.",
  );
  process.exit(1);
}

const dest = join(pkgRoot, "studio");
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

// 1) Copy the standalone tree EXCEPT its `node_modules` (handled below). The
//    standalone `node_modules` is a pnpm store (`.pnpm/` + symlinks). `npm pack`
//    does not preserve symlinks, so copying it verbatim would ship a broken
//    module tree. Instead the dependency closure is re-materialized as a flat,
//    hoisted `node_modules/<pkg>` layout that node resolves natively and that
//    survives packing/installing anywhere.
cpSync(standalone, dest, {
  recursive: true,
  dereference: true,
  filter: (src) => !src.includes(`${join(standalone, "node_modules")}`),
});

// Build a flat, portable `node_modules` from the pnpm virtual store. Every real
// package lives at `node_modules/.pnpm/<name>@<ver>.../node_modules/<pkgname>`;
// copy each to the hoisted top-level `node_modules/<pkgname>` so all packages are
// siblings and node's resolution finds every dependency without symlinks.
function hoistPnpmStore(standaloneNm, destNm) {
  const pnpmDir = join(standaloneNm, ".pnpm");
  if (!existsSync(pnpmDir)) {
    console.error("bundle-studio: standalone node_modules has no .pnpm store to hoist");
    process.exit(1);
  }
  mkdirSync(destNm, { recursive: true });
  for (const virtual of readdirSync(pnpmDir)) {
    // pnpm stores helper dirs (e.g. `node_modules`) and the virtual package
    // dirs side by side; only `<name>@<ver>...` dirs hold real packages.
    const inner = join(pnpmDir, virtual, "node_modules");
    if (!existsSync(inner)) continue;
    for (const scopeOrPkg of readdirSync(inner)) {
      const entryPath = join(inner, scopeOrPkg);
      // Resolve scoped packages (`@scope/name`) one level deeper.
      if (scopeOrPkg.startsWith("@")) {
        for (const name of readdirSync(entryPath)) {
          copyPackage(realpathSync(join(entryPath, name)), join(destNm, scopeOrPkg, name));
        }
      } else {
        copyPackage(realpathSync(entryPath), join(destNm, scopeOrPkg));
      }
    }
  }
}

function copyPackage(realSrc, destPath) {
  // Each package may already be present (a dependency hoisted under multiple
  // virtual dirs); the resolved real path is identical, so first write wins.
  if (existsSync(destPath)) return;
  const stat = lstatSync(realSrc);
  if (!stat.isDirectory()) return;
  mkdirSync(dirname(destPath), { recursive: true });
  cpSync(realSrc, destPath, { recursive: true, dereference: true });
}

const destNodeModules = join(dest, "node_modules");
hoistPnpmStore(join(standalone, "node_modules"), destNodeModules);

// Drop the per-app `apps/studio/node_modules` (next/react were pnpm symlinks
// there). With it removed, the server's module resolution walks up to the single
// hoisted `node_modules` at the studio bundle root, where every dep is a sibling.
rmSync(join(dest, "apps", "studio", "node_modules"), { recursive: true, force: true });

// Sanity: the hoisted tree must be symlink-free (portable through npm pack) and
// must contain the studio's top-level runtime deps.
function findSymlink(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) return full;
    if (entry.isDirectory()) {
      const nested = findSymlink(full);
      if (nested) return nested;
    }
  }
  return null;
}
const stray = findSymlink(destNodeModules);
if (stray) {
  console.error(`bundle-studio: hoisted node_modules still has a symlink: ${stray}`);
  process.exit(1);
}
for (const required of ["next", "react", "react-dom", "styled-jsx"]) {
  if (!existsSync(join(destNodeModules, required, "package.json"))) {
    console.error(`bundle-studio: hoisted node_modules is missing "${required}"`);
    process.exit(1);
  }
}

// 2) Next omits .next/static and public/ from standalone — copy them in beside
//    the server build so the running server can serve client chunks and assets.
const destStudio = join(dest, "apps", "studio");
cpSync(join(studioApp, ".next", "static"), join(destStudio, ".next", "static"), {
  recursive: true,
});
if (existsSync(join(studioApp, "public"))) {
  cpSync(join(studioApp, "public"), join(destStudio, "public"), { recursive: true });
}

// 3) Sanitize absolute build-time paths baked into the generated server build
//    (public-safety). Next records the monorepo root in `server.js`,
//    `required-server-files.json`, and the per-route compiled files
//    (`resolvedPagePath`, file-tracing root, turbopack root). None are used at
//    runtime — the server `chdir`s to its own dir and uses a relative `distDir`,
//    routes are resolved by bundlePath — so rewriting the root to a neutral
//    stand-in is safe and keeps the published tarball free of private paths.
const TEXT_EXT = new Set([".js", ".cjs", ".mjs", ".json", ".map"]);
const NEUTRAL_ROOT = "/toony";
let sanitizedCount = 0;
function sanitizeTree(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      sanitizeTree(full);
      continue;
    }
    if (!TEXT_EXT.has(extname(full))) continue;
    const original = readFileSync(full, "utf8");
    if (!original.includes(repoRoot)) continue;
    writeFileSync(full, original.replaceAll(repoRoot, NEUTRAL_ROOT));
    sanitizedCount++;
  }
}
// Only the generated app build can carry our repo root; node_modules belong to
// third parties and are left untouched.
sanitizeTree(join(destStudio, ".next"));
// server.js sits directly under destStudio; sanitize it explicitly.
const serverJs = join(destStudio, "server.js");
{
  const original = readFileSync(serverJs, "utf8");
  if (original.includes(repoRoot)) {
    writeFileSync(serverJs, original.replaceAll(repoRoot, NEUTRAL_ROOT));
    sanitizedCount++;
  }
}

// 4) Sanity-check: no `<root>/...`-style private absolute path that matches the
//    public-safety scanner may remain in the generated build. node_modules are
//    excluded (third-party code may contain literal "/Users/" tokens unrelated
//    to this machine, which the scanner's name-segment rule does not flag).
const homeLike = /\/(?:Users|home)\/[A-Za-z0-9._-]+\//;
function assertClean(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      assertClean(full);
      continue;
    }
    if (!TEXT_EXT.has(extname(full))) continue;
    if (homeLike.test(readFileSync(full, "utf8"))) {
      console.error(`bundle-studio: private path still present after sanitize: ${full}`);
      process.exit(1);
    }
  }
}
assertClean(join(destStudio, ".next"));
if (homeLike.test(readFileSync(serverJs, "utf8"))) {
  console.error("bundle-studio: private path still present in server.js after sanitize");
  process.exit(1);
}

console.log(
  `bundle-studio: assembled standalone studio at ${dest} (sanitized ${sanitizedCount} file(s))`,
);
