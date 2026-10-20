"use client";

// The app-level error page: a calm message, a retry and a way home. The error
// text is never shown (it can name files on this computer); the digest helps
// match a server log line when someone reports it.

import Link from "next/link";
import { useEffect } from "react";
import { setAgentFocus } from "@/lib/agent/focus-store";

export default function StudioError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    setAgentFocus({ route: "library" });
  }, []);
  return (
    <section className="state-page" role="alert" data-testid="studio-error">
      <h1 className="page-title">Something went wrong</h1>
      <p className="page-lede">
        Toony could not show this page. Your files are unchanged. Try again, or go back to your
        library.
      </p>
      <div className="state-actions">
        <button type="button" className="btn btn-primary" onClick={reset}>
          Try again
        </button>
        <Link href="/" className="btn">
          Library
        </Link>
      </div>
    </section>
  );
}
