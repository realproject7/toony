"use client";

// Left rail for the Production Scroll shell. Navigation only — the studio is a
// working tool, not a landing page. Deliberately no wallet/account/publish/
// royalty/marketplace entries.
//
// Workspace-aware (issue #51): the rail always offers a way back to the Library
// at `/`. When the current route is inside a work (`/w/<id>/...`), it also shows
// that work's scoped navigation (dashboard + episodes) so switching between a
// work's surfaces never requires a restart. The current work id is read from the
// path — no server round-trip — and url-decoded for display.

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Extract the current work id from a `/w/<id>/...` path, or null at the library. */
function currentWorkId(pathname: string): string | null {
  const match = pathname.match(/^\/w\/([^/]+)/);
  const raw = match?.[1];
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar() {
  const pathname = usePathname() ?? "/";
  const workId = currentWorkId(pathname);
  const workBase = workId ? `/w/${encodeURIComponent(workId)}` : null;

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span>Toony Studio</span>
      </div>
      <nav className="nav" aria-label="Primary">
        <p className="nav-section-title">Workspace</p>
        <Link
          href="/"
          className="nav-link"
          aria-current={isActive(pathname, "/") ? "page" : undefined}
          data-testid="nav-library"
        >
          Library
        </Link>

        {workBase && (
          <>
            <p className="nav-section-title nav-section-work" data-testid="nav-current-work">
              {workId}
            </p>
            <Link
              href={workBase}
              className="nav-link"
              aria-current={pathname === workBase ? "page" : undefined}
              data-testid="nav-dashboard"
            >
              Dashboard
            </Link>
            <Link
              href={`${workBase}/episodes`}
              className="nav-link"
              aria-current={isActive(pathname, `${workBase}/episodes`) ? "page" : undefined}
              data-testid="nav-episodes"
            >
              Episodes
            </Link>
          </>
        )}
      </nav>
      <p className="sidebar-foot">Local-first webtoon production</p>
    </aside>
  );
}
