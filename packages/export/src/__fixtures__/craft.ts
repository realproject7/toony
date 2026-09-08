// Two episodes with deliberately opposite craft, for the measurement tests.
//
// The point of these fixtures is discrimination: a craft metric that cannot tell
// these two apart is a broken measurement, not a weak signal. So they differ on
// every axis the analyzer reads — gutter budget, cut heights and their variation,
// cut density, elements floating in empty space, art inset, and the palette's
// value, contrast, saturation, and hue.
//
//   restless — many short cuts of varying height, wide gutters, art inset in a
//              white column with a small element floating in the empty space
//              below it, dark high-contrast blue art
//   calm     — a few tall cuts of equal height, hairline gutters, full-bleed
//              light low-contrast green art
//
// Original content: every raster is drawn here from flat rectangles.

import { mkdir, writeFile } from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";
import { buildInitialProject, writeProject } from "@toony/project-io";
import type { Cut, Project, SequenceItem, Transition } from "@toony/schema";

const ART_WIDTH = 480;

interface ArtStyle {
  /** Flat margin on each side of the art, in source px. */
  margin: number;
  /** The two alternating stripe colors of the art body. */
  stripes: [string, string];
  /** Stripe width in source px — narrow stripes vary a row more. */
  stripeWidth: number;
  /** Height of the flat empty region under the art body, in source px. */
  emptyBand: number;
  /** Height of the element floating in that empty region, in source px. */
  floatingElement: number;
}

const RESTLESS_ART: ArtStyle = {
  margin: 96,
  stripes: ["#04060f", "#5f8fff"],
  stripeWidth: 6,
  emptyBand: 60,
  floatingElement: 10,
};

const CALM_ART: ArtStyle = {
  margin: 0,
  stripes: ["#eaf3e4", "#a9c795"],
  stripeWidth: 16,
  emptyBand: 0,
  floatingElement: 0,
};

/** Draw one cut's art: flat margins, a striped body, then an empty band. */
function drawArt(height: number, style: ArtStyle): Uint8Array {
  const canvas = createCanvas(ART_WIDTH, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, ART_WIDTH, height);
  const bodyHeight = height - style.emptyBand;
  for (let x = style.margin; x < ART_WIDTH - style.margin; x += style.stripeWidth) {
    const even = Math.floor(x / style.stripeWidth) % 2 === 0;
    ctx.fillStyle = even ? style.stripes[0] : style.stripes[1];
    ctx.fillRect(x, 0, style.stripeWidth, bodyHeight);
  }
  if (style.emptyBand > 0) {
    // Flat empty space under the art, with one small element floating in it —
    // the render's own version of a bubble sitting in the gutter.
    ctx.fillStyle = "#f2f0ec";
    ctx.fillRect(0, bodyHeight, ART_WIDTH, style.emptyBand);
    if (style.floatingElement > 0) {
      const top = bodyHeight + Math.round((style.emptyBand - style.floatingElement) / 2);
      ctx.fillStyle = "#101010";
      ctx.fillRect(ART_WIDTH * 0.3, top, ART_WIDTH * 0.4, style.floatingElement);
    }
  }
  return new Uint8Array(canvas.toBuffer("image/png"));
}

function transition(id: string, gutterHeight: number): Transition {
  return {
    id,
    type: "gutter",
    gutterHeight,
    text: null,
    sfx: null,
    agentNote: null,
    humanNote: null,
    image: null,
    reviewStatus: "draft",
  };
}

interface RhythmSpec {
  name: string;
  /** Source art height per cut, in px. */
  cutHeights: number[];
  gutterHeight: number;
  style: ArtStyle;
}

/** The two opposed rhythms the discrimination tests measure. */
export const RESTLESS: RhythmSpec = {
  name: "Restless",
  cutHeights: [150, 210, 130, 260, 170, 230],
  gutterHeight: 200,
  style: RESTLESS_ART,
};

export const CALM: RhythmSpec = {
  name: "Calm",
  cutHeights: [900, 900, 900],
  gutterHeight: 20,
  style: CALM_ART,
};

function buildProject(spec: RhythmSpec): Project {
  const project = buildInitialProject(spec.name);
  const bundle = project.episodes[0];
  if (!bundle) throw new Error("fixture missing episode");

  const cuts: Cut[] = [];
  const transitions: Transition[] = [];
  const sequence: SequenceItem[] = [];
  spec.cutHeights.forEach((_, index) => {
    const id = `cut-${String(index + 1).padStart(3, "0")}`;
    cuts.push({
      id,
      image: { clean: `episodes/ep-001/assets/clean/${id}.png`, final: null },
      imagePrompt: "",
      negativePrompt: "",
    });
    if (index > 0) {
      const trId = `tr-${String(index).padStart(3, "0")}`;
      transitions.push(transition(trId, spec.gutterHeight));
      sequence.push({ type: "transition", id: trId });
    }
    sequence.push({ type: "cut", id });
  });
  // The first cut must lead; the loop pushes each transition before its cut.
  bundle.episode.sequence = sequence;
  bundle.cuts = cuts;
  bundle.transitions = transitions;
  bundle.lettering = [];
  return project;
}

/** Write one rhythm's project and its cut art under `root`. */
export async function writeRhythmProject(root: string, spec: RhythmSpec): Promise<Project> {
  const project = buildProject(spec);
  await writeProject(root, project);
  const dir = `${root}/episodes/ep-001/assets/clean`;
  await mkdir(dir, { recursive: true });
  for (let i = 0; i < spec.cutHeights.length; i++) {
    const id = `cut-${String(i + 1).padStart(3, "0")}`;
    await writeFile(`${dir}/${id}.png`, drawArt(spec.cutHeights[i] as number, spec.style));
  }
  return project;
}
