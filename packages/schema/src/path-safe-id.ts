// Path-safe id rules for ids that are later used as filesystem path segments:
// the predicate that decides whether one is usable, and the fold that decides
// whether two of them are one name on disk.
//
// Episode ids are joined into `episodes/<id>/...` by `@toony/project-io` and the
// export engine. A non-empty-string check alone is not enough: an id such as
// `../../outside` or `/etc` passes a string check but would let a write or export
// escape the work tree. This predicate is the single rule for ids that ever
// become a path segment, so the schema validator, project-io path helpers, and
// Studio routes all reject the same unsafe ids. It is intentionally strict: a
// safe segment-id may not contain a path separator, NUL, be absolute, or be a
// `.`/`..` traversal token.

/**
 * Whether `id` is safe to use verbatim as a single filesystem path segment.
 * Rejects: non-strings, empty, `/`, `\`, NUL, a Windows drive-letter absolute
 * prefix, and the `.`/`..` traversal tokens. Plain ids like `ep-001` pass.
 */
export function isPathSafeId(id: unknown): id is string {
  if (typeof id !== "string" || id.length === 0) return false;
  if (id === "." || id === "..") return false;
  if (id.includes("/") || id.includes("\\") || id.includes("\0")) return false;
  // Reject a Windows drive-letter absolute prefix (e.g. `C:`), which the
  // separator checks above do not catch on POSIX where `:` is a legal char.
  if (/^[a-zA-Z]:/.test(id)) return false;
  return true;
}

/**
 * The fold two path-safe ids share when a filesystem treats them as one name.
 *
 * `isPathSafeId` accepts `ep-A` and `ep-a` alike, and it accepts the same text
 * written in two Unicode normalization forms. A case-insensitive filesystem
 * folds the first pair and macOS APFS folds the second, so either pair is one
 * directory entry there. Normalizing before lowercasing folds both the same
 * way, and every guard over ids that become a path segment compares THIS
 * fold, so two guards cannot answer the same question differently.
 *
 * NFC and not NFKC: NFC folds canonical equivalence, which is the equivalence
 * the filesystem folds. NFKC would additionally fold `ep-2` onto `ep-²`, ids an
 * author can tell apart and the filesystem keeps apart, and refusing valid work
 * is the worse failure of the two.
 *
 * Known to be narrower than the filesystem's own table, deliberately.
 * `toLowerCase()` is simple lowercasing, not Unicode case folding, and a
 * case-insensitive APFS volume folds by the full case-folding table. Pairs that
 * volume merges onto one name and this fold keeps distinct: `ep-ſ` (U+017F)
 * against `ep-s`, `ep-ß` against `ep-ss`, `ep-ﬁ` (U+FB01) against `ep-fi`,
 * `ep-ς` (U+03C2) against `ep-σ` (U+03C3), and `ep-Σ` (U+03A3) against
 * `ep-ς`. That is the extent of the accepted risk that has been CHECKED, pair
 * by pair on such a volume, not the extent of the table; `path-safe-id.test.ts`
 * holds the same list and re-checks every claim made about it here.
 *
 * Closing the gap needs the full case-folding table, which the language does
 * not expose, and neither rule near enough to reach for is that table. NFKC
 * merges `ep-ſ`/`ep-s` and `ep-ﬁ`/`ep-fi` and leaves the other three apart.
 * `Intl.Collator` at accent sensitivity merges `ep-ﬁ`/`ep-fi` and both sigma
 * pairs and leaves the other two apart. Each also merges `ep-²` onto `ep-2`,
 * which the filesystem keeps apart, so adopting either would close part of this
 * gap by refusing work an author has no way to rephrase, which is the worse
 * failure. The gap refuses nothing an author can write and see; it leaves a
 * pair that only a full-folding filesystem merges unreported.
 */
export function foldPathSafeId(id: string): string {
  return id.normalize("NFC").toLowerCase();
}

/**
 * The filesystems that fold `a` and `b` onto one name, as the phrase a
 * collision message names them by. The two ids are expected to share
 * `foldPathSafeId` already; nothing here decides whether they collide.
 *
 * A message that names a filesystem has to be true of that filesystem. APFS
 * folds case and normalization form, so it merges every pair `foldPathSafeId`
 * merges. NTFS folds case by an upcase table and preserves normalization form,
 * so it merges only a pair that is one string under that table; naming it for a
 * pair it keeps apart as two entries tells the reader something untrue about
 * the filesystem under the reader's own feet.
 *
 * Lowercasing alone does not answer that, because a lowercase mapping is not
 * always case alone. `ep-İ` (U+0130) lowercases to `ep-i` followed by
 * U+0307, an id an author can write on its own, so the two compare equal
 * lowercased while differing in normalization form. `ep-K` (U+212A),
 * `ep-Å` (U+212B) and `ep-Ω` (U+2126) lowercase onto the ordinary
 * letters they decompose to under NFC, hiding a normalization difference the
 * same way. `ep-ẞ` (U+1E9E) against `ep-ß`, and `ep-ϴ` (U+03F4)
 * against `ep-Θ`, are capitals that share a lowercase and keep their own
 * uppercase. Uppercased, every one of those pairs is two different strings,
 * which is what NTFS's table holds, so both simple mappings have to agree
 * before the phrase names NTFS. Requiring the second one only ever drops NTFS
 * and never adds it, so no pair gains a filesystem it did not have. Both guards
 * over ids that become a path segment take the phrase from here, so neither can
 * name a filesystem the other would not.
 */
export function foldingFilesystems(a: string, b: string): string {
  return a.toLowerCase() === b.toLowerCase() && a.toUpperCase() === b.toUpperCase()
    ? "filesystems that fold case (macOS APFS, Windows NTFS)"
    : "filesystems that fold Unicode normalization form (macOS APFS)";
}
