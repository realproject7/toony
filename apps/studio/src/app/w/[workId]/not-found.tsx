import Link from "next/link";

// An unknown webtoon, episode or cut. `notFound()` does not carry the route
// params, so this links back to the library, which lists every webtoon.
export default function WorkNotFound() {
  return (
    <section className="state-page" data-testid="work-not-found">
      <h1 className="page-title">This page is unavailable</h1>
      <p className="page-lede">
        This webtoon, episode or cut is not in your workspace. It may have been renamed or removed.
      </p>
      <div className="state-actions">
        <Link href="/" className="btn btn-primary">
          Library
        </Link>
      </div>
    </section>
  );
}
