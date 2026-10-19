// Export jobs run in the background, one at a time, report progress counts and
// end with the files the export wrote. Views never carry absolute paths.

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildInitialProject, writeCuts, writeProject } from "@toony/project-io";
import type { ExportJobView } from "../agent/protocol.js";
import { savedExports } from "../export.js";
import { ExportJobError, getExportJob, startExportJob, waitForExportJob } from "../export-jobs.js";

async function work(t: { after: (fn: () => Promise<void>) => void }): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "toony-export-jobs-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "work");
  await writeProject(root, buildInitialProject("Jobs fixture"));
  return root;
}

test("a job runs in the background and ends with its files and progress", async (t) => {
  const root = await work(t);
  const updates: ExportJobView[] = [];
  const started = await startExportJob(
    {
      workId: "jobs",
      workRoot: root,
      episodeId: "ep-001",
      output: "cuts",
      options: { width: 300 },
    },
    (view) => updates.push(view),
  );
  assert.equal(started.state, "queued");
  assert.equal(started.output, "cuts");
  const done = await waitForExportJob(started.id);
  assert.ok(done);
  assert.equal(done.state, "completed", done.message);
  assert.equal(done.files?.length, 2);
  assert.deepEqual(
    done.files?.map((file) => [file.name, file.width, file.role, file.items]),
    [
      ["001.png", 300, "cut", ["cut-001"]],
      ["002.png", 300, "cut", ["cut-002"]],
    ],
  );
  const first = done.files?.[0];
  assert.ok(first?.sha256);
  assert.equal(
    first.href,
    `/api/export/download?work=jobs&episode=ep-001&output=cuts&file=001.png&rev=${first.sha256.slice(0, 16)}`,
  );
  assert.equal(done.zipHref, "/api/export/download?work=jobs&episode=ep-001&output=cuts&all=1");
  assert.equal(done.progress.done, done.progress.total);
  assert.ok(done.warnings?.some((warning) => warning.code === "artless-cuts"));
  // Progress was reported as it happened, never going backwards.
  assert.equal(updates[0]?.state, "running");
  assert.equal(updates.at(-1)?.state, "completed");
  const counts = updates.map((view) => view.progress.done);
  assert.deepEqual(
    counts,
    [...counts].sort((a, b) => a - b),
  );
  assert.ok(
    updates.some((view) => view.progress.done > 0 && view.progress.done < view.progress.total),
  );
  // Nothing in the view names a local folder.
  assert.ok(!JSON.stringify(done).includes(root));
  assert.deepEqual(getExportJob(started.id), done);
});

test("starting the same output again while it runs reuses the job", async (t) => {
  const root = await work(t);
  const params = { workId: "jobs", workRoot: root, episodeId: "ep-001", output: "strip" };
  const a = await startExportJob(params);
  const b = await startExportJob(params);
  assert.equal(b.id, a.id);
  const other = await startExportJob({ ...params, output: "x" });
  assert.notEqual(other.id, a.id);
  // Jobs run one at a time: the second waits for the first.
  assert.equal(other.state, "queued");
  assert.equal((await waitForExportJob(a.id))?.state, "completed");
  assert.equal((await waitForExportJob(other.id))?.state, "completed");
});

test("aliases resolve to their outputs, and an unknown output is refused up front", async (t) => {
  const root = await work(t);
  const job = await startExportJob({
    workId: "jobs",
    workRoot: root,
    episodeId: "ep-001",
    output: "stitched",
  });
  assert.equal(job.output, "strip");
  await waitForExportJob(job.id);
  await assert.rejects(
    () => startExportJob({ workId: "jobs", workRoot: root, episodeId: "ep-001", output: "gif" }),
    (error: unknown) => error instanceof ExportJobError && error.code === "unknown-output",
  );
});

test("a failed export ends in a failed state with a path-free message", async (t) => {
  const root = await work(t);
  // A project that does not validate cannot be exported.
  await writeFile(join(root, "episodes/ep-001/cuts.yaml"), "- id: cut-001\n  shotType: nowhere\n");
  const job = await startExportJob({
    workId: "jobs",
    workRoot: root,
    episodeId: "ep-001",
    output: "cuts",
  });
  const done = await waitForExportJob(job.id);
  assert.equal(done?.state, "failed");
  assert.equal(done?.code, "invalid-project");
  assert.match(done?.message ?? "", /validation/);
  assert.ok(!JSON.stringify(done).includes(root));
  const margin = await startExportJob({
    workId: "jobs",
    workRoot: await work(t),
    episodeId: "ep-001",
    output: "cuts",
    options: { width: 100, margin: 60 },
  });
  const refused = await waitForExportJob(margin.id);
  assert.equal(refused?.code, "cuts.margin-too-large");
  assert.equal(getExportJob("no-such-job"), null);
});

test("saved exports are listed with their files and go out of date when the episode changes", async (t) => {
  const root = await work(t);
  assert.deepEqual(await savedExports("jobs", root, "ep-001"), {});
  const job = await startExportJob({
    workId: "jobs",
    workRoot: root,
    episodeId: "ep-001",
    output: "x",
  });
  const done = await waitForExportJob(job.id);
  const saved = await savedExports("jobs", root, "ep-001");
  assert.deepEqual(Object.keys(saved), ["x"]);
  assert.equal(saved.x?.outOfDate, false);
  assert.deepEqual(saved.x?.files, done?.files);
  // A change that reaches the pixels (a cut's shape) makes the files out of date.
  const cuts = buildInitialProject("Jobs fixture").episodes[0]?.cuts ?? [];
  for (const cut of cuts) cut.panelAspect = 0.8;
  await writeCuts(root, "ep-001", cuts);
  assert.equal((await savedExports("jobs", root, "ep-001")).x?.outOfDate, true);
});
