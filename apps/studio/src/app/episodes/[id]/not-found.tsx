import Link from "next/link";

export default function EpisodeNotFound() {
  return (
    <section className="notice" data-testid="episode-not-found">
      <h1 className="page-title">Episode not found</h1>
      <p className="page-meta">No episode with that id exists in the selected project.</p>
      <p>
        <Link href="/episodes" className="inspector-back">
          &larr; All episodes
        </Link>
      </p>
    </section>
  );
}
