// Shared load-failure notice. Project IO problems surface here with the concrete
// reason so the operator can fix the on-disk project.

export function LoadError({ reason }: { reason: string }) {
  return (
    <section className="notice notice-danger" data-testid="studio-load-error">
      <h1 className="page-title">Could not load project</h1>
      <p className="page-meta">
        The studio reads the project selected by the Toony CLI. Check that the directory contains a
        valid project.
      </p>
      <pre>{reason}</pre>
    </section>
  );
}
