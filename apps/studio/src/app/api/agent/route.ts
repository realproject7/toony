// The agent panel's actions (`AgentAction` in lib/agent/protocol.ts). Every
// action is guarded like any Studio write: a loopback host, an Origin equal to
// it, `x-toony-agent: 1`, a JSON body and the session cookie (bootstrap issues
// it). Success bodies are `AgentResponses[action]`; failures are
// `{ ok: false, code, error }` (plus `providers` when the CLI is not ready).
// State changes reach every tab as live events on `GET /api/live`.

import {
  agentBody,
  agentResponse,
  assertAgentOrigin,
  assertAgentSession,
} from "@/lib/agent/security";
import { agentRuntime, requestPort } from "@/lib/agent/server";
import { AgentError, agentFocus, agentPreferences, isAgentError } from "@/lib/agent/types";
import { resolveWork } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function string(value: unknown, what = "request"): string {
  if (typeof value !== "string" || value === "") {
    throw new AgentError("request", `The ${what} is incomplete.`);
  }
  return value;
}

async function workIdOf(value: unknown): Promise<string | null> {
  if (value === undefined || value === null) return null;
  const workId = string(value);
  if (!(await resolveWork(workId))) {
    throw new AgentError("work", "This webtoon is not in the workspace.", 404);
  }
  return workId;
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertAgentOrigin(request);
    const body = await agentBody(request);
    const agent = await agentRuntime();
    agent.setPort(requestPort(request));
    if (body.action === "bootstrap") {
      return agentResponse({ ok: true, connection: agent.connectionState() }, 200, true);
    }
    assertAgentSession(request);
    switch (body.action) {
      case "providers":
        return agentResponse({ ok: true, providers: await agent.providers(body.refresh === true) });
      case "connect":
        return agentResponse({
          ok: true,
          ...(await agent.connect(agentPreferences(body.preferences))),
        });
      case "preferences":
        return agentResponse({
          ok: true,
          connection: await agent.setPreferences(agentPreferences(body.preferences)),
        });
      case "disconnect":
        return agentResponse({ ok: true, connection: await agent.disconnect() });
      case "open": {
        const workId = await workIdOf(body.workId);
        const conversationId =
          body.conversationId === undefined || body.conversationId === null
            ? undefined
            : string(body.conversationId);
        return agentResponse({ ok: true, view: await agent.open(workId, conversationId) });
      }
      case "new":
        return agentResponse({
          ok: true,
          view: await agent.newConversation(await workIdOf(body.workId)),
        });
      case "history":
        return agentResponse({
          ok: true,
          conversations: agent.history(await workIdOf(body.workId)),
        });
      case "delete":
        await agent.deleteConversation(string(body.conversationId));
        return agentResponse({ ok: true });
      case "send":
        return agentResponse({
          ok: true,
          view: await agent.send(
            string(body.conversationId),
            string(body.requestId),
            typeof body.text === "string" ? body.text : "",
            body.focus === undefined ? undefined : agentFocus(body.focus),
          ),
        });
      case "answer":
        return agentResponse({
          ok: true,
          view: await agent.answer(
            string(body.conversationId),
            string(body.questionId),
            string(body.requestId),
            body.choices,
            body.other,
          ),
        });
      case "proposal": {
        if (body.decision !== "apply" && body.decision !== "dismiss") {
          throw new AgentError("request", "Choose Apply or Dismiss.");
        }
        return agentResponse({
          ok: true,
          view: await agent.decideProposal(
            string(body.conversationId),
            string(body.proposalId),
            body.decision,
          ),
        });
      }
      case "undo":
        return agentResponse({
          ok: true,
          view: await agent.undo(string(body.conversationId), string(body.changeId)),
        });
      case "cancel":
        return agentResponse({ ok: true, view: await agent.cancel(string(body.conversationId)) });
      case "retry":
        return agentResponse({ ok: true, view: await agent.retry(string(body.conversationId)) });
      case "memory": {
        const workId = await workIdOf(body.workId);
        if (workId === null) throw new AgentError("work", "Open a webtoon first.", 400);
        return agentResponse({ ok: true, memory: await agent.memory(workId) });
      }
      case "forget": {
        const workId = await workIdOf(body.workId);
        if (workId === null) throw new AgentError("work", "Open a webtoon first.", 400);
        return agentResponse({ ok: true, memory: await agent.forget(workId, string(body.noteId)) });
      }
      default:
        throw new AgentError("request", "This agent action is unavailable.");
    }
  } catch (error) {
    if (isAgentError(error)) {
      const providers = (error as { providers?: unknown }).providers;
      return agentResponse(
        {
          ok: false,
          code: error.code,
          error: error.message,
          ...(Array.isArray(providers) ? { providers } : {}),
        },
        error.status,
      );
    }
    return agentResponse(
      {
        ok: false,
        code: "unavailable",
        error: "The local agent service is unavailable. Check your workspace and try again.",
      },
      500,
    );
  }
}
