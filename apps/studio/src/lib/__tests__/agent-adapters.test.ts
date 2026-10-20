// Provider adapters: the exact command line of a turn for both CLIs, and the
// tolerant stream parsers, fed synthetic lines (no identities, no model names).

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CODEX_DISABLED_FEATURES,
  claudeArgs,
  codexArgs,
  createClaudeParser,
  createCodexParser,
  type NativeEvent,
  type RunFiles,
  toonyToolName,
} from "../agent/adapters.js";
import { HOST_NOTICE, turnRules } from "../agent/host-notice.js";
import { AGENT_RULES } from "../agent/rules.js";

const files: RunFiles = {
  node: "/synthetic/node",
  bridge: "/synthetic/run/toony-mcp.mjs",
  bridgeConfig: "/synthetic/run/toony-mcp.json",
  mcpConfig: "/synthetic/run/mcp.json",
  rulesFile: "/synthetic/run/toony-rules.md",
  rules: 'Say "hello".\nSecond line.',
};

const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

test("Claude turns are restricted to the Toony MCP server and never prompt", () => {
  const args = claudeArgs({
    provider: "claude",
    model: "",
    session: { mode: "new", id: "11111111-2222-3333-4444-555555555555" },
    files,
  });
  for (const flag of [
    "-p",
    "--verbose",
    "--include-partial-messages",
    "--restricted",
    "--strict-mcp-config",
    "--no-chrome",
  ]) {
    assert.ok(args.includes(flag), flag);
  }
  assert.equal(after(args, "--output-format"), "stream-json");
  assert.equal(after(args, "--tools"), "");
  assert.equal(after(args, "--mcp-config"), files.mcpConfig);
  assert.equal(after(args, "--permission-mode"), "dontAsk");
  assert.equal(after(args, "--allowedTools"), "mcp__toony");
  assert.equal(after(args, "--append-system-prompt-file"), files.rulesFile);
  assert.equal(after(args, "--session-id"), "11111111-2222-3333-4444-555555555555");
  assert.ok(!args.includes("--resume"));
  assert.ok(!args.includes("--safe-mode"), "safe mode would disable the Toony server");
  assert.ok(!args.includes("--model"));
  // Every variadic option is followed by another option: nothing positional can be swallowed.
  for (const variadic of ["--tools", "--mcp-config", "--allowedTools"]) {
    assert.ok(args[args.indexOf(variadic) + 2]?.startsWith("--"), variadic);
  }

  const resumed = claudeArgs({
    provider: "claude",
    model: "opus",
    session: { mode: "resume", id: "abc" },
    files,
  });
  assert.equal(after(resumed, "--resume"), "abc");
  assert.equal(after(resumed, "--model"), "opus");
  assert.ok(!resumed.includes("--session-id"));
});

test("Codex turns run read-only, never ask, approve the Toony server and read stdin", () => {
  const args = codexArgs({ provider: "codex", model: "", session: { mode: "new" }, files });
  assert.deepEqual(args.slice(0, 4), ["exec", "--color", "never", "--json"]);
  assert.equal(args.at(-1), "-");
  for (const flag of ["--skip-git-repo-check", "--ignore-user-config", "--ignore-rules"]) {
    assert.ok(args.includes(flag), flag);
  }
  assert.ok(!args.includes("--ephemeral"), "sessions must persist to be resumed");
  const config = args.filter((_, i) => args[i - 1] === "-c");
  assert.ok(config.includes('sandbox_mode="read-only"'));
  assert.ok(config.includes('approval_policy="never"'));
  assert.ok(config.includes('web_search="disabled"'));
  assert.ok(config.includes('mcp_servers.toony.command="/synthetic/node"'));
  assert.ok(
    config.includes(
      'mcp_servers.toony.args=["/synthetic/run/toony-mcp.mjs", "/synthetic/run/toony-mcp.json"]',
    ),
  );
  assert.ok(config.includes('mcp_servers.toony.default_tools_approval_mode="approve"'));
  assert.ok(config.includes("skills.include_instructions=false"), "no skills catalog");
  assert.ok(config.includes("project_doc_max_bytes=0"), "no project AGENTS.md");
  assert.ok(config.includes('developer_instructions="Say \\"hello\\".\\nSecond line."'));
  for (const feature of CODEX_DISABLED_FEATURES) {
    assert.ok(config.includes(`features.${feature}=false`), feature);
  }

  const resumed = codexArgs({
    provider: "codex",
    model: "slug-1",
    session: { mode: "resume", id: "thread-1" },
    files,
  });
  assert.deepEqual(resumed.slice(0, 3), ["exec", "resume", "thread-1"]);
  assert.ok(!resumed.includes("--color"), "resume does not take --color");
  assert.ok(!resumed.includes("-s") && !resumed.includes("-C"));
  assert.equal(after(resumed, "-m"), "slug-1");
  assert.equal(resumed.at(-1), "-");
});

