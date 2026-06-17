#!/usr/bin/env node
// Copy non-TypeScript runtime assets (the default ComfyUI workflow graph) into
// dist/, since tsc does not emit .json data files. The ComfyUI provider resolves
// the bundled default workflow relative to its compiled module at runtime.

import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const src = join(pkgRoot, "src", "assets");
const dest = join(pkgRoot, "dist", "assets");

await mkdir(dest, { recursive: true });
await cp(src, dest, { recursive: true });
console.log(`copied assets -> ${dest}`);
