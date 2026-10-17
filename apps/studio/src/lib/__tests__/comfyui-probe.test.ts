// Shared ComfyUI probe tests (#154 item 8), in the #157 node:test harness.
//
// Both `/api/config` and the settings page call `probeComfyui`, so testing the
// shared helper covers both paths. The SSRF protocol guard + the no-endpoint /
// bad-URL branches short-circuit BEFORE any `fetch`, so they're verifiable here
// with no network; the reachable/unreachable-via-fetch path needs a live server.

import assert from "node:assert/strict";
import { test } from "node:test";
import { probeComfyui } from "../comfyui-probe.js";

test("an unset endpoint is unconfigured", async () => {
  assert.deepEqual(await probeComfyui(null), { state: "unconfigured" });
});

test("a malformed endpoint is unreachable (no fetch)", async () => {
  assert.deepEqual(await probeComfyui("not a url"), { state: "unreachable" });
});

test("a non-http(s) endpoint is unreachable via the SSRF protocol guard (#154 item 8)", async () => {
  // The guard both call paths now share: file:/ftp:/etc. never trigger a fetch.
  for (const endpoint of ["file:///etc/passwd", "ftp://internal.host/x", "gopher://127.0.0.1/"]) {
    assert.deepEqual(
      await probeComfyui(endpoint),
      { state: "unreachable" },
      `expected ${endpoint} to be unreachable`,
    );
  }
});
