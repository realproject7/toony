// A minimal ComfyUI-compatible server for tests, shared by the generate tests
// and the controller tests (#313). It is a test fixture, not a runtime stub: it
// answers /prompt, /history and /view exactly as ComfyUI's documented API does,
// so a command exercises the real provider and ingest path against it.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}
export function pngChunk(type: string, data: number[]): number[] {
  return [...u32be(data.length), ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
}
export function pngWithText(): Uint8Array {
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...pngChunk("IHDR", [...u32be(1), ...u32be(1), 8, 2, 0, 0, 0]),
    ...pngChunk("tEXt", [...[..."owner serial 99"].map((c) => c.charCodeAt(0))]),
    ...pngChunk("IDAT", [0x08, 0x1d, 0x01]),
    ...pngChunk("IEND", []),
  ]);
}

export const PROMPT_ID = "abcd-1234";

// A minimal ComfyUI-compatible server.
//
// `prompts()` reports every positive prompt Toony injected into the graph, in
// submission order, so prompt composition is asserted on what left the process
// rather than on the command's own report of it. A run now submits once per cut
// (#204), so the list is per cut. `rejectCall` is the 1-based index of the
// /prompt submission it refuses, which is how a mid-run failure is reproduced:
// the real one fails per request, not per process.
//
// `latents()` reports the EmptyLatentImage size of every submission for the same
// reason: a declared panel shape (#237) is only wired up if the size it implies
// is what actually left the process, and the command's own report of it would
// not show a shape that was dropped between the plan and the request.
//
// `bodies()` reports every POST /prompt body VERBATIM, as the bytes arrived, for
// the back-compat criterion of #261: the only way to show a valid project still
// generates exactly as it did is to compare the request that left the process,
// not to read the diff.
// `onView` runs when the generated image is served, which is INSIDE `produce`
// and therefore before ingest and before the write-back. It is how a test
// reaches the window between them — the one where a render has succeeded and
// the project changes under it.
export async function startFakeComfy(
  image: Uint8Array,
  rejectCall?: number,
  onView?: () => void | Promise<void>,
): Promise<{
  url: string;
  close: () => void;
  prompts: () => string[];
  latents: () => { width: unknown; height: unknown }[];
  bodies: () => string[];
  calls: () => number;
  /** Every raw multipart body posted to /upload/image, in order (#327). */
  uploads: () => Buffer[];
  /** The `image` input of node 10 in every submission, when the graph has one. */
  references: () => unknown[];
}> {
  const prompts: string[] = [];
  const latents: { width: unknown; height: unknown }[] = [];
  const bodies: string[] = [];
  const uploads: Buffer[] = [];
  const references: unknown[] = [];
  let calls = 0;
  const server: Server = createServer((req, res) => {
    const url = req.url ?? "";
    if (req.method === "POST" && url === "/prompt") {
      calls++;
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        bodies.push(raw);
        const body = JSON.parse(raw) as {
          prompt?: Record<string, { inputs?: Record<string, unknown> }>;
        };
        const text = body.prompt?.["6"]?.inputs?.text;
        if (typeof text === "string") prompts.push(text);
        const latent = body.prompt?.["5"]?.inputs ?? {};
        latents.push({ width: latent.width, height: latent.height });
        references.push(body.prompt?.["10"]?.inputs?.image);
        res.setHeader("content-type", "application/json");
        res.end(
          calls === rejectCall
            ? JSON.stringify({ error: { message: "out of memory" } })
            : JSON.stringify({ prompt_id: PROMPT_ID, node_errors: {} }),
        );
      });
      return;
    }
    if (req.method === "POST" && url === "/upload/image") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        uploads.push(Buffer.concat(chunks));
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({ name: `ref-${uploads.length}.png`, subfolder: "", type: "input" }),
        );
      });
      return;
    }
    if (req.method === "GET" && url.startsWith(`/history/`)) {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          [PROMPT_ID]: {
            outputs: { "9": { images: [{ filename: "out.png", subfolder: "", type: "output" }] } },
            status: { status_str: "success", completed: true },
          },
        }),
      );
      return;
    }
    if (req.method === "GET" && url.startsWith("/view")) {
      void Promise.resolve(onView?.()).then(() => {
        res.setHeader("content-type", "image/png");
        res.end(Buffer.from(image));
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => server.close(),
    prompts: () => [...prompts],
    latents: () => [...latents],
    bodies: () => [...bodies],
    calls: () => calls,
    uploads: () => [...uploads],
    references: () => [...references],
  };
}
