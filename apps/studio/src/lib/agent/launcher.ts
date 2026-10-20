// Starting one agent turn: the real launcher spawns the installed CLI with the
// adapter's command line and feeds its output through the provider's parser.
// Tests pass their own launcher (a scripted provider) with the same contract.

import { createParser, type NativeEvent, type TurnInvocation, turnArgs } from "./adapters.js";
import { startTurnProcess } from "./process.js";
import type { AgentProvider } from "./protocol.js";
import type { ToolResult } from "./tools/run.js";

export interface LaunchSpec {
  provider: AgentProvider;
  /** Absolute path of the CLI. */
  binary: string;
  invocation: TurnInvocation;
  /** The conversation's stable private folder. */
  cwd: string;
  /** Written to stdin. */
  prompt: string;
  /** Run a Toony tool in process, as the MCP bridge would over HTTP (scripted providers). */
  callTool: (name: string, args: unknown) => Promise<ToolResult>;
}

export interface LaunchHandle {
  /** Stop gracefully (SIGINT, then SIGTERM, then SIGKILL). */
  stop: () => void;
  /** Kill now. */
  kill: () => void;
  done: Promise<{ code: number | null }>;
}

export type Launcher = (spec: LaunchSpec, emit: (event: NativeEvent) => void) => LaunchHandle;

export const cliLauncher: Launcher = (spec, emit) => {
  const parser = createParser(spec.provider);
  const child = startTurnProcess({
    command: spec.binary,
    args: turnArgs(spec.invocation),
    cwd: spec.cwd,
    input: spec.prompt,
    onStdoutLine: (line) => {
      for (const event of parser.line(line)) emit(event);
    },
    onStderrLine: (line) => {
      for (const event of parser.stderr(line)) emit(event);
    },
  });
  return {
    stop: child.stop,
    kill: child.kill,
    done: child.exited.then(({ code }) => ({ code })),
  };
};
