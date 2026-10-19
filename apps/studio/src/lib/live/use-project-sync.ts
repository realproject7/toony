"use client";

// Keep a page in step with project changes made elsewhere: by the agent, by
// another tab, or by another editor on this page.
//
//   const sync = useProjectSync(workId, [{ kind: "episode", episodeId }]);
//
// On a `project` event for `workId` whose scopes touch the page's `scopes`
// (or any change, with `"all"`), the hook calls `router.refresh()` so server
// components re-render with the saved data. When an editor registered with
// `useEditorScope` holds unsaved edits that the change overlaps, it does NOT
// refresh; it sets `changedWhileDirty` instead, so the editor can show
// "The agent changed this cut. Reload it / Keep editing". `reload()` refreshes
// and clears the flag; `dismiss()` clears it and leaves the editor's own save
// to the existing revision check (409). A `resync` (the tab missed events)
// counts as a change to everything.
//
// Changes made by this same tab are skipped by default, because the component
// that saved already holds the result; pass `{ includeOwn: true }` to refresh
// for them too.

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import type { ChangeScope, ProjectChange } from "../agent/protocol";
import { dirtyEditorScopes, hasDirtyOverlap } from "./editor-scopes";
import { useLiveEvent, useLiveStatus } from "./provider";
import { changeTouchesView } from "./scope";

export interface ProjectSync {
  /** The newest change that arrived while an overlapping editor was dirty. */
  changedWhileDirty: ProjectChange | null;
  reload: () => void;
  dismiss: () => void;
}

const EVERYTHING: ChangeScope[] = [{ kind: "work" }];

export function useProjectSync(
  workId: string | null,
  scopes: readonly ChangeScope[] | "all",
  options: { includeOwn?: boolean } = {},
): ProjectSync {
  const router = useRouter();
  const { clientId } = useLiveStatus();
  const [changedWhileDirty, setChanged] = useState<ProjectChange | null>(null);
  const includeOwn = options.includeOwn === true;

  useLiveEvent(["project", "resync"], (event) => {
    if (workId === null) return;
    let change: ProjectChange;
    if (event.type === "resync") {
      change = {
        workId,
        changeId: `resync-${event.seq}`,
        actor: "human",
        summary: "Toony reloaded the latest saved project.",
        scopes: EVERYTHING,
        at: new Date().toISOString(),
      };
    } else if (event.type === "project") {
      change = event.change;
      if (change.workId !== workId) return;
      if (!includeOwn && change.clientId !== undefined && change.clientId === clientId) return;
      if (!changeTouchesView(scopes, change.scopes)) return;
    } else {
      return;
    }
    // After a resync any open editor may be stale, so any dirty one holds the refresh.
    const blocked =
      event.type === "resync" ? dirtyEditorScopes().length > 0 : hasDirtyOverlap(change.scopes);
    if (blocked) {
      setChanged(change);
      return;
    }
    router.refresh();
  });

  const reload = useCallback(() => {
    setChanged(null);
    router.refresh();
  }, [router]);
  const dismiss = useCallback(() => setChanged(null), []);
  return { changedWhileDirty, reload, dismiss };
}
