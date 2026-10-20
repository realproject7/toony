// Client-safe export view model: the outputs the export page offers, how the
// page's few options map onto an export request, the layout preview, and the
// download URLs. No Node imports and no `@/` alias, so the browser panel, the
// server routes and the Node test runner all share it.

import { BUILTIN_OUTPUTS, SOCIAL_FRAMES } from "@toony/export/defaults";
import {
  type LayoutBand,
  type LayoutPlan,
  layoutBands,
  planOutput,
  resolveOutputOptions,
} from "@toony/export/layout";
import type { ExportOptionValues, Transition } from "@toony/schema";

/** The outputs the export page lists, in order. */
export type OutputChoice = "strip" | "cuts" | "instagram" | "x" | "webtoon";

export interface OutputInfo {
  id: OutputChoice;
  title: string;
  description: string;
}

export const OUTPUT_CHOICES: readonly OutputInfo[] = [
  { id: "strip", title: "Episode strip", description: "The whole episode as one tall image." },
  { id: "cuts", title: "Cut images", description: "One image per cut, with its lettering." },
  { id: "instagram", title: "Instagram", description: "Carousel images, up to 20 per post." },
  { id: "x", title: "X", description: "Wide 16:9 images, up to 4 per post." },
  {
    id: "webtoon",
    title: "Webtoon platforms",
    description: "800 px wide JPEG parts, ready to upload.",
  },
];

/** The few options each output offers. Every field has a sensible default. */
export interface OutputSettings {
  strip: { width: number; split: boolean; partHeight: number };
  cuts: { width: number; margin: number; textCards: boolean };
  instagram: { shape: "portrait" | "square"; tallCuts: "split" | "fit" };
  x: { tallCuts: "split" | "fit" };
  webtoon: Record<string, never>;
}

export function defaultSettings(referenceWidth: number): OutputSettings {
  return {
    strip: { width: referenceWidth, split: false, partHeight: 1280 },
    cuts: { width: 1200, margin: 0, textCards: false },
    instagram: { shape: "portrait", tallCuts: "split" },
    x: { tallCuts: "split" },
    webtoon: {},
  };
}

/** What `POST /api/export` runs: an output id and the options the page set. */
export interface ExportRequest {
  output: string;
  options: ExportOptionValues;
}

/** The export request for a choice and its settings. */
export function exportRequest(choice: OutputChoice, settings: OutputSettings): ExportRequest {
  switch (choice) {
    case "strip": {
      const { width, split, partHeight } = settings.strip;
      return { output: "strip", options: split ? { width, sliceHeight: partHeight } : { width } };
    }
    case "cuts": {
      const { width, margin, textCards } = settings.cuts;
      return { output: "cuts", options: { width, margin, textCards } };
    }
    case "instagram":
      return {
        output: settings.instagram.shape === "square" ? "instagram-square" : "instagram",
        options: { tallCuts: settings.instagram.tallCuts },
      };
    case "x":
      return { output: "x", options: { tallCuts: settings.x.tallCuts } };
    case "webtoon":
      return { output: "webtoon", options: {} };
  }
}

/** The page choice an output folder belongs to. */
export function choiceForOutput(output: string): OutputChoice | null {
  if (output === "instagram" || output === "instagram-square") return "instagram";
  return OUTPUT_CHOICES.some((choice) => choice.id === output) ? (output as OutputChoice) : null;
}

/** One sequence item as the page hands it to the browser preview. */
export type PreviewItem =
  | {
      type: "cut";
      id: string;
      panelAspect?: number;
      art: { width: number; height: number; src: string } | null;
    }
  | { type: "transition"; id: string; transition: Transition };

/** Layout bands for the preview, built from the same planner the engine uses. */
export function previewBands(items: readonly PreviewItem[], referenceWidth: number): LayoutBand[] {
  const cuts = items.flatMap((item) =>
    item.type === "cut"
      ? [
          {
            id: item.id,
            image: null,
            imagePrompt: "",
            negativePrompt: "",
            panelAspect: item.panelAspect,
          },
        ]
      : [],
  );
  const transitions = items.flatMap((item) =>
    item.type === "transition" ? [item.transition] : [],
  );
  const art = new Map(
    items.flatMap((item) =>
      item.type === "cut" && item.art ? [[item.id, item.art] as const] : [],
    ),
  );
  return layoutBands({
    bundle: {
      episode: {
        id: "preview",
        title: "",
        sequence: items.map((item) => ({ type: item.type, id: item.id })),
      } as unknown as Parameters<typeof layoutBands>[0]["bundle"]["episode"],
      cuts,
      transitions,
    },
    referenceWidth,
    artSize: (cutId) => {
      const size = art.get(cutId);
      return size ? { width: size.width, height: size.height } : null;
    },
  });
}

/** The layout of the files an export request would write, for the preview. */
export function previewPlan(
  bands: readonly LayoutBand[],
  request: ExportRequest,
  referenceWidth: number,
): LayoutPlan {
  const builtin = BUILTIN_OUTPUTS.find((output) => output.id === request.output);
  const kind = builtin?.kind ?? "strip";
  const options = resolveOutputOptions(
    kind,
    { ...(builtin?.options ?? {}), ...request.options },
    referenceWidth,
  );
  return planOutput(bands, options, referenceWidth);
}

/** A short description of the result size, for example "1080 × 1350 · 12 images". */
export function planSummary(plan: LayoutPlan): string {
  const count = plan.files.length;
  if (count === 0) return "Nothing to export yet.";
  const first = plan.files[0];
  const sameSize = plan.files.every((f) => f.width === first?.width && f.height === first?.height);
  const size = sameSize ? `${first?.width} × ${first?.height}` : `${first?.width} px wide`;
  const posts = plan.files.at(-1)?.post;
  const postText = posts && posts > 1 ? ` in ${posts} posts` : "";
  return `${size} · ${count} ${count === 1 ? "image" : "images"}${postText}`;
}

/** The frame label shown for social choices. */
export function frameLabel(output: string): string | null {
  const frame = BUILTIN_OUTPUTS.find((o) => o.id === output)?.options.frame;
  return frame ? SOCIAL_FRAMES[frame].label : null;
}

function query(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

/** Download URL of one exported file. `revision` (a sha256) keeps thumbnails fresh. */
export function exportFileHref(
  workId: string,
  episodeId: string,
  output: string,
  name: string,
  revision?: string,
): string {
  return `/api/export/download?${query({
    work: workId,
    episode: episodeId,
    output,
    file: name,
    ...(revision ? { rev: revision.slice(0, 16) } : {}),
  })}`;
}

/** Download URL of the ZIP of every file an output wrote. */
export function exportZipHref(workId: string, episodeId: string, output: string): string {
  return `/api/export/download?${query({ work: workId, episode: episodeId, output, all: "1" })}`;
}

/** Human-readable byte size. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
