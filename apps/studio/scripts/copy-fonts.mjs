// Copy the curated self-hosted font assets from @toony/fonts into the studio's
// public/ so Next.js serves them from the app's own origin (no CDN) for the
// @font-face rules in lettering-fonts.css. Runs before `dev`/`build` (see the
// studio package.json scripts); public/fonts is git-ignored because the single
// committed copy lives in packages/fonts/assets.

import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const studioRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(studioRoot, "..", "..", "packages", "fonts", "assets");
const dest = join(studioRoot, "public", "fonts");

mkdirSync(dest, { recursive: true });
let copied = 0;
for (const name of readdirSync(src)) {
  if (name.endsWith(".woff2") || name.endsWith("-OFL.txt")) {
    cpSync(join(src, name), join(dest, name));
    copied++;
  }
}
console.log(`copy-fonts: copied ${copied} asset(s) into ${dest}`);
