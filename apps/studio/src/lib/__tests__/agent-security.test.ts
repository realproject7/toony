import assert from "node:assert/strict";
import { test } from "node:test";
import {
  agentBody,
  agentCookie,
  agentResponse,
  assertAgentOrigin,
  assertAgentSession,
} from "../agent/security.js";
import { agentFocus, agentPreferences } from "../agent/types.js";

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
test("agent preferences cannot smuggle environment, options or invalid focus paths", () => {
  assert.deepEqual(
    agentPreferences({
      provider: "codex",
      model: "",
      retainHistory: false,
      env: { TOKEN: "test-only" },
    }),
    { provider: "codex", model: "", autoApply: true, viewArtwork: true, retainHistory: false },
  );
  for (const model of ["--shell x", "-p", "--model=x", "a b", "x".repeat(101)]) {
    assert.throws(() => agentPreferences({ provider: "claude", model }), /model/);
  }
  assert.equal(agentPreferences({ provider: "claude", model: "opus[1m]" }).model, "opus[1m]");
  assert.throws(() => agentPreferences({ provider: "other" }));
  assert.throws(() => agentPreferences({ provider: "codex", autoApply: "yes" }));
  assert.throws(() => agentFocus({ route: "episode", episodeId: "../outside" }));
  assert.throws(() => agentFocus({ route: "episode", episodeId: "ep-001", bubbleIds: ["a/b"] }));
  // A cut without an episode is dropped, not refused, so a half-loaded page never blocks a message.
  assert.deepEqual(agentFocus({ route: "episode", cutId: "cut-001" }), { route: "episode" });
  assert.deepEqual(
    agentFocus({
      route: "episode",
      episodeId: "ep-001",
      cutId: "cut-001",
      bubbleIds: ["b1", "b1", "b2"],
      path: "untrusted",
    }),
    { route: "episode", episodeId: "ep-001", cutId: "cut-001", bubbleIds: ["b1", "b2"] },
  );
  assert.deepEqual(agentFocus({ route: "nowhere" }), { route: "library" });
});
