// `toony studio` launch details: arguments, the page it opens (a single
// project's page for a project path), the OS opener, and the stable port check.

import assert from "node:assert/strict";
import { createServer } from "node:net";
import { test } from "node:test";
import { isPortFree, openerCommand, parseStudioArgs, studioUrl } from "../commands/studio.js";

test("studio arguments: a path, a port, and --no-open", () => {
  assert.deepEqual(parseStudioArgs([]), { open: true });
  assert.deepEqual(parseStudioArgs(["my-webtoon", "--port", "4500", "--no-open"]), {
    path: "my-webtoon",
    port: 4500,
    open: false,
  });
  assert.deepEqual(parseStudioArgs(["--port", "0"]), { error: "invalid --port value: 0" });
  assert.deepEqual(parseStudioArgs(["--open-later"]), { error: "unknown option: --open-later" });
  assert.deepEqual(parseStudioArgs(["a", "b"]), { error: "unexpected argument: b" });
});

test("the opened page is the library, or the project's own page for a project path", () => {
  assert.equal(studioUrl(4477), "http://127.0.0.1:4477/");
  assert.equal(studioUrl(4477, "night shift"), "http://127.0.0.1:4477/w/night%20shift");
});

test("the browser opens through the platform's own opener, never a shell", () => {
  const url = "http://127.0.0.1:4477/w/demo";
  assert.deepEqual(openerCommand("darwin", url), ["open", [url]]);
  assert.deepEqual(openerCommand("linux", url), ["xdg-open", [url]]);
  assert.deepEqual(openerCommand("win32", url), ["rundll32", ["url.dll,FileProtocolHandler", url]]);
});

test("a port in use is not free, and is free again once released", async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  assert.equal(await isPortFree(address.port), false);
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  assert.equal(await isPortFree(address.port), true);
});
