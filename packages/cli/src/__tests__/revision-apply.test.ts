// `toony revision` end to end from the command line: a request snapshots the
// cut's image, a candidate is staged from a file, and `apply` points the cut at
// the candidate (named by its sha256), as a draft, keeping lettering.

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { loadProject } from "@toony/project-io";
import { pngWithText } from "../__fixtures__/comfyui-server.js";
import { runImportImage } from "../commands/import-image.js";
import { runInit } from "../commands/init.js";
import { runRevision } from "../commands/revision.js";
import { EXIT_OK, EXIT_USAGE } from "../exit.js";

let workdir: string;
beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), "toony-revision-"));
});
afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { cwd: workdir, out: (l: string) => out.push(l), err: (l: string) => err.push(l) },
    out,
    err,
  };
}

test("create, stage and apply a revision from the command line", async () => {
  assert.equal(await runInit(["demo"], capture().io), EXIT_OK);
  const dir = join(workdir, "demo");
  const first = join(workdir, "first.png");
  await writeFile(first, pngWithText());
  const imported = capture();
  assert.equal(
    await runImportImage(
      [dir, "--episode", "ep-001", "--cut", "cut-001", "--from", first],
      imported.io,
    ),
    EXIT_OK,
    imported.err.join("\n"),
  );

  const created = capture();
  assert.equal(
    await runRevision(
      [
        "create",
        dir,
        "--episode",
        "ep-001",
        "--cut",
        "cut-001",
        "--change",
        "night instead of day",
        "--preserve",
        "the pose",
        "--json",
      ],
      created.io,
    ),
    EXIT_OK,
    created.err.join("\n"),
  );
  const { id } = JSON.parse(created.out[0] ?? "{}") as { id: string };

  const candidate = join(workdir, "candidate.png");
  const bytes = pngWithText();
  bytes[bytes.length - 20] = 7; // a different image than the source
  await writeFile(candidate, bytes);
  const staged = capture();
  assert.equal(
    await runRevision(
      ["stage", dir, "--id", id, "--file", candidate, "--note", "night", "--json"],
      staged.io,
    ),
    EXIT_OK,
    staged.err.join("\n"),
  );
  const stagedRequest = JSON.parse(staged.out[0] ?? "{}") as {
    candidate: { sha256: string; assetPath: string };
  };

  const wrong = capture();
  assert.equal(
    await runRevision(["apply", dir, "--id", id, "--candidate", "0".repeat(64)], wrong.io),
    EXIT_USAGE,
    "a candidate the caller did not name is refused",
  );

  const applied = capture();
  assert.equal(
    await runRevision(
      ["apply", dir, "--id", id, "--candidate", stagedRequest.candidate.sha256],
      applied.io,
    ),
    EXIT_OK,
    applied.err.join("\n"),
  );
  assert.match(applied.out.join("\n"), /Applied/);
  const cut = (await loadProject(dir)).project.episodes[0]?.cuts.find((c) => c.id === "cut-001");
  assert.equal(cut?.image?.clean, stagedRequest.candidate.assetPath);
  assert.equal(cut?.reviewStatus, "draft");
});
