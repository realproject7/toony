// `toony packs <list|doctor|install|remove>` — the pack seam, from the outside.
//
// Discovery (#197) can already find, validate, and merge packs, but nothing put
// one in place, showed what was installed, or answered the question a user
// actually hits: "I copied the folder in and my genre is not there." Discovery
// skips a malformed pack in silence by design, and every reason it skipped one
// is already in `loadPacks().issues`. `packs doctor` is where those reach a
// person.
//
// Installing here means copying a directory that is ALREADY on this machine into
// a pack root. Nothing in this command fetches, and adding a pack may not become
// a way to run code or reach a registry: a pack is data. Distribution is #195.
//
// `install` writes only to `<project>/.toony/packs` or `<workspace>/.toony/packs`,
// so `remove` deletes only from those two. A `TOONY_PACKS` directory is a
// collection the operator maintains, and this command never deletes inside one.
//
// Exit codes: 0 success (for `doctor`, no problems found); 1 `doctor` found
// problems; 2 usage or IO failure.

import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import {
  type LoadedPacks,
  loadPacks,
  PACKS_ENV_VAR,
  type PackSummary,
  PROJECT_PACKS_DIR,
  packRoots,
  readPackManifest,
} from "@toony/packs";
import { isPathSafeId } from "@toony/schema";
import { EXIT_OK, EXIT_USAGE, EXIT_VALIDATION } from "../exit.js";

export interface PacksIo {
  cwd: string;
  out: (line: string) => void;
  err: (line: string) => void;
  /** Process environment; `TOONY_PACKS` names extra pack directories. */
  env?: Record<string, string | undefined>;
}

const USAGE = `usage:
  toony packs list [path] [--json]
  toony packs doctor [path] [--json]
  toony packs install <pack-dir> [path] [--workspace] [--force]
  toony packs remove <id> [path]`;

const FLAGS = ["--json", "--workspace", "--force"];

/** The contribution kinds, named exactly as `toony-pack.json` names them. */
const KINDS = ["workflows", "genres", "exportPresets", "craftBands"] as const;

interface Parsed {
  positional: string[];
  flags: Set<string>;
}

function parse(args: string[]): Parsed | { error: string } {
  const positional: string[] = [];
  const flags = new Set<string>();
  for (const arg of args) {
    if (FLAGS.includes(arg)) flags.add(arg);
    else if (arg.startsWith("-")) return { error: `unknown option: ${arg}` };
    else positional.push(arg);
  }
  return { positional, flags };
}

/**
 * Refuse a flag this subcommand does not act on. Ignoring one silently is how a
 * user ends up believing they asked for JSON and got a human table.
 */
