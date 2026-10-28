// Training a character's LoRA: the engine learns the character from their
// portrait, so every cut draws the same face, hair and clothes. It takes two
// jobs. The first draws a training set from the portrait (views the portrait
// holds closely, and poses at the usual balance), each picture captioned with a
// trigger word and the lockstring, and stops at "drawn" so the agent can look
// at the set and name the off-model or doubled pictures. The second drops those
// pictures, runs the training command the person set up
// (TOONY_LORA_TRAIN_COMMAND), and when it succeeds records the LoRA on the
// character as one undoable change. Both wait in the drawing queue, so the
// engine never draws and trains at once. Messages never carry absolute paths.

import { spawn } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { composeContactSheet, encodeCanvas } from "@toony/export";
import { withCharacterAvoid } from "@toony/generate";
import { CHARACTER_LORA_STRENGTH, type Character } from "@toony/schema";
import type { ProjectChange } from "../agent/protocol.js";
import { readPrivateBytes, writePrivateFile } from "../agent/storage.js";
import { AgentError } from "../agent/types.js";
import { setCharacterLora } from "../ops/characters.js";
import type { OpContext } from "../ops/write.js";
import { redactPaths } from "../redact.js";
import { trainingCommand } from "./engine.js";
import { AGENT_NEGATIVE_BASE, queueEngineWork } from "./jobs.js";
import { portraitRenderer } from "./portrait.js";

/** Views the portrait holds closely: the character's design from every side. */
export const TRAINING_VIEWS = [
  "head and shoulders, facing the viewer, neutral expression",
  "head and shoulders, three-quarter view to the left, neutral expression",
  "head and shoulders, three-quarter view to the right, slight smile",
  "profile view, head and shoulders, neutral expression",
  "upper body, facing the viewer, arms at the sides",
  "full body, standing, facing the viewer, whole outfit visible",
  "full body, walking, three-quarter view",
  "close-up of the face, surprised expression, eyebrows raised",
  "close-up of the face, worried expression",
  "close-up of the face, laughing",
  "upper body, looking down at something in the hands",
  "upper body, looking over the shoulder at the viewer",
  "head and shoulders, eyes closed, calm",
  "upper body, three-quarter view, speaking",
] as const;
/** Poses at the usual balance, so the LoRA also draws whole figures. */
export const TRAINING_POSES = [
  "full body, standing, facing the viewer, whole outfit visible, wide shot",
  "full body, walking along a street, three-quarter view, wide shot",
  "profile view, upper body, looking to the left",
  "three-quarter view from behind, looking over the shoulder",
  "upper body, sitting at a table, hands on the table",
  "full body, sitting on a bench, medium shot",
  "upper body, arms crossed, three-quarter view",
  "medium shot, holding a cup with both hands, looking down",
] as const;
export const TRAINING_STEPS_DEFAULT = 500;
const TRAINING_NEGATIVE =
  "multiple people, multiple views, character sheet, text, watermark, border, frame";
const BACKGROUND = "plain light grey background";
const SIZE = { width: 832, height: 1216 } as const;
/** Where a character's training set is drawn: the work's private agent files. */
export const TRAINING_DIR = ".toony/agent/training";
const SET_FILE = /^\d{2}\.(png|txt)$/;
/** The note a drawn set leaves beside its pictures until it is trained (or drawn again). */
const SET_NOTE = "set.json";
/** A set needs at least this many pictures left after the check to train well. */
export const TRAINING_SET_MIN = 10;
const OUTPUT_LINES_KEPT = 12;
/** A run longer than this is stopped as hung. */
const TRAINING_TIMEOUT_MS = 4 * 60 * 60 * 1000;

export interface TrainJobView {
  id: string;
  workId: string;
  characterId: string;
  name: string;
  /** "set" draws the training set and stops at "drawn" for the check; "train" trains on it. */
  kind: "set" | "train";
  state: "queued" | "drawing" | "drawn" | "training" | "finished" | "failed" | "stopped";
  /** Pictures of the set drawn so far, and how many it has. */
  drawn: number;
  total: number;
  message?: string;
  /** The LoRA's file name on the engine, once trained. */
  file?: string;
  createdAt: string;
  finishedAt?: string;
}

type Listener = (view: TrainJobView, change: ProjectChange | null) => void;

interface TrainRecord {
  view: TrainJobView;
  stop: boolean;
  kill: (() => void) | null;
  listeners: Set<Listener>;
  done: Promise<TrainJobView>;
}

const state = globalThis as typeof globalThis & {
  toonyTrainJobs?: Map<string, TrainRecord>;
};
function jobs(): Map<string, TrainRecord> {
  state.toonyTrainJobs ??= new Map();
  return state.toonyTrainJobs;
}

