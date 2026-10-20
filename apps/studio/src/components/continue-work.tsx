"use client";

// "Continue <title>": the webtoon this browser opened last, when it is still
// in the library.

import Link from "next/link";
import { useEffect, useState } from "react";
import { type LastWork, readLastWork } from "@/lib/last-work";
import { StudioIcon } from "./studio-icon";

export function ContinueWork({ works }: { works: ReadonlyArray<{ id: string; title: string }> }) {
  const [last, setLast] = useState<LastWork | null>(null);
  useEffect(() => {
    const stored = readLastWork();
    const match = stored ? works.find((work) => work.id === stored.id) : undefined;
    setLast(match ? { id: match.id, title: match.title } : null);
  }, [works]);
  if (!last) return null;
  return (
    <Link
      href={`/w/${encodeURIComponent(last.id)}`}
      className="continue-work"
      data-testid="continue-work"
    >
      <span>
        Continue <b>{last.title}</b>
      </span>
      <StudioIcon name="arrow" />
    </Link>
  );
}
