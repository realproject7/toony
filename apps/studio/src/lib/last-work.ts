// The webtoon the person opened last, remembered per browser so the library can
// offer "Continue <title>" and the rail keeps the work while visiting Settings.
// Parsing is defensive: storage can hold anything.

export const LAST_WORK_KEY = "toony-last-work";

export interface LastWork {
  id: string;
  title: string;
}

/** Parse a stored value. Returns null for anything that is not a plain {id, title}. */
export function parseLastWork(raw: string | null | undefined): LastWork | null {
  if (!raw || raw.length > 2000) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== "object" || value === null) return null;
    const { id, title } = value as Record<string, unknown>;
    if (typeof id !== "string" || id.length === 0 || /[/\\\0]/.test(id)) return null;
    return { id, title: typeof title === "string" && title.trim() !== "" ? title : id };
  } catch {
    return null;
  }
}

export function serializeLastWork(work: LastWork): string {
  return JSON.stringify({ id: work.id, title: work.title });
}

/** Read the remembered work from browser storage, or null. Never throws. */
export function readLastWork(): LastWork | null {
  try {
    return parseLastWork(globalThis.localStorage?.getItem(LAST_WORK_KEY));
  } catch {
    return null;
  }
}

/** Remember a work. Storage that refuses is ignored. */
export function rememberLastWork(work: LastWork): void {
  try {
    globalThis.localStorage?.setItem(LAST_WORK_KEY, serializeLastWork(work));
  } catch {
    // A private window keeps working without the shortcut.
  }
}

/** Forget the remembered work, for example after it was deleted. */
export function forgetLastWork(): void {
  try {
    globalThis.localStorage?.removeItem(LAST_WORK_KEY);
  } catch {
    // Nothing to forget.
  }
}
