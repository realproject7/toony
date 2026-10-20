import { resolve } from "node:path";
import {
  applyArtRevision,
  artRevisionBrief,
  artRevisionContext,
  createArtRevision,
  listArtRevisions,
  RevisionError,
  readArtRevision,
  stageArtRevision,
} from "@toony/project-io";
import { ManualImportProvider, ProviderError } from "@toony/providers";
import { EXIT_OK, EXIT_USAGE } from "../exit.js";

const USAGE =
  "usage: toony revision <list|show|create|stage|apply> [path] [--episode <id> --cut <id>] [--id <request-id>] [--change <text> --preserve <text> --character <id>] [--file <image> --note <text>] [--candidate <sha256>] [--json]";
export async function runRevision(
  args: string[],
  io: { cwd: string; out(line: string): void; err(line: string): void },
): Promise<number> {
  const [action, ...rest] = args;
  const values = new Map<string, string>();
  let path = ".",
    hasPath = false,
    json = false;
  const flags = new Set([
    "--episode",
    "--cut",
    "--id",
    "--change",
    "--preserve",
    "--character",
    "--file",
    "--note",
    "--candidate",
  ]);
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] ?? "";
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (flags.has(arg) && rest[i + 1] !== undefined && !rest[i + 1]?.startsWith("--")) {
      values.set(arg, rest[++i] ?? "");
      continue;
    }
    if (!arg.startsWith("-") && !hasPath) {
      path = arg;
      hasPath = true;
      continue;
    }
    io.err(USAGE);
    return EXIT_USAGE;
  }
  const root = resolve(io.cwd, path);
  const need = (flag: string) => {
    const value = values.get(flag);
    if (!value) throw new RevisionError(`${flag} is required.`);
    return value;
  };
  try {
    if (action === "list") {
      const requests = await listArtRevisions(root, need("--episode"), need("--cut"));
      io.out(
        json
          ? JSON.stringify(requests)
          : requests.map((r) => `${r.id} ${r.state}: ${r.change}`).join("\n") ||
              "No revision requests.",
      );
    } else if (action === "show") {
      const request = await readArtRevision(root, need("--id"));
      io.out(json ? JSON.stringify(request) : artRevisionBrief(request));
    } else if (action === "create") {
      const episodeId = need("--episode"),
        cutId = need("--cut");
      const current = await artRevisionContext(root, episodeId, cutId);
      const request = await createArtRevision(root, {
        episodeId,
        cutId,
        contextRevision: current.contextRevision,
        change: need("--change"),
        preserve: need("--preserve"),
        characterId: values.get("--character"),
      });
      io.out(
        json
          ? JSON.stringify(request)
          : `Saved request ${request.id}. The current artwork is unchanged; stage a candidate with toony revision stage --id ${request.id} --file <image> --note <changes>.`,
      );
    } else if (action === "stage") {
      const id = need("--id"),
        note = need("--note");
      const result = await new ManualImportProvider().produce({
        sourcePath: resolve(io.cwd, need("--file")),
      });
      const request = await stageArtRevision(root, id, result, note);
      io.out(
        json
          ? JSON.stringify(request)
          : `Candidate ready for ${id}. Apply it with toony revision apply --id ${id} --candidate ${request.candidate?.sha256 ?? "<sha256>"}.`,
      );
    } else if (action === "apply") {
      const id = need("--id");
      const request = await applyArtRevision(root, id, need("--candidate"));
      io.out(
        json
          ? JSON.stringify(request)
          : `Applied ${id}. The cut now shows the candidate as a draft; the source is kept in the request.`,
      );
    } else {
      io.err(USAGE);
      return EXIT_USAGE;
    }
    return EXIT_OK;
  } catch (error) {
    io.err(
      error instanceof RevisionError || error instanceof ProviderError
        ? error.message
        : "Revision operation failed. Check the local work and request files.",
    );
    return EXIT_USAGE;
  }
}
