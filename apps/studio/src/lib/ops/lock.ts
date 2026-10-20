// One async lock per canonical project root (and one for the workspace), in
// this Studio process. Every Studio write takes it, so the person, the agent
// and every tab are serialized on the same project. Another process (the CLI,
// a text editor) is not covered: the one-external-writer rule still applies.

const lockGlobal = globalThis as typeof globalThis & {
  toonyProjectLocks?: Map<string, Promise<void>>;
};

function locks(): Map<string, Promise<void>> {
  lockGlobal.toonyProjectLocks ??= new Map();
  return lockGlobal.toonyProjectLocks;
}

/** Run `fn` after every earlier holder of `key` has finished. A failure releases the lock. */
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const map = locks();
  const previous = map.get(key) ?? Promise.resolve();
  const pending = previous.then(fn);
  const settled = pending.then(
    () => {},
    () => {},
  );
  map.set(key, settled);
  try {
    return await pending;
  } finally {
    if (map.get(key) === settled) map.delete(key);
  }
}
