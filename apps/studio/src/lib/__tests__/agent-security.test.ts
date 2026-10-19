import assert from "node:assert/strict";
import { test } from "node:test";
import {
  agentBody,
  agentCookie,
  agentResponse,
  assertAgentOrigin,
  assertAgentSession,
} from "../agent/security.js";
import { agentFocus, agentSettings } from "../agent/types.js";

function request(headers: Record<string, string> = {}, url = "http://localhost:4400/api/agent") {
  return new Request(url, {
    method: "POST",
    headers: {
      host: "localhost:4400",
      origin: "http://localhost:4400",
      "content-type": "application/json",
      "x-toony-agent": "1",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: "{}",
  });
}
test("agent access requires the exact local origin and non-simple request", () => {
  assert.doesNotThrow(() => assertAgentOrigin(request()));
  assert.doesNotThrow(() =>
    assertAgentOrigin(request({ host: "127.0.0.1:4400", origin: "http://127.0.0.1:4400" })),
  );
  const invalid: Record<string, string>[] = [
    { origin: "https://example.com" },
    { host: "example.com" },
    { "x-toony-agent": "" },
    { "content-type": "text/plain" },
    { "sec-fetch-site": "cross-site" },
  ];
  for (const headers of invalid) assert.throws(() => assertAgentOrigin(request(headers)));
  assert.throws(() =>
    assertAgentOrigin(
      request(
        { host: "example.com", origin: "http://example.com" },
        "http://example.com/api/agent",
      ),
    ),
  );
  assert.throws(() =>
    assertAgentOrigin(
      request(
        { host: "localhost.attacker.test", origin: "http://localhost.attacker.test" },
        "http://localhost.attacker.test/api/agent",
      ),
    ),
  );
});
test("local agent cookie is HTTP-only, strict and checked independently of origin", () => {
  const cookie = agentCookie();
  assert.match(cookie, /HttpOnly; SameSite=Strict/);
  assert.doesNotThrow(() => assertAgentSession(request({ cookie: cookie.split(";")[0] ?? "" })));
  assert.throws(() => assertAgentSession(request()));
  assert.throws(() =>
    assertAgentSession(request({ cookie: `toony_agent_session=${"0".repeat(64)}` })),
  );
  assert.equal(agentResponse({ ok: true }).headers.get("cache-control"), "no-store");
});
test("request size is bounded even without a content-length header", async () => {
  await assert.rejects(
    agentBody(
      new Request("http://localhost/api/agent", {
        method: "POST",
        body: JSON.stringify({ text: "a".repeat(33000) }),
      }),
    ),
    /too long/,
  );
  await assert.rejects(
    agentBody(new Request("http://localhost/api/agent", { method: "POST", body: "[]" })),
    /incomplete/,
  );
  assert.deepEqual(await agentBody(request()), {});
});
test("connection settings cannot smuggle environment, commands or invalid scene paths", () => {
  assert.deepEqual(
    agentSettings({
      provider: "codex",
      model: "",
      projectContext: true,
      retainHistory: false,
      env: { TOKEN: "test-only" },
    }),
    { provider: "codex", model: "", projectContext: true, retainHistory: false },
  );
  assert.throws(() =>
    agentSettings({
      provider: "codex",
      model: "--shell x",
      projectContext: true,
      retainHistory: false,
    }),
  );
  assert.throws(() => agentFocus({ episodeId: "../outside" }));
  assert.throws(() => agentFocus({ cutId: "cut" }));
  assert.deepEqual(agentFocus({ episodeId: "ep-1", cutId: "cut-1", path: "untrusted" }), {
    episodeId: "ep-1",
    cutId: "cut-1",
  });
});
