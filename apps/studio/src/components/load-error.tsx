// Shared load-failure notice. Project IO problems surface here with the concrete
// reason so the operator can fix the on-disk project.

import Link from "next/link";

export function LoadError({ reason }: { reason: string }) {
  return (
    <section
      className="notice notice-danger empty-state"
      role="alert"
      data-testid="studio-load-error"
    >
      <h1 className="page-title">Could not load project</h1>
      <p className="page-meta">
        This project could not be opened. Return to your library to choose another project, or check
        the details below.
      </p>
      <details>
        <summary>Error details</summary>
        <pre>{reason}</pre>
      </details>
      <Link href="/" className="btn">
        Back to library
      </Link>
    </section>
  );
}
