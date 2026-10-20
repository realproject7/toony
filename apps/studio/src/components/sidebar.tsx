"use client";

// The workspace rail: Library, then the open webtoon's Story, Characters and
// Episodes, then Settings. The brand mark also returns to the library. The
// webtoon group stays while visiting Settings (the last opened work is kept in
// this browser). The rail also listens for the agent connection state on the
// live feed so pages can show it without a request of their own.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { setConnectionState } from "@/lib/connection-store";
import { type LastWork, readLastWork } from "@/lib/last-work";
import { useLiveEvent } from "@/lib/live/provider";
import { StudioIcon, type StudioIconName } from "./studio-icon";

interface RailLink {
  label: string;
  icon: StudioIconName;
  href: string;
  testId: string;
  current: boolean;
}

function workIdFrom(pathname: string): string | null {
  const raw = pathname.match(/^\/w\/([^/]+)/)?.[1];
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

export function Sidebar() {
  const pathname = usePathname() ?? "/";
  const routeWork = workIdFrom(pathname);
  const [remembered, setRemembered] = useState<LastWork | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read the remembered work on every navigation.
  useEffect(() => {
    setRemembered(readLastWork());
  }, [pathname]);
  useLiveEvent(["hello", "connection"], (event) => {
    if (event.type === "hello" || event.type === "connection") setConnectionState(event.connection);
  });

  const workId = routeWork ?? (pathname === "/settings" ? (remembered?.id ?? null) : null);
  const base = workId ? `/w/${encodeURIComponent(workId)}` : null;
  const links: RailLink[] = [
    {
      label: "Library",
      icon: "library",
      href: "/",
      testId: "nav-library",
      current: pathname === "/",
    },
  ];
  if (base) {
    const inEpisode = pathname.startsWith(`${base}/episodes`);
    links.push(
      {
        label: "Story",
        icon: "story",
        href: base,
        testId: "nav-dashboard",
        current: pathname === base,
      },
      {
        label: "Characters",
        icon: "characters",
        href: `${base}/characters`,
        testId: "nav-characters",
        current: pathname.startsWith(`${base}/characters`),
      },
      {
        label: "Episodes",
        icon: "episodes",
        href: `${base}#episodes`,
        testId: "nav-episodes",
        current: inEpisode,
      },
    );
  }
  const settings: RailLink = {
    label: "Settings",
    icon: "settings",
    href: "/settings",
    testId: "nav-settings",
    current: pathname === "/settings",
  };

  const item = (link: RailLink) => (
    <Link
      key={link.testId}
      href={link.href}
      className="nav-link"
      data-testid={link.testId}
      aria-current={link.current ? "page" : undefined}
    >
      <StudioIcon name={link.icon} size={20} />
      <span>{link.label}</span>
    </Link>
  );

  return (
    <aside className="sidebar">
      <Link href="/" className="brand" aria-label="Toony library">
        {/* biome-ignore lint/performance/noImgElement: static local brand asset requires no optimization. */}
        <img className="brand-mark" src="/brand/toony-icon.png" alt="" />
      </Link>
      <nav className="nav" aria-label="Primary">
        {item(links[0] as RailLink)}
        {base && (
          <div className="nav-work" data-testid="nav-current-work">
            {links.slice(1).map(item)}
          </div>
        )}
      </nav>
      <nav className="nav nav-bottom" aria-label="Preferences">
        {item(settings)}
      </nav>
    </aside>
  );
}
