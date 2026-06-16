"use client";

// Left rail for the Production Scroll shell. Navigation only — the studio is a
// working tool, not a landing page. Deliberately no wallet/account/publish/
// royalty/marketplace entries.

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/episodes", label: "Episodes" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar() {
  const pathname = usePathname() ?? "/";
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span>Toony Studio</span>
      </div>
      <nav className="nav" aria-label="Primary">
        <p className="nav-section-title">Production</p>
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="nav-link"
            aria-current={isActive(pathname, item.href) ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <p className="sidebar-foot">Local-first webtoon production</p>
    </aside>
  );
}
