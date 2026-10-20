// Episode ordering and new episode ids.
//
// An episode id is its folder name, and the folder name is the only order a
// project records. Plain string order puts `ep-10` before `ep-2`, so every
// place that lists episodes sorts with `compareEpisodeIds`, which compares runs
// of digits by their numeric value. New ids are zero-padded (`ep-001`) so the
// two orders agree for every id Toony itself creates.

/** Split an id into alternating text and digit runs. */
function runs(id: string): string[] {
  return id.match(/\d+|\D+/g) ?? [];
}

/**
 * Order two episode ids so `ep-2` comes before `ep-10`. Digit runs compare by
 * value; when two ids differ only in zero padding (`ep-02`, `ep-2`), the less
 * padded one comes first, so the order is still total and deterministic;
 * text runs compare by code unit, never by locale, so the order is the same on
 * every machine. Ties fall back to plain code-unit order.
 */
export function compareEpisodeIds(a: string, b: string): number {
  const left = runs(a);
  const right = runs(b);
  const length = Math.min(left.length, right.length);
  let padding = 0;
  for (let i = 0; i < length; i++) {
    const x = left[i] ?? "";
    const y = right[i] ?? "";
    if (x === y) continue;
    const xDigits = /^\d/.test(x);
    const yDigits = /^\d/.test(y);
    if (xDigits && yDigits) {
      const xValue = x.replace(/^0+(?=\d)/, "");
      const yValue = y.replace(/^0+(?=\d)/, "");
      if (xValue.length !== yValue.length) return xValue.length - yValue.length;
      if (xValue !== yValue) return xValue < yValue ? -1 : 1;
      if (padding === 0) padding = x.length - y.length;
      continue;
    }
    return x < y ? -1 : 1;
  }
  if (left.length !== right.length) return left.length - right.length;
  if (padding !== 0) return padding;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Episode ids in reading order. Returns a new array. */
export function sortEpisodeIds(ids: readonly string[]): string[] {
  return [...ids].sort(compareEpisodeIds);
}

/** Prefix of every episode id Toony creates. */
export const EPISODE_ID_PREFIX = "ep-";

/**
 * The next new episode id: one past the highest `ep-<number>` already present,
 * zero-padded to three digits (`ep-001`, `ep-002`, ... `ep-1000`). Ids that do
 * not follow the pattern are ignored, and an id is never reused while a folder
 * that folds onto it exists.
 */
export function nextEpisodeId(existing: readonly string[]): string {
  let highest = 0;
  for (const id of existing) {
    const match = /^ep-(\d+)$/i.exec(id);
    if (match?.[1] !== undefined) highest = Math.max(highest, Number(match[1]));
  }
  const taken = new Set(existing.map((id) => id.toLowerCase()));
  for (let n = highest + 1; ; n++) {
    const candidate = `${EPISODE_ID_PREFIX}${String(n).padStart(3, "0")}`;
    if (!taken.has(candidate)) return candidate;
  }
}
