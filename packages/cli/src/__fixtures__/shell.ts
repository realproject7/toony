import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

/** Execute a printed command with a harmless toony argv recorder. */
export function recordedShellCommand(
  command: string,
  cwd: string,
  env: Record<string, string> = {},
): { args: string[]; cwd: string } {
  const result = spawnSync(
    "bash",
    [
      "-c",
      `toony() { "$TOONY_ARGV_NODE" -e 'process.stdout.write(JSON.stringify({args:process.argv.slice(1),cwd:process.cwd()}))' -- "$@"; }\n${command}`,
    ],
    { cwd, encoding: "utf8", env: { ...process.env, ...env, TOONY_ARGV_NODE: process.execPath } },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as { args: string[]; cwd: string };
}
