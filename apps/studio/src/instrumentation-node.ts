// Node.js part of the startup hook: make sure the workspace folder exists.
// An unwritable location is reported where it is used, not at startup.

import { mkdir } from "node:fs/promises";
import { workspaceRoot } from "./lib/workspace";

export async function prepareWorkspace(): Promise<void> {
  await mkdir(workspaceRoot(), { recursive: true }).catch(() => {});
}
