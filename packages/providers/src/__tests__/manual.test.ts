import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { notAnImage, pngWithMetadata } from "../__fixtures__/containers.js";
import { ProviderError } from "../errors.js";
import { ManualImportProvider } from "../manual.js";

async function tempFile(name: string, bytes: Uint8Array): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "toony-manual-"));
  const path = join(dir, name);
  await writeFile(path, bytes);
  return path;
}

test("manual provider metadata", () => {
  const provider = new ManualImportProvider();
  assert.equal(provider.id, "manual");
  assert.equal(provider.kind, "manual");
  assert.equal(provider.transmitsRemotely, false);
});

test("produce requires a source path", async () => {
  const provider = new ManualImportProvider();
  await assert.rejects(() => provider.produce({}), ProviderError);
});

test("produce reads and classifies a local image", async () => {
  const provider = new ManualImportProvider();
  const path = await tempFile("art.png", pngWithMetadata());
  const result = await provider.produce({ sourcePath: path });
  assert.equal(result.format, "png");
  assert.deepEqual(result.provenance, {
    source: "manual",
    providerId: "manual",
    contentType: "image/png",
  });
  assert.deepEqual(result.bytes, pngWithMetadata());
});

test("produce rejects a non-image source", async () => {
  const provider = new ManualImportProvider();
  const path = await tempFile("notes.txt", notAnImage());
  await assert.rejects(() => provider.produce({ sourcePath: path }), ProviderError);
});

test("produce rejects a missing source without leaking the path", async () => {
  const provider = new ManualImportProvider();
  try {
    await provider.produce({ sourcePath: join(tmpdir(), "toony-does-not-exist-xyz.png") });
    assert.fail("expected a ProviderError");
  } catch (error) {
    assert.ok(error instanceof ProviderError);
    assert.ok(!error.message.includes("toony-does-not-exist-xyz"));
  }
});
