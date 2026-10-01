/** Internal store guard. Public mutations enter through goal-feedback.mjs. */
const writers = new Map();
export function withGoalWrite(id, fn) {
  writers.set(id, (writers.get(id) || 0) + 1);
  try { return fn(); } finally {
    const remaining = writers.get(id) - 1;
    if (remaining) writers.set(id, remaining); else writers.delete(id);
  }
}
export function assertGoalMutation(prior, next, readParent = () => null) {
  if (writers.has(next.id)) return;
  if (prior?.epic && prior.epic !== next.epic && readParent(prior.epic)?.goal) {
    throw new Error(`${next.id}: cannot silently remove a child from an admitted goal scope; keep its original epic`);
  }
  if (JSON.stringify(prior?.goal) !== JSON.stringify(next.goal)) {
    throw new Error(`${next.id}: use tm goal operations to change an admitted goal; its scope history is immutable`);
  }
  if (!prior?.goal) return;
  const structure = rows => (rows || []).map(({ id, text }) => ({ id, text }));
  if (JSON.stringify(structure(prior.acceptance)) !== JSON.stringify(structure(next.acceptance))) {
    throw new Error(`${next.id}: admitted goal criteria require tm goal revise with a scope-change receipt`);
  }
  if (next.status !== prior.status && ["done", "deleted", "cancelled", "wontfix"].includes(next.status)) {
    throw new Error(`${next.id}: only tm goal complete can close an admitted goal after deployed proof`);
  }
}
