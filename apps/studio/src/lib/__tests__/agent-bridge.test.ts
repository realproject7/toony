// The Toony MCP bridge, run with node exactly as a CLI runs it, against a
// local HTTP server standing in for Studio's tools route; and the turn tokens
// the route checks.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BRIDGE_SOURCE, writeRunFiles } from "../agent/bridge.js";
import {
  bearerToken,
  issueTurnToken,
  liveTokenCount,
  resolveTurnToken,
  revokeTurnToken,
} from "../agent/tokens.js";
import { mcpTools, TOOL_CATALOG } from "../agent/tools/catalog.js";

async function bodyOf(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

test("the bridge answers MCP itself and forwards tool calls with the turn token only", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "toony-bridge-"));
  const seen: Array<{ auth: string | undefined; body: unknown; path: string | undefined }> = [];
  const server = createServer(async (request, response) => {
    const body = JSON.parse(await bodyOf(request));
    seen.push({ auth: request.headers.authorization, body, path: request.url });
    response.setHeader("content-type", "application/json");
    if (body.name === "broken") {
      response.statusCode = 500;
      response.end("{}");
      return;
    }
    response.end(
      JSON.stringify({
        content: [
          { type: "text", text: `ran ${body.name}` },
          { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  t.after(async () => {
    server.close();
    await rm(dir, { recursive: true, force: true });
  });
  const token = "a".repeat(64);
  const files = await writeRunFiles(join(dir, "run"), {
    url: `http://127.0.0.1:${port}`,
    token,
    tools: mcpTools(),
    rules: "Rules.",
  });
  assert.equal((await stat(join(dir, "run"))).mode & 0o777, 0o700);
  for (const file of [files.bridge, files.bridgeConfig, files.mcpConfig, files.rulesFile]) {
    assert.equal((await stat(file)).mode & 0o777, 0o600, file);
  }
  assert.equal(await readFile(files.bridge, "utf8"), BRIDGE_SOURCE);
  const mcp = JSON.parse(await readFile(files.mcpConfig, "utf8"));
  assert.deepEqual(mcp.mcpServers.toony.args, [files.bridge, files.bridgeConfig]);

  const child = spawn(process.execPath, [files.bridge, files.bridgeConfig], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => child.kill());
  let out = "";
  let err = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    out += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    err += chunk;
  });
  const replies = async (count: number) => {
    for (let i = 0; i < 200; i++) {
      const lines = out.split("\n").filter(Boolean);
      if (lines.length >= count) return lines.map((l) => JSON.parse(l));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`bridge answered ${out.split("\n").filter(Boolean).length} of ${count}`);
  };
  const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
  send({ jsonrpc: "2.0", id: 0, method: "server/discover", params: {} });
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  send({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "get_status", arguments: { a: 1 }, _meta: { session: "private-session-id" } },
  });
  send({ jsonrpc: "2.0", id: 4, method: "ping" });
  child.stdin.write("not json\n");
  send({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "broken", arguments: {} } });
  const answers = await replies(6);
  const byId = new Map(answers.map((a) => [a.id, a]));
  assert.equal(byId.get(0).error.code, -32601);
  assert.equal(byId.get(1).result.protocolVersion, "2025-11-25");
  assert.equal(byId.get(1).result.serverInfo.name, "toony");
  assert.deepEqual(
    byId.get(2).result.tools.map((tool: { name: string }) => tool.name),
    TOOL_CATALOG.map((tool) => tool.name),
  );
  assert.deepEqual(byId.get(3).result.content[0], { type: "text", text: "ran get_status" });
  assert.equal(byId.get(3).result.content[1].type, "image");
  assert.equal(byId.get(3).result.isError, false);
  assert.deepEqual(byId.get(4).result, {});
  assert.equal(byId.get(5).result.isError, true);
  assert.equal(seen.length, 2);
  assert.equal(seen[0]?.auth, `Bearer ${token}`);
  assert.equal(seen[0]?.path, "/api/agent/tools");
  assert.deepEqual(seen[0]?.body, { name: "get_status", arguments: { a: 1 } });
  assert.ok(!JSON.stringify(seen).includes("private-session-id"), "_meta is never forwarded");
  assert.equal(err, "", "the bridge never logs");
  child.stdin.end();
});

test("turn tokens are random, single turn, checked whole and revoked", () => {
  const before = liveTokenCount();
  const token = issueTurnToken({ conversationId: "c-1", turnId: "turn-1" });
  const other = issueTurnToken({ conversationId: "c-2", turnId: "turn-2" });
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.notEqual(token, other);
  assert.deepEqual(resolveTurnToken(token), { conversationId: "c-1", turnId: "turn-1" });
  assert.deepEqual(resolveTurnToken(other), { conversationId: "c-2", turnId: "turn-2" });
  const changed = `${token.slice(0, 63)}${token.endsWith("0") ? "1" : "0"}`;
  assert.equal(resolveTurnToken(changed), null);
  assert.equal(resolveTurnToken("short"), null);
  assert.equal(resolveTurnToken(null), null);
  assert.equal(bearerToken(`Bearer ${token}`), token);
  assert.equal(bearerToken(`bearer ${token}`), null);
  assert.equal(bearerToken(token), null);
  assert.equal(bearerToken(null), null);
  revokeTurnToken("turn-1");
  revokeTurnToken("turn-2");
  assert.equal(resolveTurnToken(token), null);
  assert.equal(liveTokenCount(), before);
});
