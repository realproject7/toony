// Runs once when the Studio server starts. A fresh install has no workspace
// folder yet; create it now so the library, the agent and the live feed work
// before the first webtoon exists. Routes also create it on first access.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureWorkspaceRoot } = await import("./lib/workspace");
  await ensureWorkspaceRoot().catch(() => {
    // An unwritable location is reported where it is used, not at startup.
  });
}
