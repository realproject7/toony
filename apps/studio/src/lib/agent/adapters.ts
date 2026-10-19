// Provider adapters: the exact command line of one agent turn, and tolerant
// parsers that turn each CLI's JSON lines into a few normalized events.
//
// Claude Code (print mode, stream JSON, partial messages), restricted: no
// built-in tools, only the Toony MCP server (strict config), allowed without a
// prompt (`--permission-mode dontAsk --allowedTools mcp__toony`). Codex `exec`
// (JSON lines), read-only sandbox, never asks, user config and rules ignored,
// shell/web/image/plugin features off, the Toony MCP server approved.
//
// Parsers ignore event types they do not know and never fail on non-empty
// `plugins`; safety comes from the flags and from Toony's own tool checks.

import type { AgentProvider } from "./protocol.js";

/**
 * Codex features Toony turns off. `code_mode_host` stays on: the model reaches
 * MCP tools through the code-mode host (its `exec` tool lists ALL_TOOLS), so
 * turning the host off leaves the agent without the Toony tools. With the
 * shell, unified exec, browser, image and plugin features off, the host can
 * only call the Toony tools.
 */
export const CODEX_DISABLED_FEATURES = [
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
  "goals",
] as const;

/** The MCP server name. The agent sees `mcp__toony__<tool>` (Claude) or `toony.<tool>` (Codex). */
export const MCP_SERVER = "toony";

/** Longest a single Toony tool call may take (export waits up to five minutes). */
export const TOOL_TIMEOUT_SEC = 420;

export interface RunFiles {
  /** Node binary that runs the bridge. */
  node: string;
  /** The bridge script. */
  bridge: string;
  /** The bridge's config (url, token, tool list). */
  bridgeConfig: string;
  /** Claude's MCP config file. */
  mcpConfig: string;
  /** Claude's appended system prompt file. */
  rulesFile: string;
  /** The rules text, for Codex's developer instructions. */
  rules: string;
}

export interface TurnInvocation {
  provider: AgentProvider;
  /** Empty for the provider's default model. */
  model: string;
  /** Claude: the session id to create (new) or resume. Codex: the thread to resume, if any. */
  session: { mode: "new"; id?: string } | { mode: "resume"; id: string };
  files: RunFiles;
}

/** TOML basic string (JSON escaping is a subset TOML accepts). */
function toml(value: string): string {
  return JSON.stringify(value);
}

export function claudeArgs(invocation: TurnInvocation): string[] {
  const { files, model, session } = invocation;
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--restricted",
    // Variadic options are each followed by another option, so no positional
    // argument can be swallowed; the prompt arrives on stdin.
    "--tools",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    files.mcpConfig,
    "--permission-mode",
    "dontAsk",
    "--allowedTools",
    `mcp__${MCP_SERVER}`,
    "--no-chrome",
    "--append-system-prompt-file",
    files.rulesFile,
  ];
  if (model) args.push("--model", model);
  if (session.mode === "resume") args.push("--resume", session.id);
  else if (session.id) args.push("--session-id", session.id);
  return args;
}

/** The `-c` overrides shared by `codex exec` and `codex exec resume`. */
export function codexConfig(files: RunFiles): string[] {
  const values = [
    `sandbox_mode=${toml("read-only")}`,
    `approval_policy=${toml("never")}`,
    `web_search=${toml("disabled")}`,
    `history.persistence=${toml("none")}`,
    "project_doc_max_bytes=0",
    `developer_instructions=${toml(files.rules)}`,
    `mcp_servers.${MCP_SERVER}.command=${toml(files.node)}`,
    `mcp_servers.${MCP_SERVER}.args=[${[files.bridge, files.bridgeConfig].map(toml).join(", ")}]`,
    `mcp_servers.${MCP_SERVER}.tool_timeout_sec=${TOOL_TIMEOUT_SEC}`,
    `mcp_servers.${MCP_SERVER}.default_tools_approval_mode=${toml("approve")}`,
    "features.skip_host_skill_discovery=true",
    ...CODEX_DISABLED_FEATURES.map((name) => `features.${name}=false`),
  ];
  return values.flatMap((value) => ["-c", value]);
}

