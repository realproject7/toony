// Image views (CMP-01): a cut shows part of its picture, and a picture can feed
// several cuts. The source pixels are never rewritten: a view is four numbers on
// the cut, and removing it shows the whole picture again. Reusing another cut's
// picture copies it into this cut first, so redrawing one cut never changes
// what another shows.

import { importedAssetPath, importImageBytes, loadProject } from "@toony/project-io";
import { type ImageView, IssueCollector, validateImageView } from "@toony/schema";
import type { ProjectChange } from "../agent/protocol.js";
import { readProjectPicture } from "./artwork.js";
import { OpError } from "./errors.js";
import { cutLabel, findEpisode } from "./labels.js";
import { assertSafeId, episodeFiles } from "./paths.js";
import { assertEpisodeValid, writeEpisodeRecords } from "./records.js";
import { type OpContext, withProjectWrite } from "./write.js";

function checkView(view: ImageView | null): ImageView | null {
  if (view === null) return null;
  const issues = new IssueCollector();
  validateImageView(view, "imageView", issues);
  const result = issues.result();
  if (!result.valid) {
    throw new OpError("invalid", "Keep the frame inside the picture and not too small.");
  }
  // Four decimals is far below a pixel of any picture Toony accepts.
  const round = (n: number) => Math.round(n * 10_000) / 10_000;
  return {
    x: round(view.x),
    y: round(view.y),
    width: round(view.width),
    height: round(view.height),
  };
}

async function writeView(
  root: string,
  episodeId: string,
  cutId: string,
  view: ImageView | null,
): Promise<void> {
  const loaded = await loadProject(root);
  const bundle = findEpisode(loaded, episodeId);
  if (bundle === undefined) throw new OpError("not-found", "This episode does not exist.");
  const cuts = bundle.cuts.map((cut) => {
    if (cut.id !== cutId) return cut;
    const { imageView: _old, ...rest } = cut;
    return view === null ? rest : { ...rest, imageView: view };
  });
  const next = { ...bundle, cuts };
  assertEpisodeValid(loaded, next);
  await writeEpisodeRecords(root, bundle, next);
}

/** Show part of a cut's picture, or (null) all of it again. One undoable change. */
export async function setCutImageView(
  ctx: OpContext,
  episodeId: string,
  cutId: string,
  view: ImageView | null,
): Promise<ProjectChange | null> {
  assertSafeId(episodeId, "episode");
  assertSafeId(cutId, "cut");
  const clean = checkView(view);
  const { change } = await withProjectWrite(
    ctx,
    {
      summary: "Framed a cut",
      scopes: [{ kind: "artwork", episodeId, cutId }],
      files: [episodeFiles(episodeId).cuts],
    },
    async (tx) => {
      const cut = findEpisode(tx.before, episodeId)?.cuts.find((c) => c.id === cutId);
      if (cut === undefined) throw new OpError("not-found", "This cut is not in the episode.");
      if (!(cut.image?.final ?? cut.image?.clean)) {
        throw new OpError("refused", "This cut has no picture to frame yet.");
      }
      await writeView(tx.root, episodeId, cutId, clean);
      const label = cutLabel(tx.before, episodeId, cutId);
      tx.setSummary(clean === null ? `Showed all of ${label}'s picture` : `Framed ${label}`);
    },
  );
  return change;
}

/**
 * Show part of another cut's picture in this cut: the picture is copied into
 * this cut (the slot it shows), then framed. One undoable change.
 */
export async function reuseCutPicture(
  ctx: OpContext,
  episodeId: string,
  cutId: string,
  fromCutId: string,
  view: ImageView | null,
): Promise<ProjectChange | null> {
  assertSafeId(episodeId, "episode");
  assertSafeId(cutId, "cut");
  assertSafeId(fromCutId, "cut");
  if (fromCutId === cutId) throw new OpError("invalid", "Choose another cut's picture.");
  const clean = checkView(view);
  const files = episodeFiles(episodeId);
  const { change } = await withProjectWrite(
    ctx,
    {
      summary: "Reused a picture",
      scopes: [{ kind: "artwork", episodeId, cutId }],
      files: [files.cuts, `${files.folder}/logs/ingest.json`],
    },
    async (tx) => {
      const bundle = findEpisode(tx.before, episodeId);
      const cut = bundle?.cuts.find((c) => c.id === cutId);
      const from = bundle?.cuts.find((c) => c.id === fromCutId);
      if (cut === undefined || from === undefined) {
        throw new OpError("not-found", "This cut is not in the episode.");
      }
      const ref = from.image?.final ?? from.image?.clean ?? null;
      if (ref === null) throw new OpError("refused", "That cut has no picture yet.");
      const bytes = await readProjectPicture(tx.root, ref);
      if (bytes === null) throw new OpError("refused", "That cut's picture could not be read.");
      const slot: "clean" | "final" = cut.image?.final ? "final" : "clean";
      const target = { kind: "cut" as const, episodeId, cutId, slot };
      const asset = importedAssetPath(target, bytes);
      if (asset === null) throw new OpError("invalid", "That cut's picture could not be read.");
      await tx.track([asset]);
      await importImageBytes(tx.root, target, bytes);
      await writeView(tx.root, episodeId, cutId, clean);
      tx.setSummary(
        `Used ${cutLabel(tx.before, episodeId, fromCutId).replace(/ of .*$/, "")}'s picture in ${cutLabel(tx.before, episodeId, cutId)}`,
      );
    },
  );
  return change;
}
