// A webtoon that cannot be opened. The reason stays behind "Details" and never
// names a file on this computer.

import Link from "next/link";
import { redactPaths } from "@/lib/redact";

export function LoadError({ reason }: { reason: string }) {
  return (
    <section className="state-page" role="alert" data-testid="studio-load-error">
      <h1 className="page-title">This webtoon could not be opened</h1>
      <p className="page-lede">
        One of its files could not be read. Ask your agent to check the project, or open another
        webtoon.
      </p>
      <details className="disclosure">
        <summary>Details</summary>
        <p className="page-meta">{redactPaths(reason)}</p>
      </details>
      <div className="state-actions">
        <Link href="/" className="btn btn-primary">
          Library
        </Link>
      </div>
    </section>
  );
}