export function codexArgs(invocation: TurnInvocation): string[] {
  const { files, model, session } = invocation;
  const common = [
    "--json",
    "--skip-git-repo-check",
    "--ignore-user-config",
    "--ignore-rules",
    ...codexConfig(files),
  ];
  const modelArgs = model ? ["-m", model] : [];
  // `exec resume` takes neither -s nor -C nor --color; the cwd is the spawn cwd.
  if (session.mode === "resume") {
    return ["exec", "resume", session.id, ...common, ...modelArgs, "-"];
  }
  return ["exec", "--color", "never", ...common, ...modelArgs, "-"];
}

export function turnArgs(invocation: TurnInvocation): string[] {
  return invocation.provider === "claude" ? claudeArgs(invocation) : codexArgs(invocation);
}

export interface TurnUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
}

/** What a turn's output means to Toony. */
export type NativeEvent =
  | { type: "session"; id: string }
  /** Claude reported its tools at start; false when the Toony server did not connect. */
  | { type: "tools-ready"; ready: boolean }
  | { type: "text-delta"; text: string }
  | { type: "text"; text: string }
  | { type: "tool"; name: string; input?: unknown }
  | { type: "completed"; usage?: TurnUsage }
  | { type: "auth-failed" }
  | { type: "rate-limited" }
  | { type: "failed"; message: string }
  | { type: "resume-missing" };

export interface StreamParser {
  /** One complete stdout line. Returns zero or more events. Never throws. */
  line(line: string): NativeEvent[];
  /** One stderr line; only the "session not found" texts are looked for. */
  stderr(line: string): NativeEvent[];
}

const RESUME_MISSING = /No conversation found|no rollout found|thread\/resume failed/i;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The Toony tool name of a native tool name, or the name itself. */
export function toonyToolName(name: string): string {
  if (name.startsWith(`mcp__${MCP_SERVER}__`)) return name.slice(`mcp__${MCP_SERVER}__`.length);
  if (name.startsWith(`${MCP_SERVER}.`)) return name.slice(MCP_SERVER.length + 1);
  return name;
}

const AUTH_TEXT = /not logged in|\/login|authenticat|unauthori[sz]ed|\b401\b|oauth/i;
const RATE_TEXT = /rate.?limit|usage limit|\b429\b|too many requests|quota/i;

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function createClaudeParser(): StreamParser {
  let resumeMissing = false;
  return {
    line(raw) {
      let event: Record<string, unknown> | null;
      try {
        event = record(JSON.parse(raw));
      } catch {
        return [];
      }
      if (event === null) return [];
      // Subagent output is not the main conversation.
      if (event.parent_tool_use_id) return [];
      const out: NativeEvent[] = [];
      switch (event.type) {
        case "system": {
          if (event.subtype === "init") {
            if (typeof event.session_id === "string")
              out.push({ type: "session", id: event.session_id });
            const servers = Array.isArray(event.mcp_servers) ? event.mcp_servers : [];
            const toony = servers.map(record).find((server) => server?.name === MCP_SERVER);
            out.push({
              type: "tools-ready",
              ready: toony !== undefined && toony !== null && toony.status !== "failed",
            });
          } else if (event.subtype === "api_retry" && event.error === "authentication_failed") {
            out.push({ type: "auth-failed" });
          }
          break;
        }
        case "stream_event": {
          const inner = record(event.event);
          if (inner?.type === "content_block_delta") {
            const delta = record(inner.delta);
            if (delta?.type === "text_delta" && typeof delta.text === "string" && delta.text) {
              out.push({ type: "text-delta", text: delta.text });
            }
          } else if (inner?.type === "content_block_start") {
            const block = record(inner.content_block);
            if (block?.type === "tool_use" && typeof block.name === "string") {
              out.push({ type: "tool", name: toonyToolName(block.name) });
            }
          }
          break;
        }
        case "assistant": {
          if (event.error === "authentication_failed") out.push({ type: "auth-failed" });
          else if (event.error === "rate_limit") out.push({ type: "rate-limited" });
          else if (typeof event.error === "string" && event.error) {
            out.push({ type: "failed", message: claudeErrorMessage(event.error) });
          }
          if (typeof event.error === "string" && event.error) break;
          const message = record(event.message);
          const content = Array.isArray(message?.content) ? message.content : [];
          for (const item of content) {
            const block = record(item);
            if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
              out.push({ type: "text", text: block.text });
            } else if (block?.type === "tool_use" && typeof block.name === "string") {
              out.push({ type: "tool", name: toonyToolName(block.name), input: block.input });
            }
          }
          break;
        }
        case "rate_limit_event": {
          const info = record(event.rate_limit_info);
          if (info?.status === "rejected") out.push({ type: "rate-limited" });
          break;
        }
        case "result": {
          const errors = Array.isArray(event.errors)
            ? event.errors.filter((e) => typeof e === "string")
            : [];
          const text = typeof event.result === "string" ? event.result : "";
          if (errors.some((e) => RESUME_MISSING.test(e)) || RESUME_MISSING.test(text)) {
            resumeMissing = true;
            out.push({ type: "resume-missing" });
          } else if (
            event.is_error === true ||
            (typeof event.subtype === "string" && event.subtype !== "success")
          ) {
            if (AUTH_TEXT.test(text)) out.push({ type: "auth-failed" });
            else if (RATE_TEXT.test(text)) out.push({ type: "rate-limited" });
            else out.push({ type: "failed", message: "The agent could not finish this turn." });
          } else {
            const usage = record(event.usage);
            out.push({
              type: "completed",
              ...(usage
                ? {
                    usage: {
                      inputTokens: numberOf(usage.input_tokens),
                      outputTokens: numberOf(usage.output_tokens),
                      cachedInputTokens: numberOf(usage.cache_read_input_tokens),
                    },
                  }
                : {}),
            });
          }
          break;
        }
        default:
          break;
      }
      return out;
    },
    stderr(line) {
      if (!resumeMissing && RESUME_MISSING.test(line)) {
        resumeMissing = true;
        return [{ type: "resume-missing" }];
      }
      return [];
    },
  };
}