/** The word the LoRA learns the character under: their id's letters and digits, then "tny". */
export function triggerFor(characterId: string): string {
  const letters = characterId
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 36);
  return `${letters || "character"}tny`;
}

/** Split a command template into arguments and fill its placeholders; no shell is involved. */
export function trainingArgs(template: string, values: Record<string, string>): string[] {
  return template
    .split(/\s+/)
    .filter((part) => part !== "")
    .map((part) =>
      part.replace(/\{(character|dataset|name|steps)\}/g, (_, key) => values[key] ?? ""),
    );
}

/** The training folder, walked one part at a time below the work root; links are refused. */
async function setDir(root: string, characterId: string, clear: boolean): Promise<string> {
  let dir = root;
  for (const part of [...TRAINING_DIR.split("/"), characterId]) {
    dir = join(dir, part);
    let info: Awaited<ReturnType<typeof lstat>>;
    try {
      info = await lstat(dir);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      await mkdir(dir, { mode: 0o700 });
      info = await lstat(dir);
    }
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new AgentError("storage", "The work's agent files are not a plain folder.", 500);
    }
  }
  if (clear) {
    for (const name of await readdir(dir)) {
      if (SET_FILE.test(name) || name === SET_NOTE) await unlink(join(dir, name));
    }
  }
  return dir;
}

interface SetNote {
  characterId: string;
  trigger: string;
  drawnAt: string;
}

/** The numbers of a drawn set's pictures waiting for the check, or null when no set waits. */
export async function trainingSetWaiting(
  root: string,
  characterId: string,
): Promise<number[] | null> {
  const dir = await setDir(root, characterId, false);
  if ((await readPrivateBytes(join(dir, SET_NOTE))) === null) return null;
  return (await readdir(dir))
    .filter((name) => /^\d{2}\.png$/.test(name))
    .map((name) => Number(name.slice(0, 2)))
    .sort((a, b) => a - b);
}

/** A drawn set as one numbered contact sheet (JPEG), or null when no set waits. */
export async function trainingSetSheet(
  root: string,
  characterId: string,
): Promise<Uint8Array | null> {
  const numbers = await trainingSetWaiting(root, characterId);
  if (numbers === null) return null;
  const dir = await setDir(root, characterId, false);
  const pictures = await Promise.all(
    numbers.map(async (n) => {
      const label = String(n).padStart(2, "0");
      return {
        bytes:
          (await readPrivateBytes(join(dir, `${label}.png`), 32 * 1024 * 1024)) ?? new Uint8Array(),
        label: n === 0 ? "00 portrait" : label,
      };
    }),
  );
  return encodeCanvas(await composeContactSheet(pictures, { columns: 6, cellWidth: 160 }), "jpeg");
}

function publish(record: TrainRecord, change: ProjectChange | null = null): void {
  for (const listener of record.listeners) listener(structuredClone(record.view), change);
}

/** Run the training command; resolves with its exit code and its last lines of output. */
function runCommand(
  args: string[],
  env: Readonly<Record<string, string | undefined>>,
  record: TrainRecord,
): Promise<{ code: number | null; tail: string[] }> {
  return new Promise((resolve) => {
    const tail: string[] = [];
    const keep = (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split(/\r?\n|\r/)) {
        if (line.trim() === "") continue;
        tail.push(line.trim());
        if (tail.length > OUTPUT_LINES_KEPT) tail.shift();
      }
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(args[0] as string, args.slice(1), {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ...env } as NodeJS.ProcessEnv,
      });
    } catch (cause) {
      resolve({ code: null, tail: [String((cause as Error).message)] });
      return;
    }
    const timer = setTimeout(() => child.kill("SIGTERM"), TRAINING_TIMEOUT_MS);
    record.kill = () => child.kill("SIGTERM");
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    child.on("error", (error) => tail.push(error.message));
    child.on("close", (code) => {
      clearTimeout(timer);
      record.kill = null;
      resolve({ code, tail });
    });
  });
}

function finisher(record: TrainRecord) {
  return (next: Partial<TrainJobView>, change: ProjectChange | null = null) => {
    Object.assign(record.view, next, { finishedAt: new Date().toISOString() });
    publish(record, change);
    return structuredClone(record.view);
  };
}

