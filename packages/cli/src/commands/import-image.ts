// `toony import-image` — import or ingest an image asset for a cut or transition.
//
// Phase: headless core + CLI. Uses the provider-neutral contract to produce
// bytes (manual import today; generation providers register here later) and the
// project-io ingest path to strip metadata, place the file, and associate it
// with the target record. Studio UI is out of scope (issue #6 owns it).

import { resolve } from "node:path";
import { type AssetTarget, ingestImageAsset, ProjectIoError } from "@toony/project-io";
import { type ImageProvider, ManualImportProvider, ProviderError } from "@toony/providers";
import { EXIT_OK, EXIT_USAGE } from "../exit.js";

export interface ImportImageIo {
  cwd: string;
  out: (line: string) => void;
  err: (line: string) => void;
}

interface Flags {
  positional: string[];
  values: Map<string, string>;
  booleans: Set<string>;
}

const VALUE_FLAGS = new Set([
  "--episode",
  "--cut",
  "--transition",
  "--slot",
  "--from",
  "--provider",
]);
const BOOLEAN_FLAGS = new Set(["--allow-remote"]);

function parseFlags(args: string[]): Flags | { error: string } {
  const positional: string[] = [];
  const values = new Map<string, string>();
  const booleans = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (VALUE_FLAGS.has(arg)) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("-")) return { error: `${arg} requires a value` };
      values.set(arg, value);
      i++;
    } else if (BOOLEAN_FLAGS.has(arg)) {
      booleans.add(arg);
    } else if (arg.startsWith("-")) {
      return { error: `unknown option: ${arg}` };
    } else {
      positional.push(arg);
    }
  }
  return { positional, values, booleans };
}

const USAGE =
  "usage: toony import-image [path] --episode <id> (--cut <id> [--slot clean|final] | --transition <id>) --from <file> [--provider manual]";

function buildProvider(id: string): ImageProvider | { error: string } {
  if (id === "manual") return new ManualImportProvider();
  // No fake/stub providers: only sources with a real implementation are offered.
  return { error: `unknown provider "${id}"; only "manual" is available in this build` };
}

/** Run `toony import-image`. Returns the process exit code. */
export async function runImportImage(args: string[], io: ImportImageIo): Promise<number> {
  const parsed = parseFlags(args);
  if ("error" in parsed) {
    io.err(parsed.error);
    io.err(USAGE);
    return EXIT_USAGE;
  }

  const episodeId = parsed.values.get("--episode");
  const cutId = parsed.values.get("--cut");
  const transitionId = parsed.values.get("--transition");
  const from = parsed.values.get("--from");
  const slot = parsed.values.get("--slot") ?? "clean";
  const providerId = parsed.values.get("--provider") ?? "manual";

  if (episodeId === undefined) {
    io.err("missing required --episode <id>");
    io.err(USAGE);
    return EXIT_USAGE;
  }
  if ((cutId === undefined) === (transitionId === undefined)) {
    io.err("specify exactly one of --cut <id> or --transition <id>");
    io.err(USAGE);
    return EXIT_USAGE;
  }
  if (slot !== "clean" && slot !== "final") {
    io.err('--slot must be "clean" or "final"');
    return EXIT_USAGE;
  }

  const provider = buildProvider(providerId);
  if ("error" in provider) {
    io.err(provider.error);
    return EXIT_USAGE;
  }
  if (provider.transmitsRemotely && !parsed.booleans.has("--allow-remote")) {
    io.err(
      `provider "${providerId}" can transmit project content off this machine; re-run with --allow-remote to opt in`,
    );
    return EXIT_USAGE;
  }

  // Manual import needs a source file. (Generation providers may not.)
  if (provider.kind === "manual" && from === undefined) {
    io.err("manual import requires --from <file>");
    io.err(USAGE);
    return EXIT_USAGE;
  }

  const root = resolve(io.cwd, parsed.positional[0] ?? ".");
  const target: AssetTarget =
    cutId !== undefined
      ? { kind: "cut", episodeId, cutId, slot }
      : { kind: "transition", episodeId, transitionId: transitionId as string };

  try {
    const result = await provider.produce({ sourcePath: from });
    const ingested = await ingestImageAsset(root, target, result);
    const where =
      target.kind === "cut"
        ? `cut ${target.cutId} (${target.slot})`
        : `transition ${target.transitionId}`;
    io.out(
      `imported ${ingested.assetPath} for ${where} in ${episodeId} — ${ingested.bytesWritten} bytes, sha256 ${ingested.sha256.slice(0, 12)}`,
    );
    io.out("next: toony validate");
    return EXIT_OK;
  } catch (cause) {
    if (cause instanceof ProviderError || cause instanceof ProjectIoError) {
      io.err(`import failed: ${cause.message}`);
      return EXIT_USAGE;
    }
    throw cause;
  }
}