function claudeErrorMessage(code: string): string {
  switch (code) {
    case "billing_error":
      return "Your Claude plan could not be used for this request. Check your subscription.";
    case "overloaded":
    case "server_error":
      return "Claude is busy right now. Try again in a moment.";
    case "model_not_found":
      return "The chosen model is not available to your account. Pick another model in the agent settings.";
    case "max_output_tokens":
      return "The reply was too long to finish. Ask for a shorter step.";
    default:
      return "The agent could not finish this turn.";
  }
}

export function createCodexParser(): StreamParser {
  let resumeMissing = false;
  let authSeen = false;
  return {
    line(raw) {
      let event: Record<string, unknown> | null;
      try {
        event = record(JSON.parse(raw));
      } catch {
        return [];
      }
      if (event === null) return [];
      const out: NativeEvent[] = [];
      switch (event.type) {
        case "thread.started":
          if (typeof event.thread_id === "string")
            out.push({ type: "session", id: event.thread_id });
          break;
        case "item.started": {
          const item = record(event.item);
          if (item?.type === "mcp_tool_call" && typeof item.tool === "string") {
            out.push({ type: "tool", name: toonyToolName(item.tool), input: item.arguments });
          }
          break;
        }
        case "item.completed": {
          const item = record(event.item);
          if (item?.type === "agent_message" && typeof item.text === "string" && item.text.trim()) {
            out.push({ type: "text", text: item.text });
          }
          break;
        }
        case "error": {
          // Retries report each failed attempt; a 401 never recovers, so stop early.
          const message = typeof event.message === "string" ? event.message : "";
          if (!authSeen && /\b401\b|unauthorized|not logged in/i.test(message)) {
            authSeen = true;
            out.push({ type: "auth-failed" });
          }
          break;
        }
        case "turn.failed": {
          const error = record(event.error);
          const message = typeof error?.message === "string" ? error.message : "";
          if (AUTH_TEXT.test(message)) out.push({ type: "auth-failed" });
          else if (RATE_TEXT.test(message)) out.push({ type: "rate-limited" });
          else out.push({ type: "failed", message: "The agent could not finish this turn." });
          break;
        }
        case "turn.completed": {
          const usage = record(event.usage);
          out.push({
            type: "completed",
            ...(usage
              ? {
                  usage: {
                    inputTokens: numberOf(usage.input_tokens),
                    outputTokens: numberOf(usage.output_tokens),
                    cachedInputTokens: numberOf(usage.cached_input_tokens),
                  },
                }
              : {}),
          });
          break;
        }
        default:
          break;
      }
      return out;
    },
    stderr(line) {
      if (!resumeMissing && RESUME_MISSING.test(line)) {
        resumeMissing = true;
        return [{ type: "resume-missing" }];
      }
      return [];
    },
  };
}

export function createParser(provider: AgentProvider): StreamParser {
  return provider === "claude" ? createClaudeParser() : createCodexParser();
}
