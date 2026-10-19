"use client";
import { useAgentWorkspace } from "./agent-workspace";
export function AskAgent({ message, children }: { message: string; children: React.ReactNode }) {
  const { ask } = useAgentWorkspace();
  return (
    <button type="button" className="btn btn-primary" onClick={() => ask(message)}>
      {children}
    </button>
  );
}

export function AgentConnectionButton() {
  const { openConnection } = useAgentWorkspace();
  return (
    <button type="button" className="btn btn-primary" onClick={openConnection}>
      Manage agent connection
    </button>
  );
}
