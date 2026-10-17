#!/usr/bin/env node
// Copy non-TypeScript runtime assets (the default ComfyUI workflow graph) into a
// compiled output directory, since tsc does not emit .json data files. The
// ComfyUI provider resolves the bundled default workflow relative to its own
// compiled module at runtime, so the assets have to sit beside that module —
// which means the directory depends on which compile is being assembled.
//
//   node scripts/copy-assets.mjs            # -> dist/assets      (the build)
//   node scripts/copy-assets.mjs dist-test  # -> dist-test/assets (the tests)
//
// The argument is what keeps `build` and `test` off each other's files: they
// compile the same sources into different directories, so the two copies never
// target the same path even when the tasks run at the same time (#253).

import { cp, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");

const outDirArg = process.argv[2] ?? "dist";
if (isAbsolute(outDirArg) || normalize(outDirArg).startsWith("..")) {
  console.error(`copy-assets: output directory must be inside the package, got "${outDirArg}".`);
  process.exit(2);
}

const src = join(pkgRoot, "src", "assets");
const dest = join(pkgRoot, outDirArg, "assets");

await mkdir(dest, { recursive: true });
await cp(src, dest, { recursive: true });
console.log(`copied assets -> ${dest}`);