test("every turn's rules open with the notice that outside agent instructions do not apply", () => {
  const rules = turnRules(AGENT_RULES);
  assert.ok(rules.startsWith(`${HOST_NOTICE}\n\n`));
  assert.ok(rules.endsWith(AGENT_RULES));
  for (const named of ["AGENTS.md", "CLAUDE.md", "do not apply here", "Follow only these rules"]) {
    assert.ok(HOST_NOTICE.includes(named), named);
  }
  assert.ok(Buffer.byteLength(rules) < 4096, "rules stay under 4 KB");
});

const line = (value: unknown) => JSON.stringify(value);

function feed(parser: { line(l: string): NativeEvent[] }, values: unknown[]): NativeEvent[] {
  return values.flatMap((value) => parser.line(typeof value === "string" ? value : line(value)));
}

test("the Claude parser maps stream events and ignores what it does not know", () => {
  const parser = createClaudeParser();
  const events = feed(parser, [
    {
      type: "system",
      subtype: "init",
      session_id: "s-1",
      tools: ["mcp__toony__get_status"],
      mcp_servers: [{ name: "toony", status: "connected" }],
      plugins: [{ name: "builtin-a" }, { name: "builtin-b" }],
    },
    { type: "system", subtype: "ui_invalidate" },
    {
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } },
    },
    {
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } },
    },
    {
      type: "stream_event",
      event: {
        type: "content_block_start",
        content_block: { type: "tool_use", name: "mcp__toony__create_episode" },
      },
    },
    {
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        content: [
          { type: "text", text: "Hello" },
          { type: "tool_use", name: "mcp__toony__create_episode", input: { title: "One" } },
        ],
      },
    },
    {
      type: "assistant",
      parent_tool_use_id: "toolu_sub",
      message: { content: [{ type: "text", text: "sub" }] },
    },
    { type: "user", message: { content: [{ type: "tool_result" }] } },
    { type: "something_new", value: 1 },
    "not json at all",
    {
      type: "result",
      subtype: "success",
      is_error: false,
      usage: { input_tokens: 10, output_tokens: 2 },
    },
  ]);
  assert.deepEqual(events, [
    { type: "session", id: "s-1" },
    { type: "tools-ready", ready: true },
    { type: "text-delta", text: "Hel" },
    { type: "text-delta", text: "lo" },
    { type: "tool", name: "create_episode" },
    { type: "text", text: "Hello" },
    { type: "tool", name: "create_episode", input: { title: "One" } },
    {
      type: "completed",
      usage: { inputTokens: 10, outputTokens: 2, cachedInputTokens: undefined },
    },
  ]);
});

