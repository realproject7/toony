#!/usr/bin/env node
// Build the self-contained `toony` CLI.
//
// The published `toony-cli` package must run from a single global install with
// no pnpm workspace present, so its JavaScript cannot depend on `workspace:*`
// links at runtime. This script bundles `bin.ts`/`index.ts` together with every
// `@toony/*` runtime dependency (schema, project-io, render, lint, export,
// providers, fonts) and `yaml` into `dist/` with esbuild.
//
// What stays external:
//   - `@napi-rs/canvas` — ships a prebuilt native `.node` binary that cannot be
//     bundled; it is declared as a real `dependencies` entry so npm installs the
//     correct platform prebuild next to the package.
//   - node builtins — provided by the runtime.
//
// Runtime assets that are read from disk (not importable JS) are copied so the
// bundle's `import.meta.url`-relative resolution keeps working after bundling
// into a single file (esbuild rewrites `import.meta.url` to the output bundle):
//   - fonts woff2 + OFL licenses → `<pkg>/assets/`   (resolved as `../assets`
//     from `dist/`, matching `@toony/fonts`' `fontsAssetDir()`).
//   - the default ComfyUI workflow → `dist/assets/`  (resolved as `./assets/`
//     from the bundle, matching `@toony/providers`' `loadDefaultWorkflow()`).

import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const repoRoot = join(pkgRoot, "..", "..");
const distDir = join(pkgRoot, "dist");

// Start clean so stale tsc output (or a previous bundle) never leaks in.
rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

await build({
  entryPoints: {
    bin: join(pkgRoot, "src", "bin.ts"),
    index: join(pkgRoot, "src", "index.ts"),
  },
  outdir: distDir,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: true,
  // Bundle workspace deps + `yaml`; keep the native canvas package external.
  external: ["@napi-rs/canvas"],
  // ESM output cannot `require()`; some bundled CJS deps (e.g. `yaml`) do a
  // dynamic `require("process")`/`require("util")`. Provide a real `require`
  // (and the `__filename`/`__dirname` it sometimes expects) via createRequire so
  // those calls resolve against Node builtins at runtime. `import.meta.url` is
  // left intact for asset resolution (esbuild points it at the output bundle).
  banner: {
    js: [
      "import { createRequire as __toonyCreateRequire } from 'node:module';",
      "const require = __toonyCreateRequire(import.meta.url);",
    ].join("\n"),
  },
  logLevel: "info",
});

// Add the bin shebang (the shared banner above is prepended to every output, so
// the shebang is added here on the bin entry specifically, before the banner).
const { readFileSync, writeFileSync } = await import("node:fs");
const binPath = join(distDir, "bin.js");
const binSource = readFileSync(binPath, "utf8");
if (!binSource.startsWith("#!")) {
  writeFileSync(binPath, `#!/usr/bin/env node\n${binSource}`);
}

// Copy runtime assets that are read from disk at runtime.
// 1) Fonts assets (woff2 + OFL licenses) → <pkg>/assets (resolved as ../assets).
const fontsSrc = join(repoRoot, "packages", "fonts", "assets");
const fontsDest = join(pkgRoot, "assets");
rmSync(fontsDest, { recursive: true, force: true });
mkdirSync(fontsDest, { recursive: true });
cpSync(fontsSrc, fontsDest, { recursive: true });

// 2) Default ComfyUI workflow → dist/assets (resolved as ./assets from bundle).
const providersAssetsSrc = join(repoRoot, "packages", "providers", "src", "assets");
const providersAssetsDest = join(distDir, "assets");
mkdirSync(providersAssetsDest, { recursive: true });
cpSync(providersAssetsSrc, providersAssetsDest, { recursive: true });

console.log("cli build: bundled dist/ + copied font and workflow assets");
