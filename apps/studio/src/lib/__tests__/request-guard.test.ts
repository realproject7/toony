// The shared Studio request guard: every write route and the live feed refuse
// requests that do not come from the local Studio page.

import assert from "node:assert/strict";
import { test } from "node:test";
import { handleWrite } from "../api-route.js";
import {
  assertLocalRead,
  assertLocalRequest,
  assertSession,
  GuardError,
  legacySessionCookieClear,
  readBodyBytes,
  sessionCookie,
  sessionHeaders,
} from "../request-guard.js";

const ORIGIN = "http://127.0.0.1:4502";

function write(headers: Record<string, string> = {}, url = `${ORIGIN}/api/lettering`, body = "{}") {
  return new Request(url, {
    method: "POST",
    headers: {
      host: "127.0.0.1:4502",
      origin: ORIGIN,
      "content-type": "application/json",
      "x-toony-agent": "1",
      "sec-fetch-site": "same-origin",
      cookie: sessionCookie().split(";")[0] ?? "",
      ...headers,
    },
    body,
  });
}

function read(headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/live`, {
    headers: {
      host: "127.0.0.1:4502",
      "x-toony-agent": "1",
      "sec-fetch-site": "same-origin",
      cookie: sessionCookie().split(";")[0] ?? "",
      ...headers,
    },
  });
}

test("a write needs the local origin, the Studio header, the body type and same-origin metadata", () => {
  assert.doesNotThrow(() => assertLocalRequest(write()));
  assert.doesNotThrow(() =>
    assertLocalRequest(write({ host: "localhost:4502", origin: "http://localhost:4502" })),
  );
  const refused: Array<[Record<string, string>, GuardError["code"]]> = [
    [{ origin: "https://example.com" }, "origin"],
    [{ origin: "null" }, "origin"],
    [{ origin: "http://127.0.0.1:9999" }, "origin"],
    [{ "x-toony-agent": "" }, "origin"],
    [{ "sec-fetch-site": "cross-site" }, "origin"],
    [{ "content-type": "text/plain" }, "type"],
  ];
  for (const [headers, code] of refused) {
    assert.throws(
      () => assertLocalRequest(write(headers)),
      (error: unknown) => error instanceof GuardError && error.code === code,
      JSON.stringify(headers),
    );
  }
  assert.throws(() =>
    assertLocalRequest(
      write(
        { host: "example.com", origin: "http://example.com" },
        "http://example.com/api/lettering",
      ),
    ),
  );
  assert.throws(() => assertLocalRequest(write({}, ORIGIN), "image"), /PNG, JPEG, WebP or GIF/);
  assert.doesNotThrow(() => assertLocalRequest(write({ "content-type": "image/png" }), "image"));
});

test("a guarded read needs the header and loopback host but not an Origin", () => {
  assert.doesNotThrow(() => assertLocalRead(read()));
  assert.doesNotThrow(() => assertLocalRead(read({ origin: ORIGIN })));
  assert.throws(() => assertLocalRead(read({ "x-toony-agent": "0" })));
  assert.throws(() => assertLocalRead(read({ "sec-fetch-site": "cross-site" })));
  assert.throws(() => assertLocalRead(read({ origin: "https://example.com" })));
  assert.throws(() => assertLocalRead(read({ host: "attacker.test" })));
});

test("the session cookie covers every API path and a stale older cookie does not block it", () => {
  assert.match(sessionCookie(), /; Path=\/api; HttpOnly; SameSite=Strict$/);
  assert.match(legacySessionCookieClear(), /Path=\/api\/agent; Max-Age=0/);
  assert.equal(sessionHeaders().getSetCookie().length, 2);
  const valid = sessionCookie().split(";")[0] ?? "";
  assert.doesNotThrow(() => assertSession(write()));
  assert.doesNotThrow(() =>
    assertSession(write({ cookie: `toony_agent_session=${"a".repeat(64)}; ${valid}` })),
  );
  assert.throws(
    () => assertSession(write({ cookie: `toony_agent_session=${"0".repeat(64)}` })),
    (error: unknown) => error instanceof GuardError && error.status === 401,
  );
  assert.throws(() => assertSession(write({ cookie: "" })));
});

test("bodies are bounded even without a content-length header", async () => {
  await assert.rejects(
    readBodyBytes(new Request(`${ORIGIN}/x`, { method: "POST", body: "a".repeat(2048) }), 1024),
    (error: unknown) => error instanceof GuardError && error.status === 413,
  );
  assert.equal(
    (await readBodyBytes(new Request(`${ORIGIN}/x`, { method: "POST", body: "abc" }), 1024)).length,
    3,
  );
});

test("a refused write never reaches the route's change", async () => {
  let ran = 0;
  const run = async () => {
    ran++;
    return Response.json({ ok: true });
  };
  const crossSite = await handleWrite(write({ origin: "https://example.com" }), run);
  assert.equal(crossSite.status, 403);
  const plain = await handleWrite(write({ "content-type": "text/plain" }), run);
  assert.equal(plain.status, 415);
  const noSession = await handleWrite(write({ cookie: "" }), run);
  assert.equal(noSession.status, 401);
  assert.equal(ran, 0);
  const accepted = await handleWrite(write({}, `${ORIGIN}/api/lettering`, '{"a":1}'), run);
  assert.equal(accepted.status, 200);
  assert.equal(ran, 1);
});
