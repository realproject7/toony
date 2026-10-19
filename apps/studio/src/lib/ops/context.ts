// Building the context of a write from what a route or a tool knows.

import { basename } from "node:path";
import type { OpContext } from "./write.js";

/** Who asked for a write. Routes pass the tab id; agent tools pass the conversation. */
export interface ActorInfo {
  actor?: "agent" | "human";
  clientId?: string;
  conversationId?: string;
  /** The work id; defaults to the root folder's name. */
  workId?: string;
}

export function contextFor(root: string, info: ActorInfo = {}): OpContext {
  return {
    root,
    workId: info.workId ?? basename(root),
    actor: info.actor ?? "human",
    ...(info.clientId === undefined ? {} : { clientId: info.clientId }),
    ...(info.conversationId === undefined ? {} : { conversationId: info.conversationId }),
  };
}
