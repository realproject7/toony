// The live feed: numbered events, replay after a reconnect, resync when the
// buffer no longer holds what a tab missed, the NDJSON stream with heartbeat
// and cleanup, and the browser's line decoder.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { LiveEvent, ProjectChange } from "../agent/protocol.js";
import { LiveBus } from "../live/bus.js";
import { createLineDecoder } from "../live/ndjson.js";
import { liveStreamParams, openLiveStream } from "../live/stream.js";

function change(n: number): ProjectChange {
  return {
    workId: "harbor",
    changeId: `c${n}`,
    actor: "human",
    summary: `Change ${n}`,
    scopes: [{ kind: "story" }],
    at: "2026-10-19T00:00:00.000Z",
  };
}

test("the bus numbers events, replays what a tab missed and resyncs when it cannot", () => {
  const bus = new LiveBus(3, "server-a");
  const seen: number[] = [];
  const stop = bus.subscribe((event) => seen.push(event.seq));
  for (let n = 1; n <= 5; n++) bus.publish({ type: "project", change: change(n) });
  stop();
  bus.publish({ type: "project", change: change(6) });
  assert.deepEqual(seen, [1, 2, 3, 4, 5]);
  assert.equal(bus.seq, 6);
  const replay = bus.replay(4);
  assert.ok("events" in replay);
  assert.deepEqual(
    replay.events.map((e) => e.seq),
    [5, 6],
  );
  assert.deepEqual(bus.replay(6), { events: [] });
  assert.deepEqual(bus.replay(2), { resync: true }, "events 3 is no longer buffered");
  const edge = bus.replay(3);
  assert.ok("events" in edge, "the oldest buffered event follows seq 3");
  assert.deepEqual(
    edge.events.map((e) => e.seq),
    [4, 5, 6],
  );
  assert.deepEqual(bus.replay(99), { resync: true }, "a seq from another server process");
  assert.equal(bus.subscriberCount, 0);
});

async function readLines(
  stream: ReadableStream<Uint8Array>,
  count: number,
): Promise<{ events: LiveEvent[]; reader: ReadableStreamDefaultReader<Uint8Array> }> {
  const reader = stream.getReader();
  const events: LiveEvent[] = [];
  const decoder = createLineDecoder((value) => events.push(value as LiveEvent));
  while (events.length < count) {
    const { done, value } = await reader.read();
    if (done) break;
    decoder.push(value);
  }
  return { events, reader };
}

test("the stream sends hello, the missed events, then live events and pings, and cleans up on abort", async () => {
  const bus = new LiveBus(10, "server-a");
  bus.publish({ type: "project", change: change(1) });
  bus.publish({ type: "project", change: change(2) });
  const abort = new AbortController();
  const stream = openLiveStream(bus, {
    since: 1,
    serverId: "server-a",
    signal: abort.signal,
    heartbeatMs: 20,
  });
  const first = await readLines(stream, 2);
  assert.deepEqual(
    first.events.map((e) => [e.type, e.seq]),
    [
      ["hello", 2],
      ["project", 2],
    ],
  );
  bus.publish({ type: "project", change: change(3) });
  const decoder: LiveEvent[] = [];
  const lines = createLineDecoder((value) => decoder.push(value as LiveEvent));
  while (!decoder.some((e) => e.type === "ping") || !decoder.some((e) => e.seq === 3)) {
    const { value, done } = await first.reader.read();
    if (done) break;
    lines.push(value);
  }
  assert.ok(decoder.some((e) => e.type === "project" && e.seq === 3));
  assert.ok(decoder.some((e) => e.type === "ping"));
  assert.equal(bus.subscriberCount, 1);
  abort.abort();
  assert.equal(bus.subscriberCount, 0, "aborting the request unsubscribes");
  let closed = false;
  for (let i = 0; i < 100 && !closed; i++) closed = (await first.reader.read()).done;
  assert.equal(closed, true, "the stream ends after the abort");
});

test("a tab from another server process, or one too far behind, gets resync", async () => {
  const bus = new LiveBus(2, "server-b");
  for (let n = 1; n <= 4; n++) bus.publish({ type: "project", change: change(n) });
  for (const options of [
    { since: 3, serverId: "server-a" },
    { since: 0, serverId: "server-b" },
  ]) {
    const abort = new AbortController();
    const { events, reader } = await readLines(
      openLiveStream(bus, { ...options, signal: abort.signal }),
      2,
    );
    assert.deepEqual(
      events.map((e) => e.type),
      ["hello", "resync"],
    );
    abort.abort();
    await reader.cancel();
  }
  assert.equal(bus.subscriberCount, 0);
  assert.deepEqual(liveStreamParams(new URL("http://x/api/live?since=12&server=server-b")), {
    since: 12,
    serverId: "server-b",
  });
  assert.deepEqual(liveStreamParams(new URL("http://x/api/live?since=-1&server=../x")), {
    since: null,
    serverId: null,
  });
});

test("the line decoder joins split chunks and multi-byte characters", () => {
  const values: unknown[] = [];
  const decoder = createLineDecoder((value) => values.push(value));
  const bytes = new TextEncoder().encode('{"a":"안녕"}\n{"b":2}\nnot json\n{"c":3}');
  decoder.push(bytes.slice(0, 7));
  decoder.push(bytes.slice(7, 20));
  decoder.push(bytes.slice(20));
  decoder.end();
  assert.deepEqual(values, [{ a: "안녕" }, { b: 2 }, { c: 3 }]);
});
