// The process of one agent turn: output split into lines (multibyte safe), the
// prompt on stdin, and a stop that reaches the whole process group; plus the
// real launcher driving a stand-in CLI through the provider parser.

import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { NativeEvent, RunFiles } from "../agent/adapters.js";
import { cliLauncher } from "../agent/launcher.js";
import { startTurnProcess } from "../agent/process.js";

async function scratch(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), "toony-process-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("a turn process reads stdin and reports whole lines, multibyte text intact", async (t) => {
  const dir = await scratch(t);
  const script = join(dir, "echo.js");
  await writeFile(
    script,
    `let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  const text = JSON.stringify({ got: input });
  const bytes = Buffer.from(text + "\\n" + JSON.stringify({ word: "편지" }) + "\\n");
  // Split inside the multibyte character on purpose.
  process.stdout.write(bytes.subarray(0, bytes.length - 5));
  setTimeout(() => { process.stdout.write(bytes.subarray(bytes.length - 5)); process.exit(3); }, 20);
});`,
  );
  const lines: string[] = [];
  const child = startTurnProcess({
    command: process.execPath,
    args: [script],
    cwd: dir,
    env: { PATH: process.env.PATH ?? "" },
    input: "안녕 prompt",
    onStdoutLine: (line) => lines.push(line),
  });
  const result = await child.exited;
  assert.equal(result.code, 3);
  assert.deepEqual(
    lines.map((line) => JSON.parse(line)),
    [{ got: "안녕 prompt" }, { word: "편지" }],
  );
});

test("stop reaches the whole process group, even a child that ignores SIGINT", async (t) => {
  if (process.platform === "win32") return;
  const dir = await scratch(t);
  const pidFile = join(dir, "pids");
  const script = join(dir, "stubborn.js");
  await writeFile(
    script,
    `const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
process.on("SIGINT", () => {});
const grandchild = spawn(process.execPath, ["-e", "process.on('SIGINT', () => {}); setInterval(() => {}, 1000)"], { stdio: "ignore" });
writeFileSync(${JSON.stringify(pidFile)}, String(grandchild.pid));
console.log(JSON.stringify({ ready: true }));
setInterval(() => {}, 1000);`,
  );
  await writeFile(join(dir, "package.json"), JSON.stringify({ type: "commonjs" }));
  let ready!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const child = startTurnProcess({
    command: process.execPath,
    args: [script],
    cwd: dir,
    env: { PATH: process.env.PATH ?? "" },
    input: "",
    onStdoutLine: () => ready(),
    graceMs: 50,
  });
  await started;
  const grandchild = Number(await readFile(pidFile, "utf8"));
  assert.ok(alive(grandchild));
  child.stop();
  const result = await child.exited;
  assert.notEqual(result.code, 0);
  for (let i = 0; i < 50 && alive(grandchild); i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(alive(grandchild), false, "the grandchild was stopped with the group");
});

test("the launcher runs a CLI and turns its JSON lines into turn events", async (t) => {
  const dir = await scratch(t);
  const fake = join(dir, "fake-codex.js");
  await writeFile(
    fake,
    `let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  const out = (v) => process.stdout.write(JSON.stringify(v) + "\\n");
  out({ type: "thread.started", thread_id: "thread-1" });
  out({ type: "item.started", item: { type: "mcp_tool_call", server: "toony", tool: "get_status", arguments: {} } });
  out({ type: "item.completed", item: { type: "agent_message", text: "args:" + process.argv.slice(2, 4).join(" ") + " prompt:" + input } });
  out({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } });
});`,
  );
  const binary = join(dir, "codex");
  await writeFile(
    binary,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fake)} "$@"\n`,
  );
  await chmod(binary, 0o755);
  const files: RunFiles = {
    node: process.execPath,
    bridge: join(dir, "toony-mcp.mjs"),
    bridgeConfig: join(dir, "toony-mcp.json"),
    mcpConfig: join(dir, "mcp.json"),
    rulesFile: join(dir, "rules.md"),
    rules: "Rules.",
  };
  const events: NativeEvent[] = [];
  const handle = cliLauncher(
    {
      provider: "codex",
      binary,
      invocation: { provider: "codex", model: "", session: { mode: "new" }, files },
      cwd: dir,
      prompt: "Make a webtoon",
      callTool: async () => ({ content: [] }),
    },
    (event) => events.push(event),
  );
  const { code } = await handle.done;
  assert.equal(code, 0);
  assert.deepEqual(events, [
    { type: "session", id: "thread-1" },
    { type: "tool", name: "get_status", input: {} },
    { type: "text", text: "args:exec --color prompt:Make a webtoon" },
    { type: "completed", usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: undefined } },
  ]);
});
