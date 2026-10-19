// Agent readiness: version ranges, required options from the CLI's own help,
// the sign-in checks (only the allowed fields are read), and the per-binary
// cache that keeps version and help probes out of every turn.

import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ProbeResult } from "../agent/process.js";
import { nativeEnvironment } from "../agent/process.js";
import {
  candidateDirs,
  locateBinary,
  missingFlags,
  PROVIDER_INFO,
  parseClaudeAuth,
  parseCodexLogin,
  parseVersion,
  REQUIRED_FLAGS,
  Readiness,
  SUBSCRIPTION_MESSAGE,
  versionInRange,
} from "../agent/readiness.js";

test("versions are read from CLI output and checked against the supported ranges", () => {
  assert.deepEqual(parseVersion("2.1.293 (Claude Code)"), [2, 1, 293]);
  assert.deepEqual(parseVersion("codex-cli 0.158.0"), [0, 158, 0]);
  assert.equal(parseVersion("no version here"), null);
  const claude = (v: string) => versionInRange("claude", parseVersion(v) ?? [0, 0, 0]);
  const codex = (v: string) => versionInRange("codex", parseVersion(v) ?? [0, 0, 0]);
  assert.equal(claude("2.1.258"), false);
  assert.equal(claude("2.1.259"), true);
  assert.equal(claude("2.1.293"), true);
  assert.equal(claude("2.1.999"), true);
  assert.equal(claude("2.2.0"), false);
  assert.equal(codex("0.157.9"), false);
  assert.equal(codex("0.158.0"), true);
  assert.equal(codex("0.169.4"), true);
  assert.equal(codex("0.170.0"), false);
  assert.equal(codex("1.0.0"), false);
});

const CLAUDE_HELP = `Usage: claude [options] [command] [prompt]
  -p, --print                 Print response and exit
  --output-format <format>    Output format
  --verbose                   Verbose
  --include-partial-messages  Partial messages
  --restricted                Restricted mode
  --tools <tools...>          Built-in tools
  --strict-mcp-config         Only --mcp-config servers
  --mcp-config <configs...>   MCP servers
  --permission-mode <mode>    (choices: "acceptEdits", "auto", "dontAsk", "plan")
  --allowedTools <tools...>   Allowed tools
  --no-chrome                 No browser
  --append-system-prompt <prompt>  Append (also --append-system-prompt[-file])
  --session-id <uuid>         Session id
  -r, --resume [value]        Resume
`;
const CODEX_EXEC_HELP = `Usage: codex exec [OPTIONS] [PROMPT]
  -c, --config <key=value>
      --json
      --skip-git-repo-check
      --ignore-user-config
      --ignore-rules
      --color <COLOR>
`;
const CODEX_RESUME_HELP = `Usage: codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]
  -c, --config <key=value>
      --json
      --skip-git-repo-check
      --ignore-user-config
      --ignore-rules
`;

test("required options are checked in the CLI's own help, resume help included", () => {
  assert.deepEqual(missingFlags("claude", { main: CLAUDE_HELP }), []);
  assert.deepEqual(
    missingFlags("claude", { main: CLAUDE_HELP.replace("--restricted ", "--other ") }),
    ["--restricted"],
  );
  // "--tools" must not be satisfied by "--allowedTools" alone.
  assert.ok(
    missingFlags("claude", {
      main: CLAUDE_HELP.replace("--tools <tools...>", "--toolset"),
    }).includes("--tools"),
  );
  assert.deepEqual(missingFlags("codex", { main: CODEX_EXEC_HELP, resume: CODEX_RESUME_HELP }), []);
  assert.deepEqual(missingFlags("codex", { main: CODEX_EXEC_HELP, resume: "" }), [
    ...(REQUIRED_FLAGS.codex.resume ?? []).map((flag) => `resume ${flag}`),
  ]);
});

