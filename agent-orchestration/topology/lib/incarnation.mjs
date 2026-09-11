// One tmux process incarnation. Pane ids and session names are reusable; the complete tuple is not.
export const INCARNATION_FIELDS = ['serverKey', 'serverPid', 'sessionId', 'sessionCreated', 'paneId', 'panePid'];

export function incarnationOf(value) {
  if (!value || INCARNATION_FIELDS.some(key => value[key] === undefined || value[key] === null)) return null;
  return Object.fromEntries(INCARNATION_FIELDS.map(key => [key, value[key]]));
}

export function sameIncarnation(left, right) {
  const a = incarnationOf(left), b = incarnationOf(right);
  return Boolean(a && b && INCARNATION_FIELDS.every(key => a[key] === b[key]));
}
