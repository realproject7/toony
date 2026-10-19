// The one agent runtime of this Studio server process, bound to the workspace.
// Kept on globalThis: Next bundles `/api/agent` and `/api/agent/tools`
// separately, and both must reach the same runtime, turns and tokens.

import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { ensureWorkspaceRoot, listWorks, resolveWork, workspaceRoot } from "../workspace.js";
import { AgentRuntime } from "./runtime.js";

const state = globalThis as typeof globalThis & {
  toonyAgentRuntime?: { root: string; runtime: Promise<AgentRuntime> };
};

export function agentRuntime(): Promise<AgentRuntime> {
  const root = workspaceRoot();
  if (state.toonyAgentRuntime?.root !== root) {
    const runtime = (async () => {
      await ensureWorkspaceRoot();
      const workspace = await realpath(root);
      const created = new AgentRuntime({
        workspace,
        resolveWork: async (workId) => {
          const work = await resolveWork(workId);
          return work ? { id: work.id, root: join(workspace, work.id) } : null;
        },
        listWorks: async () =>
          (await listWorks()).map((work) => ({
            id: work.id,
            title: work.title,
            episodeCount: work.episodeCount,
          })),
      });
      await created.init();
      return created;
    })();
    state.toonyAgentRuntime = { root, runtime };
    runtime.catch(() => {
      if (state.toonyAgentRuntime?.runtime === runtime) delete state.toonyAgentRuntime;
    });
  }
  return state.toonyAgentRuntime.runtime;
}

/** The port a request reached Studio on, for the MCP bridge to call back. */
export function requestPort(request: Request): number | null {
  const host = request.headers.get("host") ?? "";
  const match = /:(\d{1,5})$/.exec(host);
  if (match) return Number(match[1]);
  try {
    const url = new URL(request.url);
    return url.port ? Number(url.port) : null;
  } catch {
    return null;
  }
}
