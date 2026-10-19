import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { decodeYaml } from "@toony/project-io";
import { AgentError, type AgentFocus, agentFocus } from "./types.js";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function text(value: unknown): string | undefined {
  return typeof value === "string" ? value.slice(0, 3000) : undefined;
}
function fields(value: unknown, keys: string[]): Record<string, unknown> {
  const row = record(value);
  return Object.fromEntries(
    keys.flatMap((key) => (typeof row[key] === "string" ? [[key, text(row[key])]] : [])),
  );
}
export async function readContextFile(
  root: string,
  name: string,
  optional = false,
): Promise<string | null> {
  try {
    const canonical = await realpath(root);
    const path = join(canonical, name);
    const inside = relative(canonical, path);
    if (!inside || inside.startsWith(`..${sep}`) || inside === "..") throw new Error();
    let current = canonical;
    for (const segment of inside.split(sep)) {
      current = join(current, segment);
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || (current === path ? !stat.isFile() : !stat.isDirectory()))
        throw new Error();
    }
    const resolved = await realpath(path);
    if (!resolved.startsWith(`${canonical}${sep}`)) throw new Error();
    const handle = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 2_000_000) throw new Error();
      const buffer = Buffer.alloc(2_000_001);
      let length = 0;
      while (length < buffer.length) {
        const result = await handle.read(buffer, length, buffer.length - length, length);
        if (!result.bytesRead) break;
        length += result.bytesRead;
      }
      if (length > 2_000_000) throw new Error();
      return buffer.subarray(0, length).toString("utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new AgentError(
      "context",
      "The saved project context could not be read safely. Check the project or turn off project context.",
    );
  }
}
export async function projectAgentContext(root: string, focusInput: AgentFocus): Promise<string> {
  const focus = agentFocus(focusInput);
  try {
    const webtoon = record(JSON.parse((await readContextFile(root, "webtoon.json")) ?? "{}"));
    const briefRaw = await readContextFile(root, "script/brief.json", true);
    const brief = record(briefRaw ? JSON.parse(briefRaw) : {});
    const context: Record<string, unknown> = {
      title: text(webtoon.title),
      language: text(record(webtoon.languages).dialogueLanguage),
      brief: {
        ...fields(brief, ["intent", "audience", "world"]),
        goals: list(brief.storyGoals).slice(0, 20).map(text),
        constraints: list(brief.contentConstraints).slice(0, 20).map(text),
        cast: list(brief.cast)
          .slice(0, 40)
          .map((c) => fields(c, ["characterId", "role", "continuity"])),
      },
      characters: list(webtoon.characters)
        .slice(0, 40)
        .map((character) => {
          const c = record(character);
          return {
            ...fields(c, ["id", "name", "visualIdentity", "lockstring"]),
            development: fields(c.development, ["role", "desire", "flaw", "voice", "arc"]),
            wardrobe: list(c.wardrobe)
              .slice(0, 12)
              .map((w) => fields(w, ["id", "description"])),
          };
        }),
      scope:
        "Saved project text only. No image pixels, unsaved edits, provider settings or execution history. Bounded summary; omitted material is not absent from the work.",
      focus,
    };
    const episodeDirectory = join(root, "episodes");
    const dir = await lstat(episodeDirectory);
    if (!dir.isDirectory() || dir.isSymbolicLink()) throw new Error();
    const entries = (await readdir(episodeDirectory, { withFileTypes: true }))
      .filter(
        (e) => e.isDirectory() && !e.isSymbolicLink() && /^[\p{L}\p{N}_-]{1,100}$/u.test(e.name),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    const episodes: Record<string, unknown>[] = [];
    for (const entry of entries.slice(0, 80)) {
      const data = record(
        decodeYaml((await readContextFile(root, `episodes/${entry.name}/episode.yaml`)) ?? ""),
      );
      episodes.push({
        ...fields(data, ["id", "title"]),
        sequenceCount: list(data.sequence).length,
      });
    }
    context.episodes = episodes;
    context.episodesOmitted = Math.max(0, entries.length - episodes.length);
    if (focus.episodeId) {
      if (!entries.some((e) => e.name === focus.episodeId))
        throw new AgentError("focus", "The selected episode is no longer available.");
      const base = `episodes/${focus.episodeId}`;
      const cuts = list(decodeYaml((await readContextFile(root, `${base}/cuts.yaml`)) ?? ""));
      if (focus.cutId && !cuts.some((c) => record(c).id === focus.cutId))
        throw new AgentError("focus", "The selected cut is no longer available.");
      const selected = focus.cutId
        ? cuts.filter((c) => record(c).id === focus.cutId)
        : cuts.slice(0, 50);
      context.cuts = selected.map((c) => ({
        ...fields(c, ["id", "scene", "intent", "shotType", "reviewStatus"]),
        characters: list(record(c).characters).slice(0, 12).map(text),
      }));
      const scriptRaw = await readContextFile(
        root,
        `script/episodes/${focus.episodeId}.json`,
        true,
      );
      if (scriptRaw) {
        const script = record(JSON.parse(scriptRaw));
        context.continuity = fields(script.continuity, ["previousEpisodeId", "startsFrom"]);
        context.beats = list(script.beats)
          .slice(0, 50)
          .map((beat) => ({
            ...fields(beat, ["id", "purpose"]),
            cuts: list(record(beat).cuts)
              .filter((c) => !focus.cutId || record(c).id === focus.cutId)
              .slice(0, 50)
              .map((c) => ({
                ...fields(c, ["id", "intent", "scene", "shotType"]),
                dialogue: list(record(c).dialogue)
                  .slice(0, 24)
                  .map((line) => fields(line, ["speaker", "text"])),
              })),
          }));
      }
      const letteringRaw = await readContextFile(root, `${base}/lettering.json`, true);
      context.lettering = list(letteringRaw ? JSON.parse(letteringRaw) : [])
        .filter((b) => !focus.cutId || record(b).cutId === focus.cutId)
        .slice(0, 80)
        .map((b) => ({ ...fields(b, ["id", "cutId", "speaker"]), text: text(record(b).text) }));
    }
    const serialized = JSON.stringify(context);
    if (Buffer.byteLength(serialized) > 65_536)
      throw new AgentError(
        "context",
        "This project context is too large. Select one cut or turn off project context.",
      );
    return JSON.stringify({
      revision: createHash("sha256").update(serialized).digest("hex"),
      data: context,
    });
  } catch (error) {
    if (error instanceof AgentError) throw error;
    throw new AgentError(
      "context",
      "The saved project context is unavailable. Check the project or turn off project context.",
    );
  }
}
