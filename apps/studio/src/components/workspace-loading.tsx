// Quiet loading skeleton for every route: the page shape without words.
export function WorkspaceLoading() {
  return (
    <div className="workspace-loading" role="status" aria-live="polite">
      <span className="sr-only">Loading</span>
      <div className="loading-heading" aria-hidden="true" />
      <div className="loading-panel" aria-hidden="true" />
    </div>
  );
}
