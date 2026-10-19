export function WorkspaceLoading() {
  return (
    <div className="workspace-loading" role="status" aria-live="polite">
      <p>Opening workspace…</p>
      <div className="loading-heading" aria-hidden="true" />
      <div className="loading-panel" aria-hidden="true" />
    </div>
  );
}
