// The live event bus: one per Studio server process. Every project change, and
// the agent runtime's conversation events, are published here with a global,
// increasing `seq`; `GET /api/live` streams them to each browser tab. The last
// `LIVE_BUFFER_SIZE` events stay in a ring buffer so a tab that reconnects with
// `?since=<seq>` gets what it missed, or `resync` when that is no longer held.

import { randomUUID } from "node:crypto";
import type { ConnectionState, LiveEvent } from "../agent/protocol.js";

/** A live event before the bus numbers it. */
export type LiveEventInput = LiveEvent extends infer E
  ? E extends LiveEvent
    ? Omit<E, "seq">
    : never
  : never;

/** Events kept for reconnecting tabs. */
export const LIVE_BUFFER_SIZE = 2000;

export type LiveListener = (event: LiveEvent) => void;

export class LiveBus {
  /** Identifies this server process; a tab seeing a new id resyncs. */
  readonly serverId: string;
  private last = 0;
  private readonly buffer: LiveEvent[] = [];
  private readonly listeners = new Set<LiveListener>();
  /** What `hello` reports. The agent runtime replaces it with its own state. */
  connectionState: () => ConnectionState = () => ({ status: "disconnected" });

  constructor(
    private readonly capacity = LIVE_BUFFER_SIZE,
    serverId: string = randomUUID(),
  ) {
    this.serverId = serverId;
  }

  /** The seq of the newest published event (0 before the first). */
  get seq(): number {
    return this.last;
  }

  /** Number, buffer and deliver an event. A failing listener never blocks the others. */
  publish(input: LiveEventInput): LiveEvent {
    this.last += 1;
    const event = { ...input, seq: this.last } as LiveEvent;
    this.buffer.push(event);
    if (this.buffer.length > this.capacity)
      this.buffer.splice(0, this.buffer.length - this.capacity);
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // A broken stream must not stop delivery to the other tabs.
      }
    }
    return event;
  }

  /**
   * The events after `since`, or `resync` when some of them are no longer
   * buffered or `since` belongs to another server process.
   */
  replay(since: number): { events: LiveEvent[] } | { resync: true } {
    if (!Number.isSafeInteger(since) || since < 0 || since > this.last) return { resync: true };
    if (since === this.last) return { events: [] };
    const oldest = this.buffer[0]?.seq ?? this.last + 1;
    if (since < oldest - 1) return { resync: true };
    return { events: this.buffer.filter((event) => event.seq > since) };
  }

  subscribe(listener: LiveListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Number of open subscriptions, for tests and diagnostics. */
  get subscriberCount(): number {
    return this.listeners.size;
  }
}

const liveGlobal = globalThis as typeof globalThis & { toonyLiveBus?: LiveBus };

/** The process-wide bus. Survives development module reloads. */
export function liveBus(): LiveBus {
  liveGlobal.toonyLiveBus ??= new LiveBus();
  return liveGlobal.toonyLiveBus;
}
