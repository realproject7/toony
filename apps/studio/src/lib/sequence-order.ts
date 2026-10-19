// Cut order helpers for the episode editor's sequence rail. The rail labels
// cuts "Cut 3" by reading order, and reorders them through the cut route's
// `move` operation, which takes the cut to place a cut after (`null` = first).
// Pure, so the Node tests cover the edge cases (first, last, single cut).

export interface OrderItem {
  type: "cut" | "transition";
  id: string;
}

/** Cut ids in reading order. */
export function cutOrder(sequence: readonly OrderItem[]): string[] {
  return sequence.filter((item) => item.type === "cut").map((item) => item.id);
}

/** 1-based position of a cut in reading order, or 0 when absent. */
export function cutNumberIn(sequence: readonly OrderItem[], cutId: string): number {
  return cutOrder(sequence).indexOf(cutId) + 1;
}

/**
 * Where `move` should place `cutId` to step it one place up or down:
 * the cut to place it after, `null` for first, or `undefined` when it cannot
 * move that way (already first or last, or unknown).
 */
export function stepTarget(
  sequence: readonly OrderItem[],
  cutId: string,
  direction: "up" | "down",
): string | null | undefined {
  const order = cutOrder(sequence);
  const index = order.indexOf(cutId);
  if (index === -1) return undefined;
  if (direction === "up") {
    if (index === 0) return undefined;
    return index >= 2 ? (order[index - 2] ?? null) : null;
  }
  if (index === order.length - 1) return undefined;
  return order[index + 1];
}

/**
 * Where `move` should place `cutId` when it is dropped before the cut now at
 * `dropIndex` (0-based among cuts; `order.length` means the end). Returns
 * `undefined` when the drop does not change the order.
 */
export function dropTarget(
  sequence: readonly OrderItem[],
  cutId: string,
  dropIndex: number,
): string | null | undefined {
  const order = cutOrder(sequence);
  const from = order.indexOf(cutId);
  if (from === -1) return undefined;
  const index = Math.max(0, Math.min(order.length, Math.round(dropIndex)));
  if (index === from || index === from + 1) return undefined;
  const rest = order.filter((id) => id !== cutId);
  const insertAt = index > from ? index - 1 : index;
  return insertAt === 0 ? null : (rest[insertAt - 1] ?? null);
}

/** The cut order after moving `cutId` behind `after` (`null` = first). */
export function orderAfterMove(
  order: readonly string[],
  cutId: string,
  after: string | null,
): string[] {
  const rest = order.filter((id) => id !== cutId);
  if (after === null) return [cutId, ...rest];
  const at = rest.indexOf(after);
  if (at === -1) return [...order];
  return [...rest.slice(0, at + 1), cutId, ...rest.slice(at + 1)];
}

/**
 * The transition that goes when `cutId` is removed, matching the cut route:
 * after the first cut, before the last cut, and, for a cut between two
 * transitions, the one after it (the one before it then joins the new
 * neighbours). `null` when no transition goes.
 */
export function transitionRemovedWith(
  sequence: readonly OrderItem[],
  cutId: string,
): { id: string; position: "before" | "after" } | null {
  const order = cutOrder(sequence);
  const index = order.indexOf(cutId);
  if (index === -1 || order.length <= 1) return null;
  const at = sequence.findIndex((item) => item.type === "cut" && item.id === cutId);
  const previous = sequence[at - 1];
  const next = sequence[at + 1];
  const before = previous?.type === "transition" ? previous : undefined;
  const after = next?.type === "transition" ? next : undefined;
  if (index === 0) return after ? { id: after.id, position: "after" } : null;
  if (index === order.length - 1) return before ? { id: before.id, position: "before" } : null;
  return before && after ? { id: after.id, position: "after" } : null;
}
