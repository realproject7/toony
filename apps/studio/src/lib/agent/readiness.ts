// Is Claude Code or Codex installed, supported and signed in?
//
//   1. Locate the binary: the allowlisted PATH, then the usual install folders
//      (~/.local/bin, /opt/homebrew/bin, /usr/local/bin, the npm global bin).
//   2. Read its version (`--version`) and check the supported range.
//   3. Check `--help` for every option Toony passes. Steps 2 and 3 are cached
//      per binary (real path, size and modification time), never run per turn.
//   4. Check the sign-in: `claude auth status --json` (only `loggedIn`,
//      `authMethod` and `apiProvider` are read) or `codex login status` (exit
//      code and "Logged in using ChatGPT"). Toony uses subscription sign-ins.
// Command output is parsed in memory and never logged or returned.

import { access, constants, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { type ProbeRunner, runProbe } from "./process.js";
import type { AgentProvider, ProviderReadiness, ProviderStatus } from "./protocol.js";

export interface ProviderInfo {
  label: string;
  binary: string;
  loginCommand: string;
  installCommand: string;
  docsUrl: string;
  min: [number, number, number];
  /** Exclusive upper bound. */
  below: [number, number, number];
  supported: string;
}

export const PROVIDER_INFO: Record<AgentProvider, ProviderInfo> = {
  claude: {
    label: "Claude Code",
    binary: "claude",
    loginCommand: "claude auth login",
    installCommand: "npm install -g @anthropic-ai/claude-code",
    docsUrl: "https://code.claude.com/docs/en/quickstart",
    min: [2, 1, 259],
    below: [2, 2, 0],
    supported: "Claude Code 2.1.259 or newer, before 2.2",
  },
  codex: {
    label: "Codex",
    binary: "codex",
    loginCommand: "codex login",
    installCommand: "npm install -g @openai/codex",
    docsUrl: "https://developers.openai.com/codex/cli",
    min: [0, 158, 0],
    below: [0, 170, 0],
    supported: "Codex 0.158 or newer, before 0.170",
  },
};

export const SUBSCRIPTION_MESSAGE = "Toony uses your Claude or ChatGPT subscription sign-in.";

/** Options Toony passes. Each must appear in the CLI's own help. */
export const REQUIRED_FLAGS: Record<AgentProvider, { main: string[]; resume?: string[] }> = {
  claude: {
    main: [
      "--print",
      "--output-format",
      "--verbose",
      "--include-partial-messages",
      "--restricted",
      "--tools",
      "--strict-mcp-config",
      "--mcp-config",
      "--permission-mode",
      "dontAsk",
      "--allowedTools",
      "--no-chrome",
      "--append-system-prompt",
      "--session-id",
      "--resume",
    ],
  },
  codex: {
    main: [
      "--json",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--ignore-rules",
      "--color",
      "--config",
    ],
    resume: [
      "--json",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--ignore-rules",
      "--config",
    ],
  },
};

export type Version = [number, number, number];

export function parseVersion(text: string): Version | null {
  const match = /\b(\d{1,4})\.(\d{1,4})\.(\d{1,6})\b/.exec(text);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function versionInRange(provider: AgentProvider, version: Version): boolean {
  const info = PROVIDER_INFO[provider];
  return compareVersions(version, info.min) >= 0 && compareVersions(version, info.below) < 0;
}

export function formatVersion(version: Version): string {
  return version.join(".");
}

/** Required options absent from the help text(s). */
export function missingFlags(
  provider: AgentProvider,
  help: { main: string; resume?: string },
): string[] {
  const wanted = REQUIRED_FLAGS[provider];
  const has = (text: string, flag: string) =>
    new RegExp(`(^|[^A-Za-z0-9-])${flag.replace(/[-]/g, "\\-")}(?![A-Za-z0-9-])`, "m").test(text);
  const missing = wanted.main.filter((flag) => !has(help.main, flag));
  for (const flag of wanted.resume ?? []) {
    if (!has(help.resume ?? "", flag)) missing.push(`resume ${flag}`);
  }
  return missing;
}

export type SignIn = "ready" | "signed-out" | "other-method" | "unknown";

/** `claude auth status --json`: only loggedIn, authMethod and apiProvider are read. */
export function parseClaudeAuth(stdout: string, code: number | null): SignIn {
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    return code === 1 ? "signed-out" : "unknown";
  }
  if (!data || typeof data !== "object") return "unknown";
  const { loggedIn, authMethod, apiProvider } = data as Record<string, unknown>;
  if (loggedIn !== true) return "signed-out";
  if (code !== 0) return "unknown";
  if (authMethod !== "claude.ai") return "other-method";
  if (apiProvider !== undefined && apiProvider !== "firstParty") return "other-method";
  return "ready";
}

/** `codex login status`: exit code and the "Logged in using ChatGPT" line (stdout or stderr). */
export function parseCodexLogin(output: string, code: number | null): SignIn {
  if (code === 0) return /Logged in using ChatGPT/.test(output) ? "ready" : "other-method";
  if (code === 1) return "signed-out";
  return "unknown";
}

/** Folders searched for a CLI, in order, without duplicates. */
export function candidateDirs(
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = homedir(),
  execPath: string = process.execPath,
): string[] {
  const dirs = [
    ...(env.PATH ?? "").split(delimiter),
    join(home, ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    // npm's global bin sits next to node for nvm, fnm and the official installers.
    dirname(execPath),
    ...(env.NPM_CONFIG_PREFIX ? [join(env.NPM_CONFIG_PREFIX, "bin")] : []),
    join(home, ".npm-global", "bin"),
  ];
  return [...new Set(dirs.filter((dir) => dir !== "" && dir.startsWith("/")))];
}

export async function locateBinary(
  provider: AgentProvider,
  dirs: readonly string[] = candidateDirs(),
): Promise<string | null> {
  const names =
    process.platform === "win32"
      ? [`${PROVIDER_INFO[provider].binary}.cmd`, `${PROVIDER_INFO[provider].binary}.exe`]
      : [PROVIDER_INFO[provider].binary];
  for (const dir of dirs) {
    for (const name of names) {
      const file = join(dir, name);
      try {
        const info = await stat(file);
        if (!info.isFile()) continue;
        await access(file, constants.X_OK);
        return file;
      } catch {
        // Not here.
      }
    }
  }
  return null;
}

export interface BinaryCheck {
  /** Absolute path of the binary, for spawning only. Never sent to a browser. */
  path: string;
  version: Version | null;
  missingFlags: string[];
}

export interface ReadinessResult {
  status: ProviderStatus;
  binary: BinaryCheck | null;
}

export interface ReadinessOptions {
  /** Folder probes run in (private, stable). */
  cwd: string;
  run?: ProbeRunner;
  locate?: (provider: AgentProvider) => Promise<string | null>;
  /** How long a sign-in result is reused. */
  signInTtlMs?: number;
  now?: () => number;
}

/** Readiness checks with the binary cache and a short sign-in cache. */
export class Readiness {
  private readonly run: ProbeRunner;
  private readonly locate: (provider: AgentProvider) => Promise<string | null>;
  private readonly binaries = new Map<string, { version: Version | null; missing: string[] }>();
  private readonly signIns = new Map<AgentProvider, { at: number; result: ReadinessResult }>();
  private readonly ttl: number;
  private readonly now: () => number;

  constructor(private readonly options: ReadinessOptions) {
    this.run = options.run ?? runProbe;
    this.locate = options.locate ?? ((provider) => locateBinary(provider));
    this.ttl = options.signInTtlMs ?? 60_000;
    this.now = options.now ?? Date.now;
  }

  /** Locate the binary and check version and options (cached per binary). No sign-in check. */
  async binary(provider: AgentProvider): Promise<BinaryCheck | null> {
    const path = await this.locate(provider);
    if (path === null) return null;
    let key = path;
    try {
      const real = await realpath(path);
      const info = await stat(real);
      key = `${real}|${info.size}|${info.mtimeMs}`;
    } catch {
      // Keep the plain path as the key.
    }
    let cached = this.binaries.get(key);
    if (cached === undefined) {
      const cwd = this.options.cwd;
      const versionOut = await this.run(path, ["--version"], { cwd, timeoutMs: 10_000 });
      if (versionOut.missing) return null;
      const version =
        versionOut.code === 0 ? parseVersion(`${versionOut.stdout}\n${versionOut.stderr}`) : null;
      let missing: string[] = [];
      if (version !== null && versionInRange(provider, version)) {
        if (provider === "claude") {
          const help = await this.run(path, ["--help"], { cwd, timeoutMs: 10_000 });
          missing = missingFlags(provider, { main: help.stdout });
        } else {
          const help = await this.run(path, ["exec", "--help"], { cwd, timeoutMs: 10_000 });
          const resume = await this.run(path, ["exec", "resume", "--help"], {
            cwd,
            timeoutMs: 10_000,
          });
          missing = missingFlags(provider, { main: help.stdout, resume: resume.stdout });
        }
      }
      cached = { version, missing };
      // A version that could not be read is not cached, so a later check retries.
      if (version !== null) this.binaries.set(key, cached);
    }
    return { path, version: cached.version, missingFlags: cached.missing };
  }

  /** The readiness of a binary before sign-in: null when it can run turns. */
  static binaryProblem(
    provider: AgentProvider,
    binary: BinaryCheck | null,
  ): ProviderReadiness | null {
    const info = PROVIDER_INFO[provider];
    if (binary === null) {
      return { state: "missing", installCommand: info.installCommand, docsUrl: info.docsUrl };
    }
    if (binary.version === null) {
      return {
        state: "unavailable",
        detail: `Toony could not read the ${info.label} version. Check that it runs in a terminal.`,
      };
    }
    if (!versionInRange(provider, binary.version)) {
      return {
        state: "unsupported",
        version: formatVersion(binary.version),
        supported: info.supported,
      };
    }
    if (binary.missingFlags.length > 0) {
      return {
        state: "unsupported",
        version: formatVersion(binary.version),
        supported: info.supported,
        detail: `This ${info.label} build (${formatVersion(binary.version)}) is missing options Toony needs. Update it, then check again.`,
      };
    }
    return null;
  }

  /** Full check including sign-in. Cached for a minute unless `refresh`. */
  async check(provider: AgentProvider, refresh = false): Promise<ReadinessResult> {
    const cached = this.signIns.get(provider);
    if (!refresh && cached && this.now() - cached.at < this.ttl) return cached.result;
    const info = PROVIDER_INFO[provider];
    const status = (readiness: ProviderReadiness): ProviderStatus => ({
      provider,
      label: info.label,
      readiness,
    });
    let binary: BinaryCheck | null = null;
    let result: ReadinessResult;
    try {
      binary = await this.binary(provider);
      const problem = Readiness.binaryProblem(provider, binary);
      if (problem !== null || binary === null || binary.version === null) {
        result = {
          status: status(
            problem ?? { state: "unavailable", detail: `Toony could not check ${info.label}.` },
          ),
          binary,
        };
      } else {
        const version = formatVersion(binary.version);
        const args = provider === "claude" ? ["auth", "status", "--json"] : ["login", "status"];
        const out = await this.run(binary.path, args, { cwd: this.options.cwd, timeoutMs: 10_000 });
        const signIn =
          provider === "claude"
            ? parseClaudeAuth(out.stdout, out.code)
            : parseCodexLogin(`${out.stdout}\n${out.stderr}`, out.code);
        const readiness: ProviderReadiness =
          signIn === "ready"
            ? { state: "ready", version }
            : signIn === "other-method"
              ? {
                  state: "sign-in-required",
                  version,
                  command: info.loginCommand,
                  message: SUBSCRIPTION_MESSAGE,
                }
              : signIn === "signed-out"
                ? { state: "sign-in-required", version, command: info.loginCommand }
                : {
                    state: "unavailable",
                    detail: `Toony could not check the ${info.label} sign-in. Try again.`,
                  };
        result = { status: status(readiness), binary };
      }
    } catch {
      result = {
        status: status({ state: "unavailable", detail: `Toony could not check ${info.label}.` }),
        binary,
      };
    }
    this.signIns.set(provider, { at: this.now(), result });
    return result;
  }

  /** Forget the sign-in result, for example after an authentication failure in a turn. */
  forgetSignIn(provider: AgentProvider): void {
    this.signIns.delete(provider);
  }

  async all(refresh = false): Promise<ProviderStatus[]> {
    const results = await Promise.all([
      this.check("claude", refresh),
      this.check("codex", refresh),
    ]);
    return results.map((result) => result.status);
  }
}
