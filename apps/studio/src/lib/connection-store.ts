// The agent connection state as the live feed last reported it, kept in one
// place for the human workspace (the library welcome and Settings read it).
// The rail subscribes to the feed's `hello` and `connection` events and writes
// here. No React or Node imports, so the Node tests run it.

import type { ConnectionState } from "./agent/protocol.js";

type Listener = () => void;

let current: ConnectionState | null = null;
const listeners = new Set<Listener>();

/** The last known state, or null before the feed said anything. */
export function getConnectionState(): ConnectionState | null {
  return current;
}

export function setConnectionState(next: ConnectionState): void {
  if (current !== null && JSON.stringify(current) === JSON.stringify(next)) return;
  current = next;
  for (const listener of listeners) listener();
}

export function subscribeConnectionState(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A short status line for people. */
export function connectionLabel(state: ConnectionState | null): string {
  if (state === null) return "Checking…";
  if (state.status === "connected") {
    return `${state.preferences.provider === "claude" ? "Claude" : "Codex"} is connected`;
  }
  if (state.status === "needs-attention") return state.message;
  return "Not connected";
}
