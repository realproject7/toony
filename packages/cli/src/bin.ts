#!/usr/bin/env node
// `toony` bin entry point. Wires real stdio to the command dispatcher and
// propagates the command's exit code to the process.

import { run } from "./index.js";

const code = await run(process.argv.slice(2), {
  cwd: process.cwd(),
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
});

process.exitCode = code;
