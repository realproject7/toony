// Child processes of the agent runtime: the allowlisted environment, short
// probes (version, help, sign-in status) and the long-lived process of one
// agent turn. Every child runs in its own process group so the whole group can
// be stopped: SIGINT first (lets the CLI end its turn), then SIGTERM, then
// SIGKILL. Output is bounded; stderr is never shown to a person.

import { type ChildProcess, spawn } from "node:child_process";

/** Environment variables an agent CLI receives. Provider keys and Node options are dropped. */
export const ENV_ALLOWLIST = [
  "HOME",
  "PATH",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "USER",
  "LOGNAME",
  "__CF_USER_TEXT_ENCODING",
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "SYSTEMROOT",
] as const;

export function nativeEnvironment(
  source: Readonly<Record<string, string | undefined>> = process.env,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    ENV_ALLOWLIST.flatMap((key) => (source[key] === undefined ? [] : [[key, source[key]]])),
  ) as NodeJS.ProcessEnv;
}

export interface ProbeResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** True when the command could not start (not installed or not executable). */
  missing?: boolean;
}

export type ProbeRunner = (
  command: string,
  args: readonly string[],
  options: { cwd: string; timeoutMs?: number },
) => Promise<ProbeResult>;

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    // Already gone.
  }
}

/** Run a short command with the allowlisted environment. Output is capped at 256 KB. */
export const runProbe: ProbeRunner = (command, args, { cwd, timeoutMs = 10_000 }) =>
  new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(command, [...args], {
        cwd,
        env: nativeEnvironment(),
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      resolve({ code: null, stdout: "", stderr: "", missing: true });
      return;
    }
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let done = false;
    const finish = (result: ProbeResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      killGroup(child, "SIGKILL");
      resolve(result);
    };
    const timer = setTimeout(() => finish({ code: null, stdout, stderr }), timeoutMs);
    const take = (chunk: Buffer, into: "out" | "err") => {
      bytes += chunk.byteLength;
      if (bytes > 256 * 1024) {
        finish({ code: null, stdout, stderr });
        return;
      }
      if (into === "out") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
    };
    child.stdout?.on("data", (chunk: Buffer) => take(chunk, "out"));
    child.stderr?.on("data", (chunk: Buffer) => take(chunk, "err"));
    child.on("error", (error: NodeJS.ErrnoException) =>
      finish({
        code: null,
        stdout,
        stderr,
        missing: error.code === "ENOENT" || error.code === "EACCES",
      }),
    );
    child.on("close", (code) => finish({ code, stdout, stderr }));
  });

export interface TurnProcessOptions {
  command: string;
  args: readonly string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** Written to stdin, then stdin is closed. */
  input: string;
  onStdoutLine: (line: string) => void;
  onStderrLine?: (line: string) => void;
  /** Total stdout + stderr bytes before the process is killed. */
  maxBytes?: number;
  /** Delay between SIGINT, SIGTERM and SIGKILL when stopping. */
  graceMs?: number;
}

export interface TurnProcess {
  /** Resolves when the process has exited and its output is drained. */
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null; overflow: boolean }>;
  /** Stop gracefully: SIGINT, then SIGTERM, then SIGKILL to the whole group. */
  stop: () => void;
  /** Kill the whole group now. */
  kill: () => void;
}

function lineSplitter(onLine: (line: string) => void) {
  let pending = "";
  return {
    push(text: string) {
      pending += text;
      let index = pending.indexOf("\n");
      while (index !== -1) {
        const line = pending.slice(0, index).trim();
        pending = pending.slice(index + 1);
        if (line) onLine(line);
        index = pending.indexOf("\n");
      }
    },
    end() {
      const line = pending.trim();
      pending = "";
      if (line) onLine(line);
    },
  };
}

export function startTurnProcess(options: TurnProcessOptions): TurnProcess {
  const maxBytes = options.maxBytes ?? 32 * 1024 * 1024;
  const grace = options.graceMs ?? 2_000;
  const child = spawn(options.command, [...options.args], {
    cwd: options.cwd,
    env: options.env ?? nativeEnvironment(),
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });
  let bytes = 0;
  let overflow = false;
  let stopping = false;
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  const out = lineSplitter((line) => {
    try {
      options.onStdoutLine(line);
    } catch {
      // A consumer error never breaks the stream.
    }
  });
  const err = lineSplitter((line) => {
    try {
      options.onStderrLine?.(line);
    } catch {
      // Ignored as above.
    }
  });
  const kill = () => killGroup(child, "SIGKILL");
  const count = (chunk: string) => {
    bytes += Buffer.byteLength(chunk);
    if (bytes > maxBytes && !overflow) {
      overflow = true;
      kill();
    }
  };
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    count(chunk);
    if (!overflow) out.push(chunk);
  });
  child.stderr?.on("data", (chunk: string) => {
    count(chunk);
    if (!overflow) err.push(chunk);
  });
  child.stdin?.on("error", () => {});
  const exited = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    overflow: boolean;
  }>((resolve) => {
    let settled = false;
    const done = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      out.end();
      err.end();
      // Reap anything the CLI started that outlived it.
      kill();
      resolve({ code, signal, overflow });
    };
    child.on("error", () => done(null, null));
    child.on("close", (code, signal) => done(code, signal));
  });
  child.stdin?.end(options.input);
  return {
    exited,
    kill,
    stop: () => {
      if (stopping) return;
      stopping = true;
      killGroup(child, "SIGINT");
      timers.push(
        setTimeout(() => killGroup(child, "SIGTERM"), grace),
        setTimeout(() => killGroup(child, "SIGKILL"), grace * 2),
      );
    },
  };
}
