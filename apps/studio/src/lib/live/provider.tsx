"use client";

// The browser end of the live feed. One `LiveProvider`, mounted in the root
// layout, keeps one `GET /api/live` stream open per tab, resumes it with
// `?since=` after a drop, and hands every event to the components that asked
// for it with `useLiveEvent`. Editors protect unsaved work with
// `useEditorScope`; pages refresh for project changes with `useProjectSync`
// (see `use-project-sync.ts`).

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AGENT_HEADER, type LiveEvent } from "../agent/protocol";
import { studioClient } from "../studio-fetch";
import { registerEditorScope } from "./editor-scopes";
import { createLineDecoder } from "./ndjson";

export type LiveStatus = "connecting" | "open" | "offline";

/** Which events a subscriber wants: one type, several, or a predicate. */
export type LiveFilter =
  | LiveEvent["type"]
  | readonly LiveEvent["type"][]
  | ((event: LiveEvent) => boolean);

interface Subscriber {
  filter: LiveFilter;
  callback: (event: LiveEvent) => void;
}

interface LiveContextValue {
  subscribe: (filter: LiveFilter, callback: (event: LiveEvent) => void) => () => void;
  status: LiveStatus;
  /** This tab's id; changes it made carry it as `change.clientId`. */
  clientId: string;
}

const LiveContext = createContext<LiveContextValue | null>(null);

function matches(filter: LiveFilter, event: LiveEvent): boolean {
  if (typeof filter === "function") return filter(event);
  if (typeof filter === "string") return event.type === filter;
  return filter.includes(event.type);
}

const RETRY_MS = [1000, 2000, 4000, 8000, 15000];

export function LiveProvider({ children }: { children: ReactNode }) {
  const subscribers = useRef(new Set<Subscriber>());
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const client = studioClient();

  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let lastSeq: number | null = null;
    let serverId: string | null = null;
    let controller: AbortController | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const dispatch = (event: LiveEvent): void => {
      for (const subscriber of [...subscribers.current]) {
        if (!matches(subscriber.filter, event)) continue;
        try {
          subscriber.callback(event);
        } catch {
          // One failing subscriber must not stop the feed for the others.
        }
      }
    };

    const connect = async (): Promise<void> => {
      if (stopped) return;
      controller = new AbortController();
      try {
        await client.ensureSession();
        const params = new URLSearchParams();
        if (lastSeq !== null) params.set("since", String(lastSeq));
        if (serverId !== null) params.set("server", serverId);
        const query = params.toString();
        const response = await fetch(`/api/live${query ? `?${query}` : ""}`, {
          headers: { [AGENT_HEADER]: "1" },
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.status === 401) {
          // A restarted server issued a new session; bootstrap again next time.
          await client.ensureSession().catch(() => {});
        }
        if (!response.ok || !response.body) throw new Error("live feed unavailable");
        const reader = response.body.getReader();
        const decoder = createLineDecoder((value) => {
          if (!value || typeof value !== "object") return;
          const event = value as LiveEvent;
          if (typeof event.seq !== "number" || typeof event.type !== "string") return;
          if (event.type === "hello") {
            serverId = event.serverId;
            attempt = 0;
            setStatus("open");
            if (lastSeq === null) lastSeq = event.seq;
          } else if (event.type === "resync" || event.type === "ping") {
            lastSeq = event.seq;
          } else {
            lastSeq = event.seq;
          }
          dispatch(event);
        });
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          decoder.push(value);
        }
        decoder.end();
      } catch {
        // Fall through to the reconnect below.
      }
      if (stopped) return;
      setStatus("offline");
      const delay = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)] ?? 15000;
      attempt += 1;
      retry = setTimeout(() => void connect(), delay);
    };

    void connect();
    return () => {
      stopped = true;
      if (retry !== undefined) clearTimeout(retry);
      controller?.abort();
    };
  }, [client]);

  const value = useMemo<LiveContextValue>(
    () => ({
      subscribe(filter, callback) {
        const subscriber = { filter, callback };
        subscribers.current.add(subscriber);
        return () => {
          subscribers.current.delete(subscriber);
        };
      },
      status,
      clientId: client.clientId,
    }),
    [status, client],
  );

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

function useLiveContext(): LiveContextValue {
  const context = useContext(LiveContext);
  if (context === null) throw new Error("useLiveEvent needs the LiveProvider in the root layout.");
  return context;
}

/**
 * Call `callback` for every live event that matches `filter`. The latest
 * callback is always used, so it may close over fresh props and state.
 */
export function useLiveEvent(filter: LiveFilter, callback: (event: LiveEvent) => void): void {
  const { subscribe } = useLiveContext();
  const latest = useRef(callback);
  latest.current = callback;
  const filterRef = useRef(filter);
  filterRef.current = filter;
  useEffect(
    () =>
      subscribe(
        (event) => matches(filterRef.current, event),
        (event) => latest.current(event),
      ),
    [subscribe],
  );
}

/** The live feed's connection status and this tab's id. */
export function useLiveStatus(): { status: LiveStatus; clientId: string } {
  const { status, clientId } = useLiveContext();
  return { status, clientId };
}

/**
 * Register an open editor's scope while it is mounted. `isDirty` is read when
 * a live change arrives, so pass a function that reads current state (a ref).
 */
export function useEditorScope(key: string | null, isDirty: () => boolean): void {
  const latest = useRef(isDirty);
  latest.current = isDirty;
  useEffect(() => {
    if (key === null) return;
    return registerEditorScope(key, () => latest.current());
  }, [key]);
}
