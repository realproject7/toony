// The browser's guarded fetch: one session bootstrap, the Studio header and the
// tab id on every call, and one re-bootstrap after a server restart.

import assert from "node:assert/strict";
import { test } from "node:test";
import { CLIENT_HEADER, createStudioFetch } from "../studio-fetch.js";

test("guarded calls bootstrap once, carry the header and tab id, and recover a lost session", async () => {
  const calls: Array<{ url: string; headers: Headers }> = [];
  let sessionValid = false;
  const record = async (input: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: input, headers });
    if (input === "/api/session") {
      sessionValid = true;
      return new Response("{}", { status: 200 });
    }
    return new Response("{}", { status: sessionValid ? 200 : 401 });
  };
  const studio = createStudioFetch(record);
  const first = await studio("/api/lettering", { method: "POST", body: "{}" });
  assert.equal(first.status, 200);
  await studio("/api/transitions", { method: "POST", body: "{}" });
  assert.deepEqual(
    calls.map((c) => c.url),
    ["/api/session", "/api/lettering", "/api/transitions"],
  );
  for (const call of calls) assert.equal(call.headers.get("x-toony-agent"), "1");
  assert.equal(calls[1]?.headers.get(CLIENT_HEADER), studio.clientId);
  assert.equal(calls[1]?.headers.get("content-type"), "application/json");

  sessionValid = false;
  const recovered = await studio("/api/cuts", { method: "POST", body: "{}" });
  assert.equal(recovered.status, 200);
  assert.deepEqual(
    calls.slice(3).map((c) => c.url),
    ["/api/cuts", "/api/session", "/api/cuts"],
  );
});
