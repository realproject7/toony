// Runs once when the Studio server starts. A fresh install has no workspace
// folder yet; create it now so the library, the agent and the live feed work
// before the first webtoon exists. Routes also create it on first access.
// The import sits inside the runtime check so only the Node.js server bundle
// includes the file system code.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { prepareWorkspace } = await import("./instrumentation-node");
    await prepareWorkspace();
  }
}
