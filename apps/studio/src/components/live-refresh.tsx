"use client";

// Keeps a server-rendered page current: when the agent or another tab changes
// what the page shows, the page re-renders with the saved data. Pages without
// open editors use this; the episode editor wires its own sync.

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import type { ChangeScope } from "@/lib/agent/protocol";
import { useLiveEvent } from "@/lib/live/provider";
import { useProjectSync } from "@/lib/live/use-project-sync";

export function LiveRefresh({
  workId,
  scopes = "all",
}: {
  workId: string;
  scopes?: readonly ChangeScope[] | "all";
}) {
  useProjectSync(workId, scopes);
  return null;
}

/** The library lists every webtoon, so any project change refreshes it (batched). */
export function LibraryRefresh() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useLiveEvent(["project", "resync"], () => {
    if (timer.current !== undefined) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      router.refresh();
    }, 400);
  });
  useEffect(
    () => () => {
      if (timer.current !== undefined) clearTimeout(timer.current);
    },
    [],
  );
  return null;
}
