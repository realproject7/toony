import Link from "next/link";

// Shared not-found for the per-work subtree: an unknown work id, or an unknown
// episode/cut within a work. `notFound()` does not carry the matched route
// params, so this links back to the library, which lists every resolvable work.
export default function WorkNotFound() {
  return (
    <section className="notice empty-state" data-testid="work-not-found">
      <h1 className="page-title">This page is unavailable</h1>
      <p className="page-meta">
        No matching work, episode, or cut exists in this workspace. It may have been renamed or
        removed.
      </p>
      <p>
        <Link href="/" className="btn">
          Back to library
        </Link>
      </p>
    </section>
  );
}
