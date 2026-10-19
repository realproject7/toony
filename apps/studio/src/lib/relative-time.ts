// "Last edited" labels: short, plain and locale-free, so the server render and
// the browser agree. Within a minute it is "Just now"; within the past week it
// counts minutes, hours or days; older dates show the calendar day.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
}

/** A label for `iso` as seen at `now`. Empty for a missing or invalid time. */
export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const then = new Date(iso);
  const time = then.getTime();
  if (Number.isNaN(time) || time <= 0) return "";
  const diff = now.getTime() - time;
  if (diff < MINUTE) return "Just now";
  if (diff < HOUR) return plural(Math.floor(diff / MINUTE), "minute");
  if (diff < DAY) return plural(Math.floor(diff / HOUR), "hour");
  if (diff < 2 * DAY) return "Yesterday";
  if (diff < 7 * DAY) return plural(Math.floor(diff / DAY), "day");
  const month = MONTHS[then.getUTCMonth()] ?? "";
  const sameYear = then.getUTCFullYear() === now.getUTCFullYear();
  return sameYear
    ? `${month} ${then.getUTCDate()}`
    : `${month} ${then.getUTCDate()}, ${then.getUTCFullYear()}`;
}

/** "Edited 5 minutes ago", "Edited yesterday", "Edited Mar 4"; empty when unknown. */
export function editedLabel(iso: string | null | undefined, now: Date = new Date()): string {
  const label = relativeTime(iso, now);
  if (label === "") return "";
  if (label === "Just now" || label === "Yesterday") return `Edited ${label.toLowerCase()}`;
  return `Edited ${label}`;
}
