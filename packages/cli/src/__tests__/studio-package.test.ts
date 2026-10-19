// Exercise the shipped server outside the repository's dependency ancestry.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import { composeCut, type ExportManifest } from "@toony/export";
import { buildInitialProject, writeProject } from "@toony/project-io";

async function freePort(): Promise<number> {
  const socket = createServer();
  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const address = socket.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => socket.close((e) => (e ? reject(e) : resolve())));
  return address.port;
}

test("relocated Studio serves the workspace and exports identical native font pixels", async () => {
  const dir = await mkdtemp(join(tmpdir(), "toony-studio-package-"));
  let stop: (() => Promise<void>) | undefined;
  try {
    const shipped = fileURLToPath(new URL("../../studio/", import.meta.url));
    const relocated = join(dir, "installed");
    await cp(shipped, relocated, { recursive: true, mode: constants.COPYFILE_FICLONE });
    const workspace = join(dir, "workspace");
    await mkdir(workspace);
    const root = join(workspace, "package-fixture");
    const project = buildInitialProject("Package fixture");
    const bundle = project.episodes[0];
    const cut = bundle?.cuts[0];
    assert.ok(bundle && cut);
    cut.image = { clean: "episodes/ep-001/assets/clean/fixture.png", final: null };
    cut.panelAspect = 1.25;
    bundle.cuts = [cut];
    bundle.transitions = [];
    bundle.episode.sequence = [{ type: "cut", id: cut.id }];
    bundle.lettering = [
      {
        id: "package-text",
        cutId: cut.id,
        speaker: "Fixture speaker",
        kind: "speech",
        text: "Hello 안녕",
        fontFamily: "noto-sans-kr",
        fontSize: 80,
        fill: "#ffffff",
        opacity: 1,
        border: null,
        tail: null,
        geometry: { x: 0.1, y: 0.1, width: 0.8, height: 0.5 },
        overflow: false,
        reviewStatus: "draft",
      },
    ];
    await writeProject(root, project);
    const art = createCanvas(120, 150);
    const ctx = art.getContext("2d");
    ctx.fillStyle = "#86a9c1";
    ctx.fillRect(0, 0, 120, 150);
    const source = art.toBuffer("image/png");
    await writeFile(join(root, cut.image.clean as string), source);
    const expected = await composeCut(bundle.lettering, source, 320, {
      dialogueLanguage: project.webtoon.languages.dialogueLanguage,
      gutterBandWidth: project.webtoon.gutterBandWidth,
    });
    const cwd = join(dir, "unrelated");
    await mkdir(cwd);
    const port = await freePort();
    const child = spawn(process.execPath, [join(relocated, "apps/studio/server.js")], {
      cwd,
      detached: process.platform !== "win32",
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
        HOSTNAME: "127.0.0.1",
        PORT: String(port),
        TOONY_WORKSPACE_DIR: workspace,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let diagnostics = "";
    child.stdout.on("data", (chunk) => {
      diagnostics = (diagnostics + String(chunk)).slice(-8192);
    });
    child.stderr.on("data", (chunk) => {
      diagnostics = (diagnostics + String(chunk)).slice(-8192);
    });
    let fullyClosed = false;
    const closed = new Promise<void>((resolve) =>
      child.once("close", () => {
        fullyClosed = true;
        resolve();
      }),
    );
    const started = new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    const signal = (value: NodeJS.Signals) => {
      if (fullyClosed || !child.pid) return;
      try {
        if (process.platform === "win32") child.kill(value);
        else process.kill(-child.pid, value);
      } catch {
        // The server may have exited between observing and signalling it.
      }
    };
    stop = async () => {
      signal("SIGTERM");
      await Promise.race([closed, delay(2000)]);
      signal("SIGKILL");
      await closed;
    };
    await started;
    const origin = `http://127.0.0.1:${port}`;
    let home: Response | undefined;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && child.exitCode === null) {
      try {
        home = await fetch(origin, { signal: AbortSignal.timeout(3000) });
        break;
      } catch {
        await delay(100);
      }
    }
    assert.equal(home?.status, 200, diagnostics);
    assert.ok((await home.text()).includes('data-testid="work-package-fixture"'));
    const response = await fetch(`${origin}/api/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workId: "package-fixture",
        episodeId: "ep-001",
        target: "platform",
        width: 320,
        format: "png",
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const result = (await response.json()) as { ok: boolean; manifest: ExportManifest };
    assert.equal(response.status, 200, diagnostics);
    assert.equal(result.ok, true);
    assert.equal(result.manifest.files.length, 1);
    const file = result.manifest.files[0];
    assert.ok(file);
    assert.deepEqual(await readFile(join(root, file.path)), expected.canvas.toBuffer("image/png"));
  } finally {
    await stop?.();
    await rm(dir, { recursive: true, force: true });
  }
});
