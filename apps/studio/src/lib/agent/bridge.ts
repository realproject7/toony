// The Toony MCP bridge: a tiny stdio MCP server the agent CLI starts for one
// turn. Studio writes it (from the source below) into the turn's private run
// folder, with a config file holding the Studio URL, the turn's bearer token and
// the tool list. The bridge answers `initialize`, `ping` and `tools/list`
// itself and forwards `tools/call` (name and arguments only) to
// `POST /api/agent/tools`. It never logs, and it never forwards `params._meta`,
// which carries the CLI's own session metadata.

import { join } from "node:path";
import { MCP_SERVER, type RunFiles } from "./adapters.js";
import { privateDir, writePrivateFile, writePrivateJson } from "./storage.js";

export const BRIDGE_VERSION = "1.0.0";

/** Plain ESM, Node built-ins only. Kept as a string so Studio ships no extra file. */
export const BRIDGE_SOURCE = `// Toony MCP bridge (written by Toony Studio for one agent turn).
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
const endpoint = new URL("/api/agent/tools", config.url).toString();
let buffer = "";

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function fail(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function call(id, params) {
  const name = params && typeof params.name === "string" ? params.name : "";
  const args = params && params.arguments && typeof params.arguments === "object" ? params.arguments : {};
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + config.token },
      body: JSON.stringify({ name, arguments: args }),
      signal: AbortSignal.timeout(config.timeoutMs || 600000),
    });
    const body = await response.json().catch(() => null);
    if (body && Array.isArray(body.content)) {
      reply(id, { content: body.content, isError: body.isError === true });
    } else {
      reply(id, {
        content: [{ type: "text", text: "Toony could not run this tool right now." }],
        isError: true,
      });
    }
  } catch {
    reply(id, {
      content: [{ type: "text", text: "Toony did not answer. The turn may have stopped." }],
      isError: true,
    });
  }
}

function handle(message) {
  if (!message || typeof message !== "object" || typeof message.method !== "string") return;
  const id = message.id;
  const notification = id === undefined || id === null;
  switch (message.method) {
    case "initialize":
      if (notification) return;
      reply(id, {
        protocolVersion:
          message.params && typeof message.params.protocolVersion === "string"
            ? message.params.protocolVersion
            : "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: config.name, version: config.version },
      });
      return;
    case "ping":
      if (!notification) reply(id, {});
      return;
    case "tools/list":
      if (!notification) reply(id, { tools: config.tools });
      return;
    case "tools/call":
      if (!notification) void call(id, message.params);
      return;
    default:
      if (!notification) fail(id, -32601, "Method not found");
  }
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf("\\n");
  while (index !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    index = buffer.indexOf("\\n");
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    handle(message);
  }
});
process.stdin.on("end", () => process.exit(0));
`;

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface BridgeConfig {
  url: string;
  token: string;
  tools: McpToolDefinition[];
  name: string;
  version: string;
  timeoutMs: number;
}

/**
 * Write the bridge, its config, Claude's MCP config and the rules file into a
 * private run folder (0700; files 0600). Returns the paths a provider needs.
 */
export async function writeRunFiles(
  runDir: string,
  input: { url: string; token: string; tools: McpToolDefinition[]; rules: string; node?: string },
): Promise<RunFiles> {
  await privateDir(runDir);
  const node = input.node ?? process.execPath;
  const bridge = join(runDir, "toony-mcp.mjs");
  const bridgeConfig = join(runDir, "toony-mcp.json");
  const mcpConfig = join(runDir, "mcp.json");
  const rulesFile = join(runDir, "toony-rules.md");
  const config: BridgeConfig = {
    url: input.url,
    token: input.token,
    tools: input.tools,
    name: MCP_SERVER,
    version: BRIDGE_VERSION,
    timeoutMs: 600_000,
  };
  await writePrivateFile(bridge, BRIDGE_SOURCE);
  await writePrivateJson(bridgeConfig, config);
  await writePrivateJson(mcpConfig, {
    mcpServers: { [MCP_SERVER]: { type: "stdio", command: node, args: [bridge, bridgeConfig] } },
  });
  await writePrivateFile(rulesFile, input.rules);
  return { node, bridge, bridgeConfig, mcpConfig, rulesFile, rules: input.rules };
}
