// Named fixtures for export tests: a rich project (enough lettering for the
// PlotLink markdown minimum) and real generated cut PNGs. Original test content;
// asset paths are project-relative.

import { mkdir, writeFile } from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";
import { buildInitialProject } from "@toony/project-io";
import type { BubbleKind, LetteringOverlay, Project } from "@toony/schema";

function overlay(
  id: string,
  cutId: string,
  speaker: string,
  kind: BubbleKind,
  text: string,
  x: number,
  y: number,
): LetteringOverlay {
  return {
    id,
    cutId,
    speaker,
    kind,
    text,
    font: "sans-serif",
    fill: "#ffffff",
    opacity: 1,
    border: null,
    tail: kind === "speech" ? { x: x + 0.1, y: y + 0.3 } : null,
    geometry: { x, y, width: 0.5, height: 0.18 },
    overflow: false,
    reviewStatus: "draft",
  };
}

/** A two-cut episode with a scene-break transition and dialogue-rich lettering. */
export function buildExportProject(): Project {
  const project = buildInitialProject("Export Sample");
  const bundle = project.episodes[0];
  if (!bundle) throw new Error("fixture missing episode");

  const transition = bundle.transitions[0];
  if (transition) {
    transition.type = "scene-break";
    transition.text = "Three days later, down at the lantern harbor";
  }

  const cut1 = bundle.cuts[0];
  const cut2 = bundle.cuts[1];
  if (cut1) cut1.image = { clean: "episodes/ep-001/assets/clean/cut-001.png", final: null };
  if (cut2) cut2.image = { clean: "episodes/ep-001/assets/clean/cut-002.png", final: null };

  bundle.lettering = [
    overlay(
      "ov-1",
      "cut-001",
      "Mira",
      "speech",
      "The tide remembers every name we have ever spoken to it.",
      0.08,
      0.08,
    ),
    overlay(
      "ov-2",
      "cut-001",
      "Jun",
      "speech",
      "Then it must be very tired of carrying ours by now.",
      0.4,
      0.45,
    ),
    overlay(
      "ov-3",
      "cut-001",
      "Mira",
      "thought",
      "He hides worry behind a joke; I have learned to listen past it.",
      0.08,
      0.74,
    ),
    overlay(
      "ov-4",
      "cut-002",
      "Narration",
      "narration",
      "Dawn arrived without asking, the way it always does on the days that change everything.",
      0.05,
      0.05,
    ),
    overlay(
      "ov-5",
      "cut-002",
      "Jun",
      "speech",
      "Look — the festival lanterns are still lit from last night.",
      0.32,
      0.5,
    ),
    overlay(
      "ov-6",
      "cut-002",
      "Mira",
      "whisper",
      "Make a wish before the wind decides it for you.",
      0.08,
      0.78,
    ),
  ];
  return project;
}

/** A valid project with `count` cuts and no transitions (for limit tests). */
export function buildManyCutsProject(count: number): Project {
  const project = buildInitialProject("Many Cuts");
  const bundle = project.episodes[0];
  if (!bundle) throw new Error("fixture missing episode");
  const ids = Array.from({ length: count }, (_, i) => `cut-${String(i + 1).padStart(2, "0")}`);
  bundle.episode.sequence = ids.map((id) => ({ type: "cut", id }) as const);
  bundle.cuts = ids.map((id) => ({ id, image: null, imagePrompt: "", negativePrompt: "" }));
  bundle.transitions = [];
  bundle.lettering = [];
  return project;
}

/** Write a real opaque PNG to each cut's referenced asset path under `root`. */
export async function writeCutImages(root: string): Promise<void> {
  for (const [name, color] of [
    ["cut-001", "#6a8fb5"],
    ["cut-002", "#b58a6a"],
  ] as const) {
    const canvas = createCanvas(240, 336);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 240, 336);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(20, 20, 200, 60);
    const dir = `${root}/episodes/ep-001/assets/clean`;
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}/${name}.png`, canvas.toBuffer("image/png"));
  }
}