test("the Claude parser reports sign-in, limits, a failed Toony server and a lost session", () => {
  const auth = feed(createClaudeParser(), [
    {
      type: "assistant",
      error: "authentication_failed",
      message: { content: [{ type: "text", text: "Not logged in" }] },
    },
    {
      type: "result",
      subtype: "success",
      is_error: true,
      result: "Not logged in · Please run /login",
    },
  ]);
  assert.deepEqual(auth, [{ type: "auth-failed" }, { type: "auth-failed" }]);
  assert.deepEqual(
    feed(createClaudeParser(), [
      { type: "rate_limit_event", rate_limit_info: { status: "rejected" } },
    ]),
    [{ type: "rate-limited" }],
  );
  assert.deepEqual(
    feed(createClaudeParser(), [
      { type: "rate_limit_event", rate_limit_info: { status: "allowed" } },
    ]),
    [],
  );
  assert.deepEqual(
    feed(createClaudeParser(), [
      {
        type: "system",
        subtype: "init",
        session_id: "s",
        mcp_servers: [{ name: "toony", status: "failed" }],
      },
    ]),
    [
      { type: "session", id: "s" },
      { type: "tools-ready", ready: false },
    ],
  );
  const lost = createClaudeParser();
  assert.deepEqual(lost.stderr("No conversation found with session ID: x"), [
    { type: "resume-missing" },
  ]);
  assert.deepEqual(
    feed(lost, [
      {
        type: "result",
        subtype: "error_during_execution",
        errors: ["No conversation found with session ID: x"],
      },
    ]),
    [{ type: "resume-missing" }],
  );
  assert.deepEqual(
    feed(createClaudeParser(), [
      { type: "result", subtype: "error_max_turns", is_error: true, result: "" },
    ]),
    [{ type: "failed", message: "The agent could not finish this turn." }],
  );
});

test("the Codex parser maps exec events and stops early on a 401", () => {
  const events = feed(createCodexParser(), [
    { type: "thread.started", thread_id: "t-1" },
    { type: "turn.started" },
    {
      type: "item.completed",
      item: { id: "item_0", type: "agent_message", text: "Planning first." },
    },
    {
      type: "item.started",
      item: {
        id: "item_1",
        type: "mcp_tool_call",
        server: "toony",
        tool: "get_status",
        arguments: {},
        status: "in_progress",
      },
    },
    { type: "item.completed", item: { id: "item_1", type: "mcp_tool_call", status: "completed" } },
    { type: "item.completed", item: { id: "item_2", type: "error", message: "a config warning" } },
    { type: "item.updated", item: { id: "item_3", type: "todo_list", items: [] } },
    { type: "error", message: "Reconnecting... 1/5 (stream disconnected)" },
    { type: "item.completed", item: { id: "item_4", type: "agent_message", text: "Done." } },
    {
      type: "turn.completed",
      usage: { input_tokens: 5, cached_input_tokens: 3, output_tokens: 1 },
    },
  ]);
  assert.deepEqual(events, [
    { type: "session", id: "t-1" },
    { type: "text", text: "Planning first." },
    { type: "tool", name: "get_status", input: {} },
    { type: "text", text: "Done." },
    { type: "completed", usage: { inputTokens: 5, outputTokens: 1, cachedInputTokens: 3 } },
  ]);
  const unauthorized = feed(createCodexParser(), [
    {
      type: "error",
      message: "Reconnecting... 1/5 (unexpected status 401 Unauthorized: missing auth)",
    },
    {
      type: "error",
      message: "Reconnecting... 2/5 (unexpected status 401 Unauthorized: missing auth)",
    },
  ]);
  assert.deepEqual(unauthorized, [{ type: "auth-failed" }]);
  assert.deepEqual(
    feed(createCodexParser(), [
      { type: "turn.failed", error: { message: "usage limit reached (429)" } },
    ]),
    [{ type: "rate-limited" }],
  );
  assert.deepEqual(
    feed(createCodexParser(), [{ type: "turn.failed", error: { message: "something broke" } }]),
    [{ type: "failed", message: "The agent could not finish this turn." }],
  );
  assert.deepEqual(
    createCodexParser().stderr(
      "Error: thread/resume: thread/resume failed: no rollout found for thread id x",
    ),
    [{ type: "resume-missing" }],
  );
  assert.equal(toonyToolName("toony.read_story"), "read_story");
  assert.equal(toonyToolName("mcp__toony__read_story"), "read_story");
});
