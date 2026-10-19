import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentAvailability,
  AgentError,
  type AgentProvider,
  type AgentSettings,
} from "./types.js";

const DISABLED = [
  "shell_tool",
  "unified_exec",
  "shell_snapshot",
  "apps",
  "plugins",
  "remote_plugin",
  "browser_use",
  "browser_use_external",
  "computer_use",
  "image_generation",
  "view_image",
  "multi_agent",
  "hooks",
  "memories",
  "skill_search",
  "skill_mcp_dependency_install",
  "code_mode",
  "code_mode_host",
  "goals",
];
export function nativeEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const allowed = [
    "HOME",
    "PATH",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "USER",
    "LOGNAME",
    "__CF_USER_TEXT_ENCODING",
    "CODEX_HOME",
    "CLAUDE_CONFIG_DIR",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "SYSTEMROOT",
  ];
  return Object.fromEntries(
    allowed.flatMap((key) => (source[key] === undefined ? [] : [[key, source[key]]])),
  ) as NodeJS.ProcessEnv;
}
export function supportedAgent(provider: AgentProvider, version: string): boolean {
  const match = /\b(\d+)\.(\d+)\.(\d+)\b/.exec(version);
  if (!match) return false;
  return match[0] === (provider === "codex" ? "0.158.0" : "2.1.293");
}
export function supportsRestrictions(provider: AgentProvider, help: string): boolean {
  const flags =
    provider === "codex"
      ? ["--ignore-user-config", "--ignore-rules", "--ephemeral", "--sandbox", "--json"]
      : [
          "--restricted",
          "--safe-mode",
          "--tools",
          "--strict-mcp-config",
          "--permission-prompts",
          "--no-session-persistence",
          "--output-format",
        ];
  return flags.every((flag) => help.includes(flag));
}
export function nativeArguments(settings: AgentSettings, cwd: string): string[] {
  const args =
    settings.provider === "codex"
      ? [
          "exec",
          "--ignore-user-config",
          "--ignore-rules",
          "--ephemeral",
          "--skip-git-repo-check",
          "--sandbox",
          "read-only",
          "--json",
          "--color",
          "never",
          "--cd",
          cwd,
          ...[
            'approval_policy="never"',
            'web_search="disabled"',
            "project_doc_max_bytes=0",
            'history.persistence="none"',
            "features.skip_host_skill_discovery=true",
            ...DISABLED.map((name) => `features.${name}=false`),
          ].flatMap((value) => ["-c", value]),
        ]
      : [
          "--restricted",
          "--safe-mode",
          "--tools",
          "",
          "--strict-mcp-config",
          "--mcp-config",
          '{"mcpServers":{}}',
          "--no-chrome",
          "--permission-prompts",
          "none",
          "--disallowedTools",
          "*",
          "--no-session-persistence",
          "-p",
          "--output-format",
          "stream-json",
          "--verbose",
        ];
  if (settings.model) args.push("--model", settings.model);
  if (settings.provider === "codex") args.push("-");
  return args;
}
interface ProcessOutput {
  stdout: string;
  stderr: string;
  code: number | null;
}
export function runAgentProcess(
  provider: AgentProvider,
  args: string[],
  cwd: string,
  input: string,
  signal: AbortSignal,
  timeout = 180_000,
  probe = false,
): Promise<ProcessOutput> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new AgentError("cancelled", "Response stopped."));
      return;
    }
    const child = spawn(provider, args, {
      cwd,
      env: nativeEnvironment(),
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "",
      bytes = 0,
      finished = false;
    const stream = probe ? null : new NativeAnswerStream(provider);
    const kill = () => {
      if (!child.pid) return;
      try {
        if (process.platform === "win32") child.kill("SIGKILL");
        else process.kill(-child.pid, "SIGKILL");
      } catch {
        /* Already exited. */
      }
    };
    const finish = (error?: AgentError, code: number | null = null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      kill();
      if (error) reject(error);
      else resolve({ stdout, stderr, code });
    };
    const abort = () => finish(new AgentError("cancelled", "Response stopped."));
    const timer = setTimeout(
      () =>
        finish(
          new AgentError(
            "timeout",
            "The response timed out. Try again or check your agent connection.",
          ),
        ),
      timeout,
    );
    signal.addEventListener("abort", abort, { once: true });
    const read = (chunk: Buffer, diagnostic: boolean) => {
      bytes += chunk.byteLength;
      if (bytes > (probe ? 65_536 : 2_000_000)) {
        finish(new AgentError("size", "The agent response exceeded the local limit."));
        return;
      }
      if (diagnostic) {
        if (probe) stderr += chunk.toString("utf8");
      } else {
        const text = chunk.toString("utf8");
        stdout += text;
        try {
          stream?.push(text);
        } catch {
          finish(responseError());
        }
      }
    };
    // StringDecoder via setEncoding keeps multibyte characters intact across chunks.
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => read(Buffer.from(chunk), false));
    child.stderr.on("data", (chunk: string) => read(Buffer.from(chunk), true));
    child.stdin.on("error", () => {});
    child.on("error", () =>
      finish(
        new AgentError("missing", "The selected agent could not start. Check its installation."),
      ),
    );
    child.on("close", (code) => finish(undefined, code));
    if (signal.aborted) abort();
    else child.stdin.end(input);
  });
}
function responseError() {
  return new AgentError(
    "response",
    "The agent did not return a complete, restricted response. Check your connection.",
  );
}
// Validate each complete event while the child is alive so a prohibited action
// terminates the owned process group immediately, not after its final response.
export class NativeAnswerStream {
  private pending = "";
  private answer: unknown;
  private explicitFinal = false;
  private initialized = false;
  private completed = false;
  constructor(private provider: AgentProvider) {}
  push(chunk: string): void {
    this.pending += chunk;
    while (this.pending.includes("\n")) {
      const newline = this.pending.indexOf("\n");
      const line = this.pending.slice(0, newline).trim();
      this.pending = this.pending.slice(newline + 1);
      if (line) this.event(line);
    }
  }
  private event(line: string): void {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (!event || typeof event !== "object") throw new Error();
      if (this.provider === "codex") {
        if (
          ![
            "thread.started",
            "turn.started",
            "item.started",
            "item.updated",
            "item.completed",
            "turn.completed",
          ].includes(String(event.type))
        )
          throw new Error();
        const item = event.item as Record<string, unknown> | undefined;
        if (
          String(event.type).startsWith("item.") &&
          (!item || !["agent_message", "reasoning"].includes(String(item.type)))
        )
          throw new Error();
        if (item && !["agent_message", "reasoning"].includes(String(item.type))) throw new Error();
        if (event.type === "item.completed" && item?.type === "agent_message") {
          if (item.phase === "final_answer") {
            this.explicitFinal = true;
            this.answer = item.text;
          } else if (!item.phase && !this.explicitFinal) this.answer = item.text;
        }
        if (event.type === "turn.completed") this.completed = true;
      } else {
        if (
          !["system", "assistant", "result", "rate_limit_event"].includes(String(event.type)) ||
          event.parent_tool_use_id
        )
          throw new Error();
        if (event.type === "system") {
          if (event.subtype !== "init" || this.initialized) throw new Error();
          for (const key of ["tools", "mcp_servers"])
            if (!Array.isArray(event[key]) || event[key].length !== 0) throw new Error();
          if (
            event.plugins !== undefined &&
            (!Array.isArray(event.plugins) || event.plugins.length)
          )
            throw new Error();
          if (
            event.plugin_errors !== undefined &&
            (!Array.isArray(event.plugin_errors) || event.plugin_errors.length)
          )
            throw new Error();
          this.initialized = true;
        }
        const message = event.message as { content?: Array<{ type?: string }> } | undefined;
        if (
          message &&
          (!Array.isArray(message.content) ||
            message.content.some(
              (item) => !["text", "thinking", "redacted_thinking"].includes(String(item.type)),
            ))
        )
          throw new Error();
        if (event.type === "result") {
          if (
            !this.initialized ||
            event.is_error ||
            event.subtype !== "success" ||
            (event.permission_denials !== undefined &&
              (!Array.isArray(event.permission_denials) || event.permission_denials.length))
          )
            throw new Error();
          this.completed = true;
          this.answer = event.result;
        }
      }
    } catch {
      throw responseError();
    }
  }
  finish(): string {
    if (this.pending.trim()) this.event(this.pending.trim());
    this.pending = "";
    if (
      !this.completed ||
      typeof this.answer !== "string" ||
      !this.answer.trim() ||
      this.answer.length > 60_000
    )
      throw responseError();
    return this.answer.trim();
  }
}
export function parseNativeAnswer(provider: AgentProvider, output: string): string {
  const stream = new NativeAnswerStream(provider);
  stream.push(output);
  return stream.finish();
}
async function checkCompatibility(
  provider: AgentProvider,
  cwd: string,
  signal: AbortSignal,
): Promise<boolean> {
  const version = await runAgentProcess(provider, ["--version"], cwd, "", signal, 8_000, true);
  if (version.code !== 0 || !supportedAgent(provider, version.stdout)) return false;
  const help = await runAgentProcess(
    provider,
    provider === "codex" ? ["exec", "--help"] : ["--help"],
    cwd,
    "",
    signal,
    8_000,
    true,
  );
  return help.code === 0 && supportsRestrictions(provider, help.stdout);
}
export async function probeAgent(provider: AgentProvider): Promise<AgentAvailability> {
  const cwd = await mkdtemp(join(tmpdir(), "toony-agent-"));
  const signal = new AbortController().signal;
  try {
    if (!(await checkCompatibility(provider, cwd, signal)))
      return { provider, state: "unsupported" };
    const result = await runAgentProcess(
      provider,
      provider === "codex" ? ["login", "status"] : ["auth", "status", "--json"],
      cwd,
      "",
      signal,
      8_000,
      true,
    );
    let ready = false;
    if (provider === "codex")
      ready =
        result.code === 0 && (result.stdout + result.stderr).includes("Logged in using ChatGPT");
    else {
      const data = JSON.parse(result.stdout);
      ready = result.code === 0 && data.loggedIn === true && data.authMethod === "claude.ai";
    }
    return { provider, state: ready ? "ready" : "sign-in-required" };
  } catch (error) {
    return {
      provider,
      state: error instanceof AgentError && error.code === "missing" ? "missing" : "unavailable",
    };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}
export async function nativeAnswer(
  settings: AgentSettings,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  if (Buffer.byteLength(prompt) > 200_000)
    throw new AgentError(
      "context",
      "This conversation is too large. Start a new conversation with the current project.",
    );
  const cwd = await mkdtemp(join(tmpdir(), "toony-agent-"));
  try {
    if (!(await checkCompatibility(settings.provider, cwd, signal)))
      throw new AgentError(
        "unsupported",
        "This agent version has not been verified. Check the connection guide.",
      );
    const result = await runAgentProcess(
      settings.provider,
      nativeArguments(settings, cwd),
      cwd,
      prompt,
      signal,
    );
    if (result.code !== 0)
      throw new AgentError(
        "failed",
        "The agent could not finish. Check login, model access or usage limits in your agent.",
      );
    return parseNativeAnswer(settings.provider, result.stdout);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}
