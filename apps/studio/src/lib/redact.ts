// Error text shown in the workspace must never carry a local file path. Project
// IO errors name files on disk; this keeps the useful part of the message and
// replaces any absolute path with a short marker.

const ABSOLUTE_PATH = /(?:[A-Za-z]:\\|\/)(?:[^\s"'`:;,)]+[\\/])+[^\s"'`:;,)]*/g;

/** Replace absolute paths in `text` with "a project file". */
export function redactPaths(text: string): string {
  return text.replace(ABSOLUTE_PATH, (match) => {
    // Keep short relative-looking fragments such as "/api" untouched.
    const segments = match.split(/[\\/]/).filter(Boolean);
    return segments.length >= 2 ? "a project file" : match;
  });
}
