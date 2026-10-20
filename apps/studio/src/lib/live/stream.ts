// The NDJSON body of `GET /api/live`: `hello`, then what the tab missed (or
// `resync`), then every new event as it is published, with a `ping` every 15
// seconds so idle connections stay open. Closing the request (tab closed,
// navigation, abort) unsubscribes and stops the heartbeat.

import type { LiveEvent } from "../agent/protocol.js";
import type { LiveBus } from "./bus.js";

export const LIVE_HEARTBEAT_MS = 15_000;
/** Events a slow reader may fall behind by before the stream is closed for a resync. */
const QUEUE_LIMIT = 1000;

export interface LiveStreamOptions {
  /** The last seq the tab saw, when it is resuming. */
  since: number | null;
  /** The server id the tab last saw; a different one forces `resync`. */
  serverId: string | null;
  signal?: AbortSignal;
  heartbeatMs?: number;
}

/** Parse `?since=` and `?server=` from the request URL. */
export function liveStreamParams(url: URL): { since: number | null; serverId: string | null } {
  const raw = url.searchParams.get("since");
  const since = raw !== null && /^\d{1,15}$/.test(raw) ? Number(raw) : null;
  const server = url.searchParams.get("server");
  return {
    since,
    serverId: server !== null && /^[A-Za-z0-9-]{1,64}$/.test(server) ? server : null,
  };
}

export function openLiveStream(
  bus: LiveBus,
  options: LiveStreamOptions,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let cleanup = (): void => {};
  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        let closed = false;
        const write = (event: LiveEvent): void => {
          if (closed) return;
          if (controller.desiredSize !== null && controller.desiredSize < -QUEUE_LIMIT) {
            // The reader stopped reading. Close; it resumes with `since` or resyncs.
            stop();
            return;
          }
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };
        let unsubscribe = (): void => {};
        let timer: ReturnType<typeof setInterval> | undefined;
        const stop = (): void => {
          if (closed) return;
          closed = true;
          unsubscribe();
          if (timer !== undefined) clearInterval(timer);
          options.signal?.removeEventListener("abort", stop);
          try {
            controller.close();
          } catch {
            // Already closed or cancelled by the reader.
          }
        };
        cleanup = stop;

        write({
          type: "hello",
          seq: bus.seq,
          serverId: bus.serverId,
          connection: bus.connectionState(),
        });
        if (options.since !== null) {
          const replay =
            options.serverId !== null && options.serverId !== bus.serverId
              ? ({ resync: true } as const)
              : bus.replay(options.since);
          if ("resync" in replay) write({ type: "resync", seq: bus.seq });
          else for (const event of replay.events) write(event);
        }
        // Subscribe in the same tick as the replay, so no event falls between them.
        unsubscribe = bus.subscribe(write);
        timer = setInterval(
          () => write({ type: "ping", seq: bus.seq }),
          options.heartbeatMs ?? LIVE_HEARTBEAT_MS,
        );
        if (options.signal?.aborted) stop();
        else options.signal?.addEventListener("abort", stop);
      },
      cancel() {
        cleanup();
      },
    },
    { highWaterMark: 64 },
  );
}
