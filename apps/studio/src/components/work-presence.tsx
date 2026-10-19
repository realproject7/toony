"use client";

// Mounted once per webtoon (in the work layout). It remembers the webtoon as
// the last one opened in this browser and tells the agent panel which page the
// person is on. The episode editor reports its own, finer focus (cut, bubbles),
// so this stays quiet there.

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { setAgentFocus } from "@/lib/agent/focus-store";
import type { AgentFocus } from "@/lib/agent/protocol";
import { rememberLastWork } from "@/lib/last-work";

/** The focus for a work route, or null for the episode editor. */
function focusFor(pathname: string, base: string): AgentFocus | null {
  const rest = pathname.slice(base.length);
  if (rest === "" || rest === "/") return { route: "story" };
  if (rest.startsWith("/characters")) return { route: "characters" };
  const episode = rest.match(/^\/episodes\/([^/]+)(\/[^/]+)?/);
  if (!episode) return { route: "story" };
  let episodeId: string;
  try {
    episodeId = decodeURIComponent(episode[1] ?? "");
  } catch {
    return { route: "story" };
  }
  const tail = episode[2];
  if (tail === undefined) return null;
  if (tail === "/read") return { route: "preview", episodeId };
  if (tail === "/export") return { route: "export", episodeId };
  return { route: "episode", episodeId };
}

export function WorkPresence({ workId, title }: { workId: string; title: string }) {
  const pathname = usePathname() ?? "";
  useEffect(() => {
    rememberLastWork({ id: workId, title });
  }, [workId, title]);
  useEffect(() => {
    const focus = focusFor(pathname, `/w/${encodeURIComponent(workId)}`);
    if (focus) setAgentFocus(focus);
  }, [pathname, workId]);
  return null;
}

/** Report a fixed focus for a page outside a webtoon (library, settings). */
export function RouteFocus({ route }: { route: "library" | "settings" }) {
  useEffect(() => {
    setAgentFocus({ route });
  }, [route]);
  return null;
}
