// A cut's declared panel shape → the generation latent (#237).
//
// `Cut.panelAspect` is a height in COLUMN WIDTHS — the unit a craft band grades
// panel height in — and generation needs pixels, so the shape has to be resolved
// against a column before it can reach anything. This module is that whole
// conversion: pure, deterministic, and therefore assertable without a live
// provider, the same way `./palette.ts` is for the colour clause.
//
// Only the HEIGHT is derived. The column is the workflow's own latent width (the
// pack's decision about what column it draws at) or `--width` when the operator
// pins one; nothing here invents a width.

/**
 * Latent sizes are 8px blocks: ComfyUI's `EmptyLatentImage` divides both axes by
 * 8, and a size off that grid is not a size the sampler can run. So a declared
 * shape is snapped to the grid, and the resolved height — not the declared
 * ratio — is what the cut is actually generated at.
 */
export const LATENT_BLOCK_PX = 8;

/**
 * The latent height a cut of `panelAspect` takes at a column of `width` px,
 * snapped to the latent grid and never smaller than one block.
 */
export function latentHeightFor(width: number, panelAspect: number): number {
  const snapped = Math.round((width * panelAspect) / LATENT_BLOCK_PX) * LATENT_BLOCK_PX;
  return Math.max(LATENT_BLOCK_PX, snapped);
}
