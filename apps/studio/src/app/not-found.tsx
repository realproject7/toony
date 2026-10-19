import Link from "next/link";

export const metadata = { title: { absolute: "Not found · Toony" } };

// Any address Studio does not know.
export default function NotFound() {
  return (
    <section className="state-page" data-testid="studio-not-found">
      <h1 className="page-title">This page does not exist</h1>
      <p className="page-lede">The address may be mistyped, or the page was moved.</p>
      <div className="state-actions">
        <Link href="/" className="btn btn-primary">
          Library
        </Link>
      </div>
    </section>
  );
}
