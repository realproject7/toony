// Select a JavaScript pnpm/Corepack entry so the gate can run it with the exact
// selected Node executable. Skip shell wrappers that substitute a bundled Node.
import { readFileSync, realpathSync } from "node:fs";
import { delimiter, join } from "node:path";

for (const directory of (process.env.PATH ?? "").split(delimiter)) {
  try {
    const entry = realpathSync(join(directory, "pnpm"));
    const firstLine = readFileSync(entry, "utf8").split("\n")[0];
    if (!/^#!.*\bnode\b/.test(firstLine)) continue;
    console.log(entry);
    process.exit(0);
  } catch {
    // Another PATH entry may provide the real package manager.
  }
}
console.error("No Node-based pnpm/Corepack entry found on PATH. Install the pinned pnpm first.");
process.exit(1);
