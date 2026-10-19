import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ingestImageAsset } from "@toony/project-io";
import { pngWithText } from "../__fixtures__/comfyui-server.js";
import { run } from "../index.js";

test("CLI revision queue creates, reads and stages a candidate without replacing the cut", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "toony-revision-cli-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const out: string[] = [],
    err: string[] = [];
  const io = { cwd: dir, out: (s: string) => out.push(s), err: (s: string) => err.push(s) };
  assert.equal(await run(["init", "work"], io), 0);
  const root = join(dir, "work"),
    bytes = pngWithText();
  await ingestImageAsset(
    root,
    { kind: "cut", episodeId: "ep-001", cutId: "cut-001", slot: "clean" },
    {
      bytes,
      format: "png",
      provenance: { source: "manual", providerId: "manual", contentType: "image/png" },
    },
  );
  const cuts = join(root, "episodes/ep-001/cuts.yaml"),
    before = await readFile(cuts);
  out.length = 0;
  assert.equal(
    await run(
      [
        "revision",
        "create",
        "work",
        "--episode",
        "ep-001",
        "--cut",
        "cut-001",
        "--change",
        "Warmer smile",
        "--preserve",
        "Identity and pose",
        "--json",
      ],
      io,
    ),
    0,
    err.join("\n"),
  );
  const id = JSON.parse(out.join("\n")).id;
  out.length = 0;
  assert.equal(await run(["revision", "show", "work", "--id", id], io), 0);
  assert.match(out.join("\n"), /Source SHA-256/);
  await writeFile(join(dir, "candidate.png"), bytes);
  assert.equal(
    await run(
      [
        "revision",
        "stage",
        "work",
        "--id",
        id,
        "--file",
        "candidate.png",
        "--note",
        "Fixture only",
      ],
      io,
    ),
    0,
    err.join("\n"),
  );
  assert.deepEqual(await readFile(cuts), before);
});