test("sign-in checks read only the allowed fields and accept subscription sign-ins", () => {
  const claude = (value: unknown, code = 0) => parseClaudeAuth(JSON.stringify(value), code);
  assert.equal(
    claude({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty" }),
    "ready",
  );
  assert.equal(
    claude({ loggedIn: true, authMethod: "api_key", apiProvider: "firstParty" }),
    "other-method",
  );
  assert.equal(
    claude({ loggedIn: true, authMethod: "claude.ai", apiProvider: "bedrock" }),
    "other-method",
  );
  assert.equal(claude({ loggedIn: false, authMethod: "none" }, 1), "signed-out");
  assert.equal(claude({ loggedIn: true, authMethod: "claude.ai" }, 2), "unknown");
  assert.equal(parseClaudeAuth("not json", 1), "signed-out");
  assert.equal(parseClaudeAuth("not json", 0), "unknown");
  assert.equal(parseCodexLogin("Logged in using ChatGPT\n", 0), "ready");
  assert.equal(parseCodexLogin("Logged in using an API key - masked\n", 0), "other-method");
  assert.equal(parseCodexLogin("Not logged in\n", 1), "signed-out");
  assert.equal(parseCodexLogin("", null), "unknown");
});

test("the environment of an agent CLI is an allowlist", () => {
  const env = nativeEnvironment({
    HOME: "/synthetic-home",
    PATH: "/usr/bin",
    OPENAI_API_KEY: "test-only",
    ANTHROPIC_API_KEY: "test-only",
    ANTHROPIC_BASE_URL: "http://example.test",
    NODE_OPTIONS: "--require x",
  });
  assert.deepEqual(env, { HOME: "/synthetic-home", PATH: "/usr/bin" });
});

test("binaries are found on PATH and in the usual install folders", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "toony-locate-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const dirs = candidateDirs({ PATH: `/nowhere:${dir}` }, "/synthetic-home", "/opt/node/bin/node");
  assert.ok(dirs.includes(dir));
  assert.ok(dirs.includes("/synthetic-home/.local/bin"));
  assert.ok(dirs.includes("/opt/homebrew/bin"));
  assert.ok(dirs.includes("/usr/local/bin"));
  assert.ok(dirs.includes("/opt/node/bin"));
  assert.equal(await locateBinary("codex", [dir]), null);
  await writeFile(join(dir, "codex"), "#!/bin/sh\n");
  assert.equal(await locateBinary("codex", [dir]), null, "not executable yet");
  await chmod(join(dir, "codex"), 0o755);
  assert.equal(await locateBinary("codex", ["/nowhere", dir]), join(dir, "codex"));
});

function fakeRunner(outputs: Record<string, ProbeResult>, calls: string[]) {
  return async (command: string, args: readonly string[]): Promise<ProbeResult> => {
    const key = [command.split("/").at(-1), ...args].join(" ");
    calls.push(key);
    return outputs[key] ?? { code: 1, stdout: "", stderr: "" };
  };
}

test("readiness reports each state with fix commands and caches version checks per binary", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "toony-ready-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const calls: string[] = [];
  const outputs: Record<string, ProbeResult> = {
    "claude --version": { code: 0, stdout: "2.1.293 (Claude Code)\n", stderr: "" },
    "claude --help": { code: 0, stdout: CLAUDE_HELP, stderr: "" },
    "claude auth status --json": {
      code: 1,
      stdout: JSON.stringify({ loggedIn: false, authMethod: "none", apiProvider: "firstParty" }),
      stderr: "",
    },
    "codex --version": { code: 0, stdout: "codex-cli 0.158.0\n", stderr: "" },
    "codex exec --help": { code: 0, stdout: CODEX_EXEC_HELP, stderr: "" },
    "codex exec resume --help": { code: 0, stdout: CODEX_RESUME_HELP, stderr: "" },
    "codex login status": { code: 0, stdout: "", stderr: "Logged in using ChatGPT\n" },
  };
  let time = 0;
  const readiness = new Readiness({
    cwd: dir,
    run: fakeRunner(outputs, calls),
    locate: async (provider) => (provider === "claude" ? "/fake/bin/claude" : "/fake/bin/codex"),
    now: () => time,
  });
  const claude = await readiness.check("claude");
  assert.deepEqual(claude.status.readiness, {
    state: "sign-in-required",
    version: "2.1.293",
    command: "claude auth login",
  });
  const codex = await readiness.check("codex");
  assert.deepEqual(codex.status.readiness, { state: "ready", version: "0.158.0" });
  assert.equal(codex.status.label, "Codex");

  // A cached sign-in is reused; a refresh re-checks the sign-in but not the version or help.
  const before = calls.length;
  await readiness.check("codex");
  assert.equal(calls.length, before);
  await readiness.check("codex", true);
  assert.deepEqual(calls.slice(before), ["codex login status"]);
  time += 120_000;
  await readiness.check("codex");
  assert.equal(calls.filter((c) => c === "codex --version").length, 1);

  // Another sign-in method is explained, not accepted.
  outputs["codex login status"] = {
    code: 0,
    stdout: "Logged in using an API key - x\n",
    stderr: "",
  };
  const other = await readiness.check("codex", true);
  assert.equal(other.status.readiness.state, "sign-in-required");
  assert.equal(
    other.status.readiness.state === "sign-in-required" ? other.status.readiness.message : "",
    SUBSCRIPTION_MESSAGE,
  );
});

test("missing and unsupported CLIs get install commands, docs and the supported range", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "toony-ready-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const calls: string[] = [];
  const missing = new Readiness({ cwd: dir, run: fakeRunner({}, calls), locate: async () => null });
  const status = (await missing.check("claude")).status;
  assert.deepEqual(status.readiness, {
    state: "missing",
    installCommand: PROVIDER_INFO.claude.installCommand,
    docsUrl: PROVIDER_INFO.claude.docsUrl,
  });
  assert.equal(calls.length, 0);

  const old = new Readiness({
    cwd: dir,
    run: fakeRunner(
      { "codex --version": { code: 0, stdout: "codex-cli 0.150.2", stderr: "" } },
      calls,
    ),
    locate: async () => "/fake/bin/codex",
  });
  assert.deepEqual((await old.check("codex")).status.readiness, {
    state: "unsupported",
    version: "0.150.2",
    supported: PROVIDER_INFO.codex.supported,
  });
  assert.ok(!calls.includes("codex exec --help"), "no help probe for an unsupported version");

  const noFlags = new Readiness({
    cwd: dir,
    run: fakeRunner(
      {
        "claude --version": { code: 0, stdout: "2.1.300", stderr: "" },
        "claude --help": { code: 0, stdout: "Usage: claude", stderr: "" },
      },
      [],
    ),
    locate: async () => "/fake/bin/claude",
  });
  const result = await noFlags.check("claude");
  assert.equal(result.status.readiness.state, "unsupported");
  assert.ok(result.binary && result.binary.missingFlags.length > 0);
  assert.deepEqual(Readiness.binaryProblem("claude", result.binary)?.state, "unsupported");
});
