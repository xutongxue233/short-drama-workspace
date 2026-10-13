/** Restore a synchronous mutation without replacing objects held by async jobs. */
export function snapshotState(root) {
  const snapshots = new Map();
  function visit(value) {
    if (!value || typeof value !== "object" || snapshots.has(value)) return;
    const entries = Object.entries(value);
    snapshots.set(value, {
      entries,
      length: Array.isArray(value) ? value.length : null,
    });
    for (const [, child] of entries) visit(child);
  }
  visit(root);
  return () => {
    for (const [value, { entries, length }] of snapshots) {
      for (const key of Object.keys(value)) delete value[key];
      if (length !== null) value.length = length;
      for (const [key, child] of entries) value[key] = child;
    }
  };
}

export function stateTransaction(root, mutate) {
  const restore = snapshotState(root);
  try {
    return mutate();
  } catch (error) {
    restore();
    throw error;
  }
}

/** For synchronous HTTP handlers only; save must precede sending the response. */
export const transactionalRoute = (getState, handler) => (req, res) =>
  stateTransaction(getState(), () => handler(req, res));
