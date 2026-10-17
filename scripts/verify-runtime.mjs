import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";

const expectedManager = JSON.parse(readFileSync("package.json", "utf8")).packageManager;
const actualManager = execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim();
const child = JSON.parse(
  execFileSync(
    "pnpm",
    ["exec", "node", "-p", "JSON.stringify({version:process.version,execPath:process.execPath})"],
    {
      encoding: "utf8",
    },
  ),
);
console.log(`selected Node: ${process.version} (${process.execPath})`);
console.log(`pnpm entry: ${process.argv[2]}; version: ${actualManager}`);
console.log(`pnpm child Node: ${child.version} (${child.execPath})`);
if (
  process.versions.node.split(".")[0] !== process.argv[3] ||
  expectedManager !== `pnpm@${actualManager}` ||
  child.version !== process.version ||
  realpathSync(child.execPath) !== realpathSync(process.execPath)
) {
  console.error(`Runtime mismatch. Required ${expectedManager} under the selected Node.`);
  process.exit(1);
}
