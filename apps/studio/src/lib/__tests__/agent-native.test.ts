import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type TestContext, test } from "node:test";
import {
  NativeAnswerStream,
  nativeAnswer,
  nativeArguments,
  nativeEnvironment,
  parseNativeAnswer,
  runAgentProcess,
  supportedAgent,
  supportsRestrictions,
} from "../agent/native.js";
import type { AgentSettings } from "../agent/types.js";

const settings: AgentSettings = {
  provider: "codex",
  model: "",
  projectContext: true,
  retainHistory: true,
};
const lines = (...values: unknown[]) => `${values.map((v) => JSON.stringify(v)).join("\n")}\n`;
const codex = lines(
  { type: "item.completed", item: { type: "agent_message", phase: "final_answer", text: "안녕" } },
  { type: "turn.completed" },
);
const init = { type: "system", subtype: "init", tools: [], mcp_servers: [] };
const result = { type: "result", subtype: "success", is_error: false, result: "Hello" };
test("native execution has explicit tool restrictions and an allowlisted environment", () => {
  const args = nativeArguments(settings, "/synthetic-empty-workspace");
  for (const flag of ["--ignore-user-config", "--ignore-rules", "--ephemeral", "--sandbox"])
    assert.ok(args.includes(flag));
  assert.ok(args.includes("features.shell_tool=false"));
  assert.equal(args.at(-1), "-");
  const claude = nativeArguments({ ...settings, provider: "claude" }, "/synthetic-empty-workspace");
  assert.equal(claude[claude.indexOf("--tools") + 1], "");
  assert.ok(claude.includes("--safe-mode"));
  assert.deepEqual(
    nativeEnvironment({
      PATH: "bin",
      HOME: "home",
      OPENAI_API_KEY: "TEST_SECRET",
      NODE_OPTIONS: "untrusted",
      ANTHROPIC_BASE_URL: "untrusted",
    } as NodeJS.ProcessEnv),
    { PATH: "bin", HOME: "home" },
  );
});
test("unsupported versions and missing restriction flags fail compatibility", () => {
  assert.equal(supportedAgent("codex", "codex-cli 0.158.0"), true);
  assert.equal(supportedAgent("codex", "codex-cli 0.159.0"), false);
  assert.equal(supportedAgent("claude", "2.1.293 (Claude Code)"), true);
  assert.equal(supportedAgent("claude", "2.1.294"), false);
  assert.equal(supportsRestrictions("codex", "--json --sandbox"), false);
});
test("native response parsing preserves Unicode and prefers an explicit final answer", () => {
  assert.equal(
    parseNativeAnswer(
      "codex",
      codex +
        lines({ type: "item.completed", item: { type: "agent_message", text: "older fallback" } }),
    ),
    "안녕",
  );
  const stream = new NativeAnswerStream("claude");
  const raw = lines(init, result);
  for (let i = 0; i < raw.length; i += 3) stream.push(raw.slice(i, i + 3));
  assert.equal(stream.finish(), "Hello");
});
test("tool use, untrusted initialization and incomplete responses are rejected", () => {
  for (const raw of [
    lines(result),
    lines({ ...init, tools: ["Bash"] }, result),
    lines(init, { type: "assistant", message: { content: [{ type: "tool_use" }] } }, result),
    lines(init, { ...result, permission_denials: [{}] }),
  ])
    assert.throws(() => parseNativeAnswer("claude", raw), /restricted response/);
  for (const raw of [
    lines({ type: "turn.failed" }),
    lines({ type: "item.started", item: { type: "command_execution" } }),
    lines({ type: "turn.completed" }),
  ])
    assert.throws(() => parseNativeAnswer("codex", raw), /restricted response/);
});
async function executable(t: TestContext, script: string) {
  const root = await mkdtemp(join(tmpdir(), "agent-process-test-"));
  const previous = process.env.PATH;
  process.env.PATH = `${root}:${dirname(process.execPath)}`;
  await writeFile(join(root, "codex"), `#!${process.execPath}\n${script}`, { mode: 0o700 });
  t.after(async () => {
    process.env.PATH = previous;
    await rm(root, { recursive: true, force: true });
  });
  return root;
}
test("restricted subprocess rejects an actionable event before waiting for process completion", async (t) => {
  const root = await executable(
    t,
    `process.stdout.write(${JSON.stringify(lines({ type: "item.started", item: { type: "command_execution" } }))}); setTimeout(() => {}, 10000);`,
  );
  await assert.rejects(
    runAgentProcess("codex", [], root, "", new AbortController().signal, 1500),
    /restricted response/,
  );
});
test("cancel kills an owned descendant even when the parent already exited", async (t) => {
  const root = await executable(
    t,
    `const {spawn}=require('node:child_process'); const fs=require('node:fs'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore',process.stdout,process.stderr]}); fs.writeFileSync('child.pid',String(child.pid)); child.unref();`,
  );
  const abort = new AbortController();
  const promise = runAgentProcess("codex", [], root, "", abort.signal, 5000);
  let pid = 0;
  for (let i = 0; i < 100 && !pid; i++) {
    try {
      pid = Number(await readFile(join(root, "child.pid"), "utf8"));
    } catch {
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  assert.ok(pid);
  abort.abort();
  await assert.rejects(promise, /stopped/);
  let alive = true;
  for (let i = 0; i < 100 && alive; i++) {
    try {
      process.kill(pid, 0);
      await new Promise((r) => setTimeout(r, 10));
    } catch {
      alive = false;
    }
  }
  assert.equal(alive, false);
});
test("native inference never starts for an unverified executable version", async (t) => {
  const root = await executable(t, "");
  await writeFile(
    join(root, "codex"),
    `#!${process.execPath}\nif(process.argv.includes('--version')) console.log('0.999.0'); else require('node:fs').writeFileSync(${JSON.stringify(join(root, "called"))},'yes');`,
    { mode: 0o700 },
  );
  await assert.rejects(
    nativeAnswer(settings, "test greeting", new AbortController().signal),
    /not been verified/,
  );
  await assert.rejects(readFile(join(root, "called")), { code: "ENOENT" });
});
