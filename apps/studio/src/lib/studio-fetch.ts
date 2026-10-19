// Browser side of the Studio request guard. Every component that changes
// project data calls `studioFetch` instead of `fetch`: it makes sure this tab
// holds the session cookie (bootstrapping once through `POST /api/session`),
// sends `x-toony-agent: 1` and this tab's id, and retries once after a server
// restart replaced the session. No Node or React imports, so tests run it too.

import { AGENT_HEADER } from "./agent/protocol.js";

/** Header naming the tab that made a change, so its own live events can be told apart. */
export const CLIENT_HEADER = "x-toony-client";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface StudioFetch {
  (input: string, init?: RequestInit): Promise<Response>;
  /** Resolve once this tab holds a session cookie. */
  ensureSession: () => Promise<void>;
  /** This tab's id, sent with every guarded call. */
  readonly clientId: string;
}

function newClientId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  if (random) return random;
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Build a guarded fetch over `fetchImpl` (the page's `fetch` by default). */
export function createStudioFetch(fetchImpl?: FetchLike): StudioFetch {
  const clientId = newClientId();
  const send: FetchLike = (input, init) => (fetchImpl ?? globalThis.fetch)(input, init);
  let session: Promise<void> | null = null;

  const ensureSession = (): Promise<void> => {
    session ??= send("/api/session", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", [AGENT_HEADER]: "1" },
      body: "{}",
    })
      .then((response) => {
        if (!response.ok) throw new Error("Open Toony from its local address to make changes.");
      })
      .catch((error: unknown) => {
        session = null;
        throw error;
      });
    return session;
  };

  const call = async (input: string, init: RequestInit = {}, retry = true): Promise<Response> => {
    await ensureSession();
    const headers = new Headers(init.headers);
    headers.set(AGENT_HEADER, "1");
    headers.set(CLIENT_HEADER, clientId);
    if (typeof init.body === "string" && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    const response = await send(input, { ...init, headers, credentials: "same-origin" });
    if (response.status === 401 && retry) {
      // The server restarted and issued a new session secret: bootstrap again.
      session = null;
      return call(input, init, false);
    }
    return response;
  };

  return Object.assign((input: string, init?: RequestInit) => call(input, init), {
    ensureSession,
    clientId,
  });
}

let shared: StudioFetch | null = null;

/** The tab's shared guarded fetch. */
export function studioFetch(input: string, init?: RequestInit): Promise<Response> {
  shared ??= createStudioFetch();
  return shared(input, init);
}

/** The tab's shared guarded fetch object, for the session and the tab id. */
export function studioClient(): StudioFetch {
  shared ??= createStudioFetch();
  return shared;
}