/** Draw the training set from the portrait and stop at "drawn", for the check. */
async function drawSet(
  record: TrainRecord,
  ctx: OpContext,
  character: Character,
  portrait: Uint8Array,
  details: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
): Promise<TrainJobView> {
  const { view } = record;
  const finish = finisher(record);
  if (record.stop) return finish({ state: "stopped" });
  try {
    const dir = await setDir(ctx.root, character.id, true);
    const trigger = triggerFor(character.id);
    const lock = character.lockstring.trim();
    const caption = (what: string) => `${trigger}, ${lock}, ${what}, ${BACKGROUND}`;
    await writePrivateFile(join(dir, "00.png"), portrait);
    await writePrivateFile(join(dir, "00.txt"), caption("head and shoulders, facing the viewer"));
    view.drawn = 1;
    view.state = "drawing";
    publish(record);
    const negative = withCharacterAvoid(
      `${TRAINING_NEGATIVE}, ${AGENT_NEGATIVE_BASE}`,
      [character.id],
      [character],
    );
    const set = [
      ...TRAINING_VIEWS.map((what) => ({ what, strength: "strong" as const })),
      ...TRAINING_POSES.map((what) => ({ what, strength: undefined })),
    ];
    // Fresh seeds each time, so a set drawn again is a new set.
    const seed = randomInt(1, 2 ** 31 - 100);
    for (const [index, item] of set.entries()) {
      if (record.stop) return finish({ state: "stopped" });
      const result = await portraitRenderer()(
        ctx.root,
        {
          // Details the agent names are drawn but not captioned, so the LoRA learns them as part of
          // the trigger word rather than as words the cuts would have to repeat.
          prompt: `${lock}${details ? `, ${details}` : ""}, ${item.what}, ${BACKGROUND}`,
          negative,
          seed: seed + index,
          ...SIZE,
          reference: { bytes: portrait, name: `training-${character.id}.png` },
          ...(item.strength ? { referenceStrength: item.strength } : {}),
        },
        { cwd: ctx.root, out: () => {}, err: () => {}, env: { ...env } },
      );
      if ("error" in result) {
        return finish({
          state: "failed",
          message: `The artwork engine could not draw the training set: ${redactPaths(result.error)}`,
        });
      }
      if (!result.referenced) {
        return finish({
          state: "failed",
          message:
            "The artwork engine drew without the portrait, so this set cannot be used. Install the portrait nodes and draw the set again.",
        });
      }
      const n = String(index + 1).padStart(2, "0");
      await writePrivateFile(join(dir, `${n}.png`), result.bytes);
      await writePrivateFile(join(dir, `${n}.txt`), caption(item.what));
      view.drawn = index + 2;
      publish(record);
    }
    if (record.stop) return finish({ state: "stopped" });
    const note: SetNote = { characterId: character.id, trigger, drawnAt: new Date().toISOString() };
    await writePrivateFile(join(dir, SET_NOTE), JSON.stringify(note));
    return finish({ state: "drawn" });
  } catch (cause) {
    const message =
      cause instanceof Error
        ? redactPaths(cause.message)
        : "Drawing the set stopped with an error.";
    return finish({ state: "failed", message });
  }
}

/** Train on the drawn set without the dropped pictures, then record the LoRA on the character. */
async function trainSet(
  record: TrainRecord,
  ctx: OpContext,
  character: Character,
  drop: readonly number[],
  steps: number,
  env: Readonly<Record<string, string | undefined>>,
): Promise<TrainJobView> {
  const { view } = record;
  const finish = finisher(record);
  if (record.stop) return finish({ state: "stopped" });
  const template = trainingCommand(env);
  if (template === null)
    return finish({ state: "failed", message: "Training is not set up on this computer." });
  try {
    const dir = await setDir(ctx.root, character.id, false);
    const note = JSON.parse(
      Buffer.from((await readPrivateBytes(join(dir, SET_NOTE))) ?? new Uint8Array()).toString(
        "utf8",
      ) || "null",
    ) as SetNote | null;
    if (note === null)
      return finish({ state: "failed", message: "The training set is gone; draw it again." });
    for (const n of drop) {
      const label = String(n).padStart(2, "0");
      for (const ext of ["png", "txt"]) await unlink(join(dir, `${label}.${ext}`)).catch(() => {});
    }
    view.state = "training";
    publish(record);
    const args = trainingArgs(template, {
      character: character.id,
      dataset: dir,
      name: view.name,
      steps: String(steps),
    });
    const { code, tail } = await runCommand(args, env, record);
    if (record.stop) return finish({ state: "stopped" });
    if (code !== 0) {
      const said = redactPaths(tail.slice(-3).join(" ")).slice(0, 400);
      return finish({
        state: "failed",
        message: `The training command failed${said ? `: ${said}` : "."}`,
      });
    }
    await unlink(join(dir, SET_NOTE)).catch(() => {});
    const file = `${view.name}.safetensors`;
    const change = await setCharacterLora(ctx, character.id, {
      file,
      strength: CHARACTER_LORA_STRENGTH,
      trigger: note.trigger,
    });
    return finish({ state: "finished", file }, change);
  } catch (cause) {
    const message =
      cause instanceof Error ? redactPaths(cause.message) : "Training stopped with an error.";
    return finish({ state: "failed", message });
  }
}

