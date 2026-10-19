"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const paths = {
  Library: "M4 4h6v16H4zM14 4h6v16h-6z",
  Story: "M5 3h14v18H5zM8 7h8M8 11h8M8 15h5",
  Characters: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21v-2a8 6 0 0 1 16 0v2",
  Episodes: "M3 4h18v6H3zM3 14h18v6H3z",
  Settings: "M4 7h16M4 17h16M9 4v6M15 14v6",
};
export function Sidebar() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    try {
      const stored = localStorage.getItem("toony-theme") === "dark";
      setDark(stored);
      document.documentElement.dataset.theme = stored ? "dark" : "light";
    } catch {
      /* Default light theme remains usable without storage. */
    }
  }, []);
  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try {
      localStorage.setItem("toony-theme", next ? "dark" : "light");
    } catch {
      /* This tab keeps the choice. */
    }
  };
  const pathname = usePathname() ?? "/";
  const raw = pathname.match(/^\/w\/([^/]+)/)?.[1];
  const base = raw ? `/w/${raw}` : null;
  const link = (label: keyof typeof paths, href: string, testId: string) => (
    <Link
      key={label}
      href={href}
      className="nav-link"
      title={label}
      data-testid={testId}
      aria-current={
        pathname === href || (label !== "Story" && href !== "/" && pathname.startsWith(`${href}/`))
          ? "page"
          : undefined
      }
    >
      <svg
        width="21"
        height="21"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={paths[label]} />
      </svg>
      <span>{label}</span>
    </Link>
  );
  return (
    <aside className="sidebar">
      <Link href="/" className="brand" aria-label="Toony library">
        {/* biome-ignore lint/performance/noImgElement: static local brand asset requires no optimization. */}
        <img className="brand-mark" src="/brand/toony-icon.png" alt="" />
      </Link>
      <nav className="nav" aria-label="Primary">
        {link("Library", "/", "nav-library")}
        {base && (
          <div className="nav-work" data-testid="nav-current-work">
            {link("Story", base, "nav-dashboard")}
            {link("Characters", `${base}/characters`, "nav-characters")}
            {link("Episodes", `${base}/episodes`, "nav-episodes")}
          </div>
        )}
      </nav>
      <nav className="nav nav-bottom" aria-label="Preferences">
        <button
          type="button"
          className="nav-link nav-theme"
          aria-label={dark ? "Use light theme" : "Use dark theme"}
          onClick={toggleTheme}
        >
          <svg
            width="21"
            height="21"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M20 14A8.5 8.5 0 0 1 10 4a8.5 8.5 0 1 0 10 10Z" />
          </svg>
          <span>{dark ? "Light" : "Dark"}</span>
        </button>
        {link("Settings", "/settings", "nav-settings")}
      </nav>
    </aside>
  );
}
