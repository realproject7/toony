// Path-traversal guard tests for the studio's asset resolution (#157).
//
// `resolveWorkAsset` is the single gate the `/api/asset` route relies on to keep
// byte-streaming inside one work directory: it must reject anything that would
// escape the work root. `assetUrl` builds the asset URL only for inputs that
// clear that gate. These are pure-function tests, so they run under the repo's
// standard `node:test` + `scripts/run-tests.mjs` harness with no DOM or Next.

import assert from "node:assert/strict";
import { join, resolve, sep } from "node:path";
import { test } from "node:test";
import { assetUrl, resolveWorkAsset } from "../project.js";

// An absolute work root, as `@/lib/workspace` resolves upstream before any of
// these helpers run.
const ROOT = resolve(sep, "workspace", "works", "lantern-tide");

test("resolveWorkAsset resolves a project-relative path inside the work root", () => {
  assert.equal(
    resolveWorkAsset(ROOT, "assets/clean/cut-001.webp"),
    join(ROOT, "assets/clean/cut-001.webp"),
  );
  assert.equal(resolveWorkAsset(ROOT, "cover.png"), join(ROOT, "cover.png"));
});

test("resolveWorkAsset allows a `..` that stays within the work root", () => {
  // Normalizes back inside the root, so it is safe and must resolve.
  assert.equal(resolveWorkAsset(ROOT, "assets/../cover.png"), join(ROOT, "cover.png"));
});

test("resolveWorkAsset rejects `..` traversal that escapes the work root", () => {
  assert.equal(resolveWorkAsset(ROOT, "../secret.png"), null);
  assert.equal(resolveWorkAsset(ROOT, "../../etc/passwd"), null);
  assert.equal(resolveWorkAsset(ROOT, "assets/../../secret.png"), null);
});

test("resolveWorkAsset rejects a prefix sibling that is not truly inside the root", () => {
  // `<root>-evil` shares the root string as a prefix but is a sibling directory;
  // the `root + sep` check must not be fooled by the shared prefix.
  assert.equal(resolveWorkAsset(ROOT, "../lantern-tide-evil/secret.png"), null);
});

test("resolveWorkAsset rejects absolute paths", () => {
  assert.equal(resolveWorkAsset(ROOT, resolve(sep, "etc", "passwd")), null);
});

test("resolveWorkAsset rejects empty, NUL-byte, and non-string inputs", () => {
  assert.equal(resolveWorkAsset(ROOT, ""), null);
  assert.equal(resolveWorkAsset(ROOT, "assets/\0cut.webp"), null);
  // Defensive: the guard checks `typeof relPath` even though the type says string.
  assert.equal(resolveWorkAsset(ROOT, undefined as unknown as string), null);
});

test("resolveWorkAsset treats percent-encoded `..` as an inert literal, not traversal", () => {
  // The guard operates on the RAW path and never decodes, so `%2e%2e` is a
  // literal segment that stays inside the root rather than escaping it.
  const resolved = resolveWorkAsset(ROOT, "%2e%2e/%2e%2e/secret.png");
  assert.notEqual(resolved, null);
  assert.ok(resolved?.startsWith(ROOT + sep));
});

test("assetUrl returns null for missing paths without building a URL", () => {
  assert.equal(assetUrl("lantern-tide", ROOT, null), null);
  assert.equal(assetUrl("lantern-tide", ROOT, undefined), null);
  assert.equal(assetUrl("lantern-tide", ROOT, ""), null);
});

test("assetUrl returns null for a path that fails the traversal guard", () => {
  assert.equal(assetUrl("lantern-tide", ROOT, "../secret.png"), null);
  assert.equal(assetUrl("lantern-tide", ROOT, resolve(sep, "etc", "passwd")), null);
});

test("assetUrl builds a URL-encoded asset URL for a safe path", () => {
  assert.equal(
    assetUrl("lantern-tide", ROOT, "assets/clean/cut-001.webp"),
    "/api/asset?work=lantern-tide&path=assets%2Fclean%2Fcut-001.webp",
  );
});

test("assetUrl encodes the work id and path so query params cannot be injected", () => {
  const url = assetUrl("work id&x=1", ROOT, "a b/c&d.png");
  assert.equal(url, "/api/asset?work=work%20id%26x%3D1&path=a%20b%2Fc%26d.png");
});