function enqueue(
  ctx: OpContext,
  character: Character,
  kind: TrainJobView["kind"],
  total: number,
  work: (record: TrainRecord) => Promise<TrainJobView>,
  listener?: Listener,
): TrainJobView {
  const view: TrainJobView = {
    id: randomUUID(),
    workId: ctx.workId,
    characterId: character.id,
    kind,
    name: `toony-${triggerFor(character.id).slice(0, -3)}-${Date.now().toString(36)}`,
    state: "queued",
    drawn: 0,
    total,
    createdAt: new Date().toISOString(),
  };
  const record: TrainRecord = {
    view,
    stop: false,
    kill: null,
    listeners: new Set(listener ? [listener] : []),
    done: Promise.resolve(view),
  };
  record.done = queueEngineWork(() => work(record));
  jobs().set(view.id, record);
  publish(record);
  return structuredClone(view);
}

/**
 * Queue drawing a training set for `character` from their portrait bytes. The
 * job stops at "drawn": the agent checks the set (trainingSetSheet) and then
 * starts the training with the pictures to drop (startTraining).
 */
export function startTrainingSet(
  params: {
    ctx: OpContext;
    character: Character;
    portrait: Uint8Array;
    /** Details of the portrait the lockstring leaves open, drawn into every picture (English). */
    details?: string;
    env?: Readonly<Record<string, string | undefined>>;
  },
  listener?: Listener,
): TrainJobView {
  const total = 1 + TRAINING_VIEWS.length + TRAINING_POSES.length;
  return enqueue(
    params.ctx,
    params.character,
    "set",
    total,
    (record) =>
      drawSet(
        record,
        params.ctx,
        params.character,
        params.portrait,
        params.details?.trim() || undefined,
        params.env ?? process.env,
      ),
    listener,
  );
}

/**
 * Queue training on the character's drawn set without the `drop` pictures. Refuses
 * when no set waits, when the kept portrait (0) is dropped, or when fewer than
 * TRAINING_SET_MIN pictures would be left.
 */
export async function startTraining(
  params: {
    ctx: OpContext;
    character: Character;
    drop: readonly number[];
    steps?: number;
    env?: Readonly<Record<string, string | undefined>>;
  },
  listener?: Listener,
): Promise<TrainJobView | { refused: string }> {
  const { ctx, character } = params;
  const numbers = await trainingSetWaiting(ctx.root, character.id);
  if (numbers === null) return { refused: "no-set" };
  const drop = [...new Set(params.drop)];
  if (drop.includes(0)) return { refused: "portrait" };
  const unknown = drop.filter((n) => !numbers.includes(n));
  if (unknown.length > 0) return { refused: `unknown:${unknown.join(",")}` };
  const left = numbers.length - drop.length;
  if (left < TRAINING_SET_MIN) return { refused: `too-few:${left}` };
  return enqueue(
    ctx,
    character,
    "train",
    left,
    (record) =>
      trainSet(
        record,
        ctx,
        character,
        drop,
        params.steps ?? TRAINING_STEPS_DEFAULT,
        params.env ?? process.env,
      ),
    listener,
  );
}

export function getTrainJob(id: string): TrainJobView | null {
  const record = jobs().get(id);
  return record ? structuredClone(record.view) : null;
}

/** The work's training jobs, newest first. */
export function listTrainJobs(workId: string): TrainJobView[] {
  return [...jobs().values()]
    .map((record) => record.view)
    .filter((view) => view.workId === workId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((view) => structuredClone(view));
}

/** Wait for a training job to end, at most `ms`; null when it is still going. */
export async function waitForTrainJob(id: string, ms: number): Promise<TrainJobView | null> {
  const record = jobs().get(id);
  if (!record) return null;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), ms).unref());
  return Promise.race([record.done, timeout]);
}

/** Stop a training job: before it starts, between pictures, or by ending the training command. */
export function stopTrainJob(id: string): TrainJobView | null {
  const record = jobs().get(id);
  if (!record) return null;
  record.stop = true;
  record.kill?.();
  return structuredClone(record.view);
}

/** Whether a training job is queued or running for the work. */
export function trainingActive(workId: string): boolean {
  return listTrainJobs(workId).some((view) =>
    ["queued", "drawing", "training"].includes(view.state),
  );
}
