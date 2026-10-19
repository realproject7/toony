import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { projectAgentContext } from "@/lib/agent/context";
import { nativeAnswer, probeAgent } from "@/lib/agent/native";
import {
  agentBody,
  agentResponse,
  assertAgentOrigin,
  assertAgentSession,
} from "@/lib/agent/security";
import { AgentStore } from "@/lib/agent/store";
import { AgentError, agentFocus, agentSettings } from "@/lib/agent/types";
import { resolveWork, workspaceRoot } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const state = globalThis as typeof globalThis & { toonyAgentStores?: Map<string, AgentStore> };
async function store(): Promise<AgentStore> {
  // A fresh install has no workspace folder until something creates it.
  await mkdir(workspaceRoot(), { recursive: true });
  const root = await realpath(workspaceRoot());
  state.toonyAgentStores ??= new Map();
  const stores = state.toonyAgentStores;
  let value = stores.get(root);
  if (!value) {
    value = new AgentStore(join(root, ".toony-agent"), nativeAnswer, async (workId, focus) => {
      const work = await resolveWork(workId);
      if (!work) throw new AgentError("work", "This project is unavailable.", 404);
      return projectAgentContext(work.root, focus);
    });
    stores.set(root, value);
  }
  await value.init();
  return value;
}
function string(value: unknown): string {
  if (typeof value !== "string") throw new AgentError("request", "The request is incomplete.");
  return value;
}
export async function POST(request: Request): Promise<Response> {
  try {
    assertAgentOrigin(request);
    const body = await agentBody(request);
    if (body.action === "bootstrap") return agentResponse({ ok: true }, 200, true);
    assertAgentSession(request);
    if (body.action === "providers") {
      return agentResponse({
        ok: true,
        providers: await Promise.all([probeAgent("claude"), probeAgent("codex")]),
      });
    }
    const agent = await store();
    const workId = body.workId === undefined || body.workId === null ? null : string(body.workId);
    if (workId !== null && !(await resolveWork(workId)))
      throw new AgentError("work", "This project is unavailable.", 404);
    switch (body.action) {
      case "state":
        return agentResponse({ ok: true, ...agent.view(workId) });
      case "verify": {
        if (body.trustNative !== true)
          throw new AgentError(
            "trust",
            "Confirm use of your installed agent before checking the connection.",
          );
        await agent.verify(agentSettings(body.settings));
        return agentResponse({ ok: true });
      }
      case "configure":
        await agent.configure(agentSettings(body.settings));
        break;
      case "disconnect":
        await agent.disconnect();
        break;
      case "new":
        return agentResponse({ ok: true, ...(await agent.newConversation(workId)) });
      case "open":
        return agentResponse({
          ok: true,
          ...(await agent.open(workId, string(body.conversationId))),
        });
      case "history":
        return agentResponse({ ok: true, history: agent.history(workId) });
      case "read":
        return agentResponse({
          ok: true,
          conversation: agent.read(workId, string(body.conversationId)),
        });
      case "delete":
        await agent.deleteConversation(workId, string(body.conversationId));
        break;
      case "cancel":
        agent.cancel(workId, string(body.conversationId));
        break;
      case "send":
        return agentResponse({
          ok: true,
          ...(await agent.send(
            workId,
            string(body.conversationId),
            string(body.message),
            string(body.requestId),
            agentFocus(body.focus),
          )),
        });
      default:
        throw new AgentError("request", "This agent action is unavailable.");
    }
    return agentResponse({ ok: true, ...agent.view(workId) });
  } catch (error) {
    return error instanceof AgentError
      ? agentResponse({ ok: false, code: error.code, error: error.message }, error.status)
      : agentResponse(
          {
            ok: false,
            code: "unavailable",
            error: "The local agent service is unavailable. Check your workspace and try again.",
          },
          500,
        );
  }
}