function unusedFlag(flags: Set<string>, allowed: readonly string[], sub: string): string | null {
  for (const flag of flags) {
    if (!allowed.includes(flag)) return `${flag} is not an option of "toony packs ${sub}"`;
  }
  return null;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** True when `path` is `parent` or sits inside it. */
function isInside(path: string, parent: string): boolean {
  return path === parent || path.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

type RootKind = "env" | "project" | "workspace";

const ROOT_LABEL: Record<RootKind, string> = {
  env: PACKS_ENV_VAR,
  project: "project",
  workspace: "workspace",
};

interface RootInfo {
  path: string;
  kind: RootKind;
  exists: boolean;
  packs: number;
}

function rootKind(packRoot: string, projectRoot: string): RootKind {
  if (packRoot === resolve(projectRoot, PROJECT_PACKS_DIR)) return "project";
  if (packRoot === resolve(dirname(projectRoot), PROJECT_PACKS_DIR)) return "workspace";
  return "env";
}

/** The roots `install` writes to, and so the only roots `remove` deletes from. */
function writableRoots(projectRoot: string): string[] {
  const roots = [resolve(projectRoot, PROJECT_PACKS_DIR)];
  const parent = dirname(projectRoot);
  if (parent !== projectRoot) roots.push(resolve(parent, PROJECT_PACKS_DIR));
  return roots;
}

/**
 * Describe every root discovery searched, in its precedence order, including the
 * ones that are not there. A pack that never loads is usually a folder in a
 * place Toony does not look, and that is only visible if the empty roots are
 * reported too.
 */
async function describeRoots(
  projectRoot: string,
  env: Record<string, string | undefined>,
  packs: readonly PackSummary[],
): Promise<RootInfo[]> {
  const infos: RootInfo[] = [];
  for (const path of packRoots(projectRoot, env)) {
    infos.push({
      path,
      kind: rootKind(path, projectRoot),
      exists: await isDirectory(path),
      packs: packs.filter((pack) => pack.root === path).length,
    });
  }
  return infos;
}

function rootLines(roots: readonly RootInfo[]): string[] {
  const width = Math.max(...roots.map((root) => ROOT_LABEL[root.kind].length));
  return [
    "roots searched, first claim winning:",
    ...roots.map((root, index) => {
      const state = root.exists ? `${root.packs} pack(s)` : "not created yet";
      return `  ${index + 1}  ${ROOT_LABEL[root.kind].padEnd(width)}  ${root.path}  (${state})`;
    }),
  ];
}

const DETAIL_WIDTH = Math.max(...["root", "dir", ...KINDS].map((label) => label.length));

function detailLine(indent: string, label: string, value: string): string {
  return `${indent}${label.padEnd(DETAIL_WIDTH)}  ${value}`;
}

/**
 * One line per contribution kind, empty kinds included: a pack that contributes
 * nothing has to look different from a pack whose list was left off the report.
 */
function contributionLines(pack: PackSummary, indent: string): string[] {
  return KINDS.map((kind) => {
    const names = pack.contributes[kind];
    return detailLine(indent, kind, names.length > 0 ? names.join(", ") : "(none)");
  });
}

function packJson(pack: PackSummary, projectRoot: string): Record<string, unknown> {
  return {
    id: pack.id,
    name: pack.name,
    dir: pack.dir,
    root: pack.root,
    rootKind: rootKind(pack.root, projectRoot),
    contributes: {
      workflows: [...pack.contributes.workflows],
      genres: [...pack.contributes.genres],
      exportPresets: [...pack.contributes.exportPresets],
      craftBands: [...pack.contributes.craftBands],
    },
  };
}

function rootsJson(roots: readonly RootInfo[]): Record<string, unknown>[] {
  return roots.map((root) => ({
    path: root.path,
    kind: root.kind,
    exists: root.exists,
    packs: root.packs,
  }));
}

async function runList(parsed: Parsed, io: PacksIo): Promise<number> {
  const unused = unusedFlag(parsed.flags, ["--json"], "list");
  if (unused !== null) {
    io.err(unused);
    io.err(USAGE);
    return EXIT_USAGE;
  }

  const root = resolve(io.cwd, parsed.positional[0] ?? ".");
  const env = io.env ?? {};
  const loaded = await loadPacks(root, env);
  const roots = await describeRoots(root, env, loaded.packs);

  if (parsed.flags.has("--json")) {
    io.out(
      JSON.stringify(
        {
          root,
          roots: rootsJson(roots),
          packs: loaded.packs.map((pack) => packJson(pack, root)),
          issues: loaded.issues.length,
        },
        null,
        2,
      ),
    );
    return EXIT_OK;
  }

  const where = relative(io.cwd, root) || ".";
  if (loaded.packs.length === 0) {
    io.out(`no packs installed for ${where}`);
    for (const line of rootLines(roots)) io.out(line);
    io.out("install one with: toony packs install <pack-dir>");
  } else {
    io.out(`${loaded.packs.length} pack(s) installed for ${where}`);
    for (const pack of loaded.packs) {
      io.out(`  ${pack.id}  ${pack.name}`);
      io.out(detailLine("    ", "root", `${ROOT_LABEL[rootKind(pack.root, root)]}  ${pack.root}`));
      io.out(detailLine("    ", "dir", pack.dir));
      for (const line of contributionLines(pack, "    ")) io.out(line);
    }
  }
  if (loaded.issues.length > 0) {
    io.err(
      `${loaded.issues.length} pack problem(s) found; run \`toony packs doctor\` for the details`,
    );
  }
  return EXIT_OK;
}

async function runDoctor(parsed: Parsed, io: PacksIo): Promise<number> {
  const unused = unusedFlag(parsed.flags, ["--json"], "doctor");
  if (unused !== null) {
    io.err(unused);
    io.err(USAGE);
    return EXIT_USAGE;
  }

  const root = resolve(io.cwd, parsed.positional[0] ?? ".");
  const env = io.env ?? {};
  const loaded = await loadPacks(root, env);
  const roots = await describeRoots(root, env, loaded.packs);

  if (parsed.flags.has("--json")) {
    io.out(
      JSON.stringify(
        {
          root,
          roots: rootsJson(roots),
          packs: loaded.packs.map((pack) => pack.id),
          issues: loaded.issues.map((issue) => ({
            pack: issue.pack,
            path: issue.path,
            code: issue.code,
            message: issue.message,
          })),
        },
        null,
        2,
      ),
    );
    return loaded.issues.length > 0 ? EXIT_VALIDATION : EXIT_OK;
  }

  io.out(`packs for ${relative(io.cwd, root) || "."}`);
  for (const line of rootLines(roots)) io.out(line);
  io.out(
    loaded.packs.length > 0
      ? `loaded: ${loaded.packs.map((pack) => pack.id).join(", ")}`
      : "loaded: none",
  );

  if (loaded.issues.length === 0) {
    io.out("problems: none");
    return EXIT_OK;
  }
  io.out(`problems: ${loaded.issues.length}`);
  // Grouped by pack directory: the first thing to fix is knowing which folder on
  // disk to open.
  const byPack = new Map<string, typeof loaded.issues>();
  for (const issue of loaded.issues) {
    byPack.set(issue.pack, [...(byPack.get(issue.pack) ?? []), issue]);
  }
  for (const [pack, issues] of byPack) {
    io.out(pack);
    for (const issue of issues) io.out(`  [${issue.code}] ${issue.path}: ${issue.message}`);
  }
  return EXIT_VALIDATION;
}

/**
 * Copy a pack directory. Regular files and directories only: a symlink would
 * point outside the pack folder, which the format forbids, so it is not carried
 * into the installed copy.
 */
async function copyTree(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const source = resolve(from, entry.name);
    const target = resolve(to, entry.name);
    if (entry.isDirectory()) await copyTree(source, target);
    else if (entry.isFile()) await copyFile(source, target);
  }
}

/** Report what an installed pack actually contributes, once it is in place. */
function reportInstalled(loaded: LoadedPacks, dest: string, io: PacksIo): void {
  const installed = loaded.packs.find((pack) => pack.dir === dest);
  if (installed !== undefined) {
    for (const line of contributionLines(installed, "  ")) io.out(line);
  }
  for (const issue of loaded.issues.filter((issue) => issue.pack === dest)) {
    io.err(`pack warning [${issue.code}] ${issue.path}: ${issue.message}`);
  }
  if (installed === undefined) {
    io.err("this pack is installed but contributes nothing; run `toony packs doctor`");
  }
}

async function runInstall(parsed: Parsed, io: PacksIo): Promise<number> {
  const unused = unusedFlag(parsed.flags, ["--workspace", "--force"], "install");
  if (unused !== null) {
    io.err(unused);
    io.err(USAGE);
    return EXIT_USAGE;
  }

  const from = parsed.positional[0];
  if (from === undefined) {
    io.err("missing required <pack-dir>");
    io.err(USAGE);
    return EXIT_USAGE;
  }
  const source = resolve(io.cwd, from);
  const root = resolve(io.cwd, parsed.positional[1] ?? ".");

  if (!(await isDirectory(source))) {
    io.err(`pack directory could not be read: ${source}`);
    io.err("install copies a directory that is already on this machine; it never downloads one.");
    return EXIT_USAGE;
  }

  // A directory that is not a valid pack is refused HERE, with the codes
  // discovery would have reported, rather than copied into place to be skipped
  // in silence afterwards.
  const manifest = await readPackManifest(source);
  if (Array.isArray(manifest)) {
    io.err(`not a valid pack: ${source}`);
    for (const issue of manifest) io.err(`  [${issue.code}] ${issue.path}: ${issue.message}`);
    return EXIT_USAGE;
  }

  const destRoot = parsed.flags.has("--workspace")
    ? resolve(dirname(root), PROJECT_PACKS_DIR)
    : resolve(root, PROJECT_PACKS_DIR);
  // The manifest id is validated as a path-safe segment, so this cannot resolve
  // outside the pack root.
  const dest = resolve(destRoot, manifest.id);

  if (isInside(dest, source) || isInside(source, dest)) {
    io.err(
      dest === source
        ? `already installed at ${dest}`
        : `cannot copy ${source} to ${dest}: one directory contains the other`,
    );
    return EXIT_USAGE;
  }

  if (await isDirectory(dest)) {
    if (!parsed.flags.has("--force")) {
      io.err(`a pack is already installed at ${dest}; pass --force to replace it`);
      return EXIT_USAGE;
    }
    await rm(dest, { recursive: true, force: true });
  }

  try {
    await copyTree(source, dest);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    io.err(`install failed: ${reason}`);
    return EXIT_USAGE;
  }

  io.out(`installed "${manifest.id}" (${manifest.name}) to ${dest}`);
  reportInstalled(await loadPacks(root, io.env ?? {}), dest, io);
  return EXIT_OK;
}

async function runRemove(parsed: Parsed, io: PacksIo): Promise<number> {
  const unused = unusedFlag(parsed.flags, [], "remove");
  if (unused !== null) {
    io.err(unused);
    io.err(USAGE);
    return EXIT_USAGE;
  }

  const id = parsed.positional[0];
  if (id === undefined) {
    io.err("missing required <id>");
    io.err(USAGE);
    return EXIT_USAGE;
  }
  // The id becomes a path segment in the fallback lookup below, so traversal is
  // refused before anything on disk is touched.
  if (!isPathSafeId(id)) {
    io.err(`pack id "${id}" must be a path-safe segment (no /, \\, NUL, or . / .. traversal)`);
    return EXIT_USAGE;
  }

  const root = resolve(io.cwd, parsed.positional[1] ?? ".");
  const env = io.env ?? {};
  const loaded = await loadPacks(root, env);
  const writable = writableRoots(root);

  // The directory named after the id, in the roots install writes to, is looked
  // for first. It catches the two cases a discovered summary cannot: a pack that
  // failed validation and so never loaded at all, and a pack shadowed by an
  // earlier root, where the copy the user can actually remove is this one.
  let dir: string | null = null;
  for (const packRoot of writable) {
    const candidate = resolve(packRoot, id);
    if (await isDirectory(candidate)) {
      dir = candidate;
      break;
    }
  }
  // A pack whose directory is not named after its id is still removable, by the
  // id its manifest declares.
  if (dir === null) dir = loaded.packs.find((pack) => pack.id === id)?.dir ?? null;

  if (dir === null) {
    io.err(`no pack "${id}" is installed for ${relative(io.cwd, root) || "."}`);
    io.err(
      loaded.packs.length > 0
        ? `installed: ${loaded.packs.map((pack) => pack.id).join(", ")}`
        : "no packs are installed; `toony packs list` shows the roots searched",
    );
    return EXIT_USAGE;
  }

  if (!writable.includes(dirname(dir))) {
    io.err(`"${id}" is in a ${PACKS_ENV_VAR} collection: ${dir}`);
    io.err(
      `remove never deletes there. Delete that directory yourself, or drop it from ${PACKS_ENV_VAR}.`,
    );
    return EXIT_USAGE;
  }

  try {
    await rm(dir, { recursive: true, force: true });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    io.err(`remove failed: ${reason}`);
    return EXIT_USAGE;
  }
  io.out(`removed "${id}" from ${dir}`);
  return EXIT_OK;
}

/** Run `toony packs`. Returns the process exit code. */
export async function runPacks(args: string[], io: PacksIo): Promise<number> {
  const [sub, ...rest] = args;
  const parsed = parse(rest);
  if ("error" in parsed) {
    io.err(parsed.error);
    io.err(USAGE);
    return EXIT_USAGE;
  }

  switch (sub) {
    case "list":
      return runList(parsed, io);
    case "doctor":
      return runDoctor(parsed, io);
    case "install":
      return runInstall(parsed, io);
    case "remove":
      return runRemove(parsed, io);
    default:
      io.err(sub === undefined ? "missing subcommand" : `unknown packs subcommand: ${sub}`);
      io.err(USAGE);
      return EXIT_USAGE;
  }
}
